/**
 * Main Agent Loop
 *
 * Runs autonomous coding sessions until all features pass or max iterations reached.
 * Agent files are stored in .autonomous/ directory.
 * Dev server runs on port 4242 to avoid conflicts.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { printProgressSummary, AUTONOMOUS_DIR } from "./progress.js";
import { getClientOptions } from "./client.js";
import {
  initDatabase,
  getNextFeatures,
  getProgressStats,
  startSession,
  endSession,
  resetOrphanedFeatures,
  hasIncompleteFeatures,
  setFeatureStatus,
  getKanbanStats,
  getNotesForFeature,
} from "./db.js";
import { ensureDevServer } from "./dev-server.js";
import fs from "fs";
import path from "path";

// Get the template directory (where this code lives)
const TEMPLATE_DIR = path.resolve(import.meta.dirname, "..");

// Default port for autonomous agent dev servers
export const DEFAULT_PORT = 4242;

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format a date to a timestamp string.
 */
function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface AgentConfig {
  projectDir: string;
  maxIterations: number;
  port: number;
  model: string;
}

interface FeatureLookup {
  [id: number]: { name: string; category: string };
}

/**
 * Get global and category notes for context.
 */
function getRelevantNotes(projectDir: string, category: string): string {
  const notes = getNotesForFeature(projectDir, null, category);
  if (notes.length === 0) return "";

  const formatted = notes
    .slice(0, 10) // Limit to 10 most recent notes
    .map((n) => {
      const scope = n.category ? `[${n.category}]` : "[global]";
      return `- ${scope} ${n.content}`;
    })
    .join("\n");

  return `\n### Notes from Previous Sessions\n${formatted}`;
}

/**
 * Build the session context to inject into the prompt.
 * Lean approach: only inject ephemeral/session-specific info.
 * Agent reads static files (app_spec.txt, CLAUDE.md) when needed.
 */
function buildSessionContext(
  projectDir: string,
  batchFeatures: Array<{
    id?: number;
    name: string;
    description: string;
    category?: string;
    status: string;
  }>,
  stats: {
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  },
  port: number
): string {
  const category = batchFeatures[0]?.category || "uncategorized";
  const notes = getRelevantNotes(projectDir, category);

  // Format the batch as a nice table
  const batchTable = batchFeatures
    .map((f, i) => {
      const status = i === 0 ? "in_progress" : "pending";
      const marker = status === "in_progress" ? "→" : " ";
      return `${marker} ${f.id}: ${f.name} [${status}]`;
    })
    .join("\n");

  const total =
    stats.pending + stats.in_progress + stats.completed + stats.failed;
  const pct = total > 0 ? Math.round((stats.completed / total) * 100) : 0;

  return `
## SESSION CONTEXT

### Environment
- **Dev server:** Running on http://localhost:${port} (managed by orchestrator)
- **Project directory:** Working directory is the target project

### Your Assignment (${batchFeatures.length} features from "${category}" category)

\`\`\`
${batchTable}
\`\`\`

Feature ${batchFeatures[0]?.id} ("${batchFeatures[0]?.name}") is already marked as in_progress.

### Progress: ${stats.completed}/${total} completed (${pct}%) | ${stats.pending} pending | ${stats.failed} failed
${notes}
---

`;
}

interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  featuresCompleted: number;
}

/**
 * Format a compact stats line for session summary.
 * Shows: duration | cost
 */
function formatSessionStats(stats: SessionStats, duration: number): string {
  const durationStr = formatDuration(duration);
  return `${durationStr} | $${stats.costUsd.toFixed(2)}`;
}

export async function runAutonomousAgent({
  projectDir,
  maxIterations,
  port,
  model,
}: AgentConfig): Promise<void> {
  const absoluteProjectDir = path.resolve(projectDir);

  // Ensure project directory exists
  if (!fs.existsSync(absoluteProjectDir)) {
    fs.mkdirSync(absoluteProjectDir, { recursive: true });
    console.log(`Created project directory: ${absoluteProjectDir}`);
  }

  // Initialize database (creates schema if needed)
  const autonomousDir = path.join(absoluteProjectDir, AUTONOMOUS_DIR);
  const dbPath = path.join(autonomousDir, "db.sqlite");

  // Check if database exists and has features
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: No database found`);
    console.error(`Expected location: ${dbPath}`);
    console.error("");
    console.error("Setup required:");
    console.error(`  1. Create ${AUTONOMOUS_DIR}/ directory in your project`);
    console.error(`  2. Add app_spec.txt with your project specification`);
    console.error(
      `  3. Generate features.sql using templates/feature_list_generator.md`
    );
    console.error(`  4. Run: sqlite3 ${dbPath} < features.sql`);
    console.error("");
    console.error("See templates/ for generator prompts and examples.");
    process.exit(1);
  }

  // Initialize database connection
  initDatabase(absoluteProjectDir);

  // Reset any features left in 'in_progress' from crashed sessions
  const orphaned = resetOrphanedFeatures(absoluteProjectDir);
  if (orphaned > 0) {
    console.log(`Reset ${orphaned} orphaned in_progress features to pending`);
  }

  // Check if database has any features
  const stats = getProgressStats(absoluteProjectDir);
  if (stats.total === 0) {
    console.error(`Error: Database exists but contains no features`);
    console.error(`Expected location: ${dbPath}`);
    console.error("");
    console.error("Setup required:");
    console.error(
      `  1. Generate features.sql using templates/feature_list_generator.md`
    );
    console.error(`  2. Run: sqlite3 ${dbPath} < features.sql`);
    process.exit(1);
  }

  // Load the coding prompt
  const promptPath = path.join(
    import.meta.dirname,
    "..",
    "prompts",
    "coding_prompt.md"
  );
  if (!fs.existsSync(promptPath)) {
    console.error(`Error: Prompt file not found at ${promptPath}`);
    process.exit(1);
  }
  // Load prompt and replace port placeholder
  let codingPrompt = fs.readFileSync(promptPath, "utf-8");
  codingPrompt = codingPrompt.replace(/\{\{PORT\}\}/g, String(port));

  let iteration = 0;
  const totalStart = new Date();

  // Cumulative stats across all sessions
  const totalStats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    featuresCompleted: 0,
  };

  // Main loop - continue while there are incomplete features
  while (
    hasIncompleteFeatures(absoluteProjectDir) &&
    iteration < maxIterations
  ) {
    iteration++;

    const sessionStart = new Date();

    // Generate current_batch.json for this session
    const batchFeatures = getNextFeatures(absoluteProjectDir, 10);
    const batchPath = path.join(autonomousDir, "current_batch.json");
    fs.writeFileSync(batchPath, JSON.stringify(batchFeatures, null, 2));

    // Mark the first feature as in_progress
    if (batchFeatures.length > 0 && batchFeatures[0].id !== undefined) {
      setFeatureStatus(absoluteProjectDir, batchFeatures[0].id, "in_progress");
    }

    // Compact session header
    const progressStats = getProgressStats(absoluteProjectDir);
    const firstFeature = batchFeatures[0];
    console.log(`\n[Starting Session ${iteration}] ${progressStats.completed}/${progressStats.total} done | Batch: ${batchFeatures.length} features | Next: "${firstFeature?.name}"`);

    // Build feature lookup for live updates
    const featureLookup: FeatureLookup = {};
    for (const f of batchFeatures) {
      if (f.id !== undefined) {
        featureLookup[f.id] = {
          name: f.name,
          category: f.category || "uncategorized",
        };
      }
    }

    // Build enriched prompt with injected context
    const kanbanStats = getKanbanStats(absoluteProjectDir);
    const sessionContext = buildSessionContext(
      absoluteProjectDir,
      batchFeatures,
      kanbanStats,
      port
    );
    const enrichedPrompt = sessionContext + codingPrompt;

    // Capture pre-session completed count for verification
    const preSessionCompleted = kanbanStats.completed;

    // Ensure dev server is running before starting session
    const serverReady = await ensureDevServer({
      projectDir: absoluteProjectDir,
      port,
      timeout: 60000, // 60 seconds to start
    });

    if (!serverReady) {
      console.error("[Pre-session] Dev server failed to start. Skipping session.");
      console.error("Check .autonomous/dev-server.log for details.");
      await sleep(5000);
      continue; // Skip this iteration and retry
    }

    // Create session record
    const sessionId = startSession(absoluteProjectDir);

    // Prepare environment variables for CLI commands
    const agentEnv = {
      AUTONOMOUS_PROJECT_DIR: absoluteProjectDir,
      AUTONOMOUS_SESSION_ID: String(sessionId),
      AUTONOMOUS_TEMPLATE_DIR: TEMPLATE_DIR,
      AUTONOMOUS_PORT: String(port),
    };

    let sessionStats: SessionStats | null = null;

    // Log file for verbose agent output
    const logPath = path.join(autonomousDir, "session.log");

    try {
      // Run a single agent session
      sessionStats = await runAgentSession(
        absoluteProjectDir,
        model,
        enrichedPrompt,
        agentEnv,
        featureLookup,
        logPath
      );

      // Verify actual completions from database (source of truth)
      const postSessionStats = getKanbanStats(absoluteProjectDir);
      const verifiedCompleted =
        postSessionStats.completed - preSessionCompleted;
      const observedCompleted = sessionStats?.featuresCompleted ?? 0;

      // Log discrepancy only if it matters (we observed some but DB differs)
      if (observedCompleted > 0 && observedCompleted !== verifiedCompleted) {
        console.log(`[Note] Tool tracking: ${observedCompleted}, DB verified: ${verifiedCompleted}`);
      }

      // Accumulate stats (use verified count from database)
      if (sessionStats) {
        totalStats.inputTokens += sessionStats.inputTokens;
        totalStats.outputTokens += sessionStats.outputTokens;
        totalStats.cacheReadTokens += sessionStats.cacheReadTokens;
        totalStats.cacheWriteTokens += sessionStats.cacheWriteTokens;
        totalStats.costUsd += sessionStats.costUsd;
      }
      // Always use verified count from database
      totalStats.featuresCompleted += verifiedCompleted;

      // End session with stats (use verified count)
      endSession(absoluteProjectDir, sessionId, {
        status: "completed",
        features_attempted: batchFeatures.length,
        features_completed: verifiedCompleted,
        input_tokens: sessionStats?.inputTokens,
        output_tokens: sessionStats?.outputTokens,
        cost_usd: sessionStats?.costUsd,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`\n[Session ${iteration} Error] ${errMsg}`);
      console.log("Retrying in 5s...");
      await sleep(5000);

      // End session with error
      endSession(absoluteProjectDir, sessionId, {
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }

    const sessionEnd = new Date();
    const duration = sessionEnd.getTime() - sessionStart.getTime();

    // Compact session summary
    if (sessionStats) {
      console.log(`\n[Session ${iteration}] ${formatSessionStats(sessionStats, duration)}`);
    } else {
      console.log(`\n[Session ${iteration}] ${formatDuration(duration)} | failed`);
    }

    // Check if we should continue
    if (
      hasIncompleteFeatures(absoluteProjectDir) &&
      iteration < maxIterations
    ) {
      console.log("\n--- Auto-continuing in 3 seconds (Ctrl+C to pause) ---");
      await sleep(3000);
    }
  }

  // Final summary
  const totalEnd = new Date();
  const totalDuration = totalEnd.getTime() - totalStart.getTime();
  const finalStats = getProgressStats(absoluteProjectDir);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`DONE | ${formatDuration(totalDuration)} | ${iteration} session${iteration > 1 ? "s" : ""} | $${totalStats.costUsd.toFixed(2)}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Features: ${finalStats.completed}/${finalStats.total} completed`);
  console.log(`Log: ${path.join(autonomousDir, "session.log")}`);

  if (!hasIncompleteFeatures(absoluteProjectDir)) {
    console.log(`\nRun: cd ${absoluteProjectDir} && PORT=${port} bun run dev`);
  } else {
    console.log(`\nIncomplete - run again to continue.`);
  }
}

async function runAgentSession(
  projectDir: string,
  model: string,
  prompt: string,
  env: Record<string, string>,
  featureLookup: FeatureLookup = {},
  logPath: string
): Promise<SessionStats> {
  const options = getClientOptions(projectDir, model, env);

  const response = query({
    prompt,
    options,
  });

  // Initialize stats
  const stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    featuresCompleted: 0,
  };

  // Track completed features for live updates
  let completedCount = 0;

  // Open log file for verbose output
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const log = (text: string) => logStream.write(text);
  log(`\n${"=".repeat(60)}\nSession started: ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`);

  // Stream and display the response
  // Using 'any' to handle SDK type variations
  for await (const message of response) {
    const msg = message as any;

    switch (msg.type) {
      case "assistant":
        // Parse message content - can contain text and tool_use blocks
        const message = msg.message;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === "text" && block.text) {
              // Write to log file instead of console
              log(block.text);
            } else if (block.type === "tool_use") {
              // Log tool calls to file
              log(`\n[Tool: ${block.name}]\n`);

              // Handle tool calls - check for feature_status updates
              const toolName = block.name;
              const toolInput = block.input;

              if (toolName?.endsWith("feature_status") && toolInput) {
                const featureId = toolInput.feature_id;
                const status = toolInput.status;
                const feature = featureLookup[featureId];

                if (feature && status) {
                  const statusIcon =
                    status === "completed" ? "✓" :
                    status === "in_progress" ? "→" :
                    status === "pending" ? "↻" : "✗";
                  // Print to console - this is important status info
                  console.log(`  [${statusIcon}] Feature ${featureId}: "${feature.name}" → ${status}`);
                  log(`[${statusIcon}] Feature ${featureId}: "${feature.name}" → ${status}\n`);

                  if (status === "completed") {
                    completedCount++;
                    stats.featuresCompleted = completedCount;
                  }
                }
              }
            }
          }
        }
        break;

      case "user":
        // Tool results come back as user messages - log to file
        log("\n[Tool Result]\n");
        break;

      case "error":
        console.error(`  [Error] ${msg.error}`);
        log(`\n[Error] ${msg.error}\n`);
        break;

      case "system":
        if (msg.subtype === "init") {
          log(`[Session ID: ${msg.session_id}]\n`);
        }
        break;

      case "result":
        // Capture token usage from result message
        if (msg.usage) {
          stats.inputTokens = msg.usage.input_tokens ?? 0;
          stats.outputTokens = msg.usage.output_tokens ?? 0;
          stats.cacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
          stats.cacheWriteTokens = msg.usage.cache_creation_input_tokens ?? 0;
        }
        stats.costUsd = msg.total_cost_usd ?? 0;
        log(`\n[Result] Cost: $${stats.costUsd.toFixed(2)}\n`);
        break;
    }
  }

  logStream.end();
  return stats;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

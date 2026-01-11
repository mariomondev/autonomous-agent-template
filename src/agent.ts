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
 * Format token count with comma separators.
 */
function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
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

    console.log(`\n${"=".repeat(60)}`);
    console.log(`SESSION ${iteration}`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Started: ${formatTimestamp(sessionStart)}`);
    printProgressSummary(absoluteProjectDir);
    console.log();

    // Generate current_batch.json for this session
    const batchFeatures = getNextFeatures(absoluteProjectDir, 10);
    const batchPath = path.join(autonomousDir, "current_batch.json");
    fs.writeFileSync(batchPath, JSON.stringify(batchFeatures, null, 2));
    console.log(
      `Generated batch: ${batchFeatures.length} features ready for this session`
    );

    // Mark the first feature as in_progress (orchestrator handles this for reliable tracking)
    if (batchFeatures.length > 0 && batchFeatures[0].id !== undefined) {
      setFeatureStatus(absoluteProjectDir, batchFeatures[0].id, "in_progress");
      console.log(`Marked feature ${batchFeatures[0].id} as in_progress`);
    }

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

    console.log();

    // Ensure dev server is running before starting session
    console.log("[Pre-session] Checking dev server...");
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

    try {
      // Run a single agent session
      sessionStats = await runAgentSession(
        absoluteProjectDir,
        model,
        enrichedPrompt,
        agentEnv,
        featureLookup
      );

      // Verify actual completions from database (source of truth)
      const postSessionStats = getKanbanStats(absoluteProjectDir);
      const verifiedCompleted =
        postSessionStats.completed - preSessionCompleted;
      const observedCompleted = sessionStats?.featuresCompleted ?? 0;

      // Log discrepancy if observed doesn't match verified
      if (observedCompleted !== verifiedCompleted) {
        console.log(
          `\n[Verification] Observed ${observedCompleted} completions from tool calls, ` +
            `but database shows ${verifiedCompleted}. Using verified count.`
        );
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
      console.error(`\nSession ${iteration} encountered an error:`);

      // Log detailed error information
      if (error instanceof Error) {
        console.error(`  Message: ${error.message}`);
        if (error.stack) {
          console.error(`  Stack trace:\n${error.stack}`);
        }
        // Log any additional properties on the error object
        const errorObj = error as unknown as Record<string, unknown>;
        for (const key of Object.keys(errorObj)) {
          if (key !== "message" && key !== "stack" && key !== "name") {
            console.error(
              `  ${key}: ${JSON.stringify(errorObj[key], null, 2)}`
            );
          }
        }
      } else {
        console.error(`  Error: ${JSON.stringify(error, null, 2)}`);
      }

      console.log("\nRetrying after delay...");
      await sleep(5000); // Wait 5 seconds before retry

      // End session with error
      endSession(absoluteProjectDir, sessionId, {
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }

    const sessionEnd = new Date();
    const duration = sessionEnd.getTime() - sessionStart.getTime();

    console.log(`\n${"-".repeat(60)}`);
    console.log(`Finished: ${formatTimestamp(sessionEnd)}`);
    console.log(`Duration: ${formatDuration(duration)}`);
    if (sessionStats) {
      const totalTokens = sessionStats.inputTokens + sessionStats.outputTokens;
      console.log(
        `Tokens: ${formatTokens(sessionStats.inputTokens)} in / ${formatTokens(
          sessionStats.outputTokens
        )} out (${formatTokens(totalTokens)} total)`
      );
      if (sessionStats.cacheReadTokens > 0) {
        console.log(
          `Cache: ${formatTokens(
            sessionStats.cacheReadTokens
          )} read / ${formatTokens(sessionStats.cacheWriteTokens)} write`
        );
      }
      console.log(`Cost: $${sessionStats.costUsd.toFixed(2)}`);
    }
    console.log(`${"-".repeat(60)}`);

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
  const grandTotalTokens = totalStats.inputTokens + totalStats.outputTokens;

  console.log(`\n${"=".repeat(60)}`);
  console.log("COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total runtime: ${formatDuration(totalDuration)}`);
  console.log(`Sessions: ${iteration}`);
  console.log(
    `Total tokens: ${formatTokens(totalStats.inputTokens)} in / ${formatTokens(
      totalStats.outputTokens
    )} out (${formatTokens(grandTotalTokens)} total)`
  );
  if (totalStats.cacheReadTokens > 0) {
    console.log(
      `Total cache: ${formatTokens(
        totalStats.cacheReadTokens
      )} read / ${formatTokens(totalStats.cacheWriteTokens)} write`
    );
  }
  console.log(`Total cost: $${totalStats.costUsd.toFixed(2)}`);
  printProgressSummary(absoluteProjectDir);

  if (!hasIncompleteFeatures(absoluteProjectDir)) {
    console.log("\nAll features passing! Project complete.");
  } else {
    console.log(`\nStopped after ${iteration} sessions.`);
    console.log("Run again to continue from where you left off.");
  }

  // Print instructions for running the generated application
  console.log(`\n${"-".repeat(60)}`);
  console.log("TO RUN THE GENERATED APPLICATION:");
  console.log(`${"-".repeat(60)}`);
  console.log(`\n  cd ${absoluteProjectDir}`);
  console.log(`  PORT=${port} bun run dev`);
  console.log(`\n  Then open http://localhost:${port}`);
  console.log(`${"-".repeat(60)}`);
}

async function runAgentSession(
  projectDir: string,
  model: string,
  prompt: string,
  env: Record<string, string>,
  featureLookup: FeatureLookup = {}
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
  const totalInBatch = Object.keys(featureLookup).length;

  // Stream and display the response
  // Using 'any' to handle SDK type variations
  for await (const message of response) {
    const msg = message as any;

    switch (msg.type) {
      case "assistant":
        // Handle both string and array content
        if (typeof msg.content === "string") {
          process.stdout.write(msg.content);
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text") {
              process.stdout.write(block.text);
            }
          }
        }
        break;

      case "tool_call":
        // Check for feature_status MCP tool for live updates
        // Tool name is prefixed: mcp__features-db__feature_status
        if (msg.tool_name?.endsWith("feature_status") && msg.tool_input) {
          const input = msg.tool_input;
          const featureId = input.feature_id;
          const status = input.status;
          const feature = featureLookup[featureId];

          if (feature && status) {
            const statusIcon =
              status === "completed"
                ? "✓"
                : status === "in_progress"
                ? "→"
                : status === "pending"
                ? "↻"
                : "✗";
            console.log(
              `\n[${statusIcon}] Feature ${featureId}: "${feature.name}" → ${status}`
            );

            if (status === "completed") {
              completedCount++;
              stats.featuresCompleted = completedCount;
              console.log(
                `    Progress: ${completedCount}/${totalInBatch} features completed this session`
              );
            }
          } else {
            console.log(`\n[Tool: ${msg.tool_name}]`);
          }
        } else {
          console.log(`\n[Tool: ${msg.tool_name}]`);
        }
        break;

      case "tool_result":
        if (msg.error) {
          console.log(`[Error: ${msg.error}]`);
        } else {
          console.log("[Done]");
        }
        break;

      case "error":
        console.error(`\n[Agent Error: ${msg.error}]`);
        break;

      case "system":
        if (msg.subtype === "init") {
          console.log(`[Session started: ${msg.session_id}]`);
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
        break;
    }
  }

  return stats;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

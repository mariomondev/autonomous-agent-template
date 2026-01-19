/**
 * Main Agent Loop
 *
 * Runs autonomous coding sessions until all features pass or max iterations reached.
 * Agent files are stored in .autonomous/ directory.
 * Dev server runs on port 4242 to avoid conflicts.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { printProgressSummary, AUTONOMOUS_DIR } from "./progress.js";
import { getClientOptions, loadCodingPrompt } from "./client.js";
import {
  initDatabase,
  getNextFeatures,
  getProgressStats,
  startSession,
  endSession,
  resetOrphanedFeatures,
  resetStaleFeatures,
  hasIncompleteFeatures,
  getKanbanStats,
  getNotesForFeature,
  validateCategoryContiguity,
  addNote,
} from "./db.js";
// Dev server is now controlled by the agent via MCP tools
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
  force?: boolean; // Bypass circuit breaker
  headless?: boolean; // Run browser headless (default: true)
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

  // Format the batch as a nice table (all pending - agent marks them in_progress)
  const batchTable = batchFeatures
    .map((f) => `  ${f.id}: ${f.name} [pending]`)
    .join("\n");

  const total =
    stats.pending + stats.in_progress + stats.completed + stats.failed;
  const pct = total > 0 ? Math.round((stats.completed / total) * 100) : 0;

  return `
## SESSION CONTEXT

### Environment
- **Dev server:** http://localhost:${port} (YOU control it via start_server/stop_server MCP tools)
- **Project directory:** Working directory is the target project

### Your Assignment (${batchFeatures.length} features from "${category}" category)

\`\`\`
${batchTable}
\`\`\`

Start with feature ${batchFeatures[0]?.id} ("${batchFeatures[0]?.name}"). Mark it as in_progress before starting work.

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
 * Shows: duration | cost | cache info (if any)
 */
function formatSessionStats(stats: SessionStats, duration: number): string {
  const durationStr = formatDuration(duration);
  let result = `${durationStr} | $${stats.costUsd.toFixed(2)}`;

  // Show cache stats if caching is being used
  if (stats.cacheReadTokens > 0 || stats.cacheWriteTokens > 0) {
    const cacheInfo = [];
    if (stats.cacheWriteTokens > 0) {
      cacheInfo.push(`cache_write: ${stats.cacheWriteTokens}`);
    }
    if (stats.cacheReadTokens > 0) {
      cacheInfo.push(`cache_read: ${stats.cacheReadTokens}`);
    }
    result += ` | ${cacheInfo.join(", ")}`;
  }

  return result;
}

export async function runAutonomousAgent({
  projectDir,
  maxIterations,
  port,
  model,
  force,
  headless = true,
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

  // Validate category contiguity before starting
  // This catches feature generation errors early (fail-fast)
  try {
    validateCategoryContiguity(absoluteProjectDir);
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : error}`);
    console.error(`\nFix your features.sql and reload the database.`);
    process.exit(1);
  }

  // Reset any features left in 'in_progress' from crashed sessions
  const orphaned = resetOrphanedFeatures(absoluteProjectDir);
  if (orphaned > 0) {
    console.log(`Reset ${orphaned} orphaned in_progress features to pending`);
  }

  // Reset features stuck in 'in_progress' for more than 2 hours
  const stale = resetStaleFeatures(absoluteProjectDir, 2);
  if (stale > 0) {
    console.log(
      `Reset ${stale} stale features (in_progress > 2 hours) to pending`
    );
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

  // Load the coding prompt (static instructions - goes in systemPrompt for caching)
  const codingPrompt = loadCodingPrompt(port);

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

  // Circuit breaker state
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 3;

  // Main loop - continue while there are incomplete features
  while (
    hasIncompleteFeatures(absoluteProjectDir) &&
    iteration < maxIterations
  ) {
    // Circuit breaker check
    if (consecutiveFailures >= maxConsecutiveFailures && !force) {
      console.error(
        `\n[Circuit Breaker] ${consecutiveFailures} consecutive session failures.`
      );
      console.error(`Run with --force to continue, or investigate the issue.`);
      break;
    }

    iteration++;

    const sessionStart = new Date();

    // Get next batch of features (max 3 per session)
    // 3 is a balance: enough for related work, small enough to avoid context exhaustion
    const batchFeatures = getNextFeatures(absoluteProjectDir, 3);

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

    // Build session context (dynamic info: batch, progress, notes)
    // Static instructions are in systemPrompt (codingPrompt) for caching
    const kanbanStats = getKanbanStats(absoluteProjectDir);
    const sessionContext = buildSessionContext(
      absoluteProjectDir,
      batchFeatures,
      kanbanStats,
      port
    );

    // Capture pre-session completed count for verification
    const preSessionCompleted = kanbanStats.completed;

    // Note: Dev server is controlled by the agent via MCP tools (start_server/stop_server)
    // The agent will start it when needed for UI verification and stop it before editing files
    // This prevents hot-reload crashes during development

    // Create session record (do this before logging so we have the ID)
    const sessionId = startSession(absoluteProjectDir);

    // Session header with database session ID (persists across restarts)
    const progressStats = getProgressStats(absoluteProjectDir);
    const firstFeature = batchFeatures[0];
    const pct = progressStats.total > 0
      ? Math.round((progressStats.completed / progressStats.total) * 100)
      : 0;
    console.log(
      `\n[Session ${sessionId}] ${progressStats.completed}/${progressStats.total} (${pct}%) | Batch: ${batchFeatures.length} | Next: "${firstFeature?.name}"`
    );

    // Prepare environment variables for CLI commands
    const agentEnv = {
      AUTONOMOUS_PROJECT_DIR: absoluteProjectDir,
      AUTONOMOUS_SESSION_ID: String(sessionId),
      AUTONOMOUS_TEMPLATE_DIR: TEMPLATE_DIR,
      AUTONOMOUS_PORT: String(port),
      AUTONOMOUS_HEADLESS: headless ? "true" : "false",
    };

    let sessionStats: SessionStats | null = null;

    // Log file for verbose agent output (one per session for easier review)
    const logPath = path.join(
      autonomousDir,
      `session-${String(sessionId).padStart(3, "0")}.log`
    );

    try {
      // Run a single agent session
      // systemPrompt = static instructions (codingPrompt), prompt = dynamic context
      sessionStats = await runAgentSession(
        absoluteProjectDir,
        model,
        codingPrompt,
        sessionContext,
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
        console.log(
          `[Note] Tool tracking: ${observedCompleted}, DB verified: ${verifiedCompleted}`
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

      // Reset circuit breaker on success
      consecutiveFailures = 0;

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
      console.error(`\n[Session ${sessionId} Error] ${errMsg}`);

      // Increment circuit breaker counter
      consecutiveFailures++;
      console.log(
        `[Consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}]`
      );

      // Add automatic failure note so next session knows what happened
      const featureIds = batchFeatures.map((f) => f.id).join(", ");
      const failureNote = `Session ${sessionId} failed while working on feature(s) [${featureIds}]. Error: ${errMsg}. Check session-${String(sessionId).padStart(3, "0")}.log for details.`;

      try {
        // Add as global note (visible to all future sessions)
        addNote(absoluteProjectDir, {
          featureId: null,
          category: null,
          content: failureNote,
          sessionId,
        });
        console.log(`[Auto-note added for next session]`);
      } catch {
        // If we can't add the note (e.g., DB locked), continue anyway
        console.log(`[Warning: Could not add failure note to database]`);
      }

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
      console.log(
        `\n[Session ${sessionId}] ${formatSessionStats(sessionStats, duration)}`
      );
    } else {
      console.log(
        `\n[Session ${sessionId}] ${formatDuration(duration)} | failed`
      );
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
  console.log(
    `DONE | ${formatDuration(totalDuration)} | ${iteration} session${
      iteration > 1 ? "s" : ""
    } | $${totalStats.costUsd.toFixed(2)}`
  );
  console.log(`${"=".repeat(50)}`);
  console.log(
    `Features: ${finalStats.completed}/${finalStats.total} completed`
  );
  console.log(`Logs: ${path.join(autonomousDir, "session-*.log")}`);

  if (!hasIncompleteFeatures(absoluteProjectDir)) {
    console.log(`\nRun: cd ${absoluteProjectDir} && PORT=${port} bun run dev`);
  } else {
    console.log(`\nIncomplete - run again to continue.`);
  }
}

async function runAgentSession(
  projectDir: string,
  model: string,
  systemPrompt: string,
  prompt: string,
  env: Record<string, string>,
  featureLookup: FeatureLookup = {},
  logPath: string
): Promise<SessionStats> {
  // systemPrompt = static instructions (cached), prompt = dynamic session context
  const options = getClientOptions(projectDir, model, env, systemPrompt);

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
  log(
    `\n${"=".repeat(
      60
    )}\nSession started: ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`
  );

  // Stream and display the response
  // SDK Message Types (per official docs):
  // - assistant: Contains message.content[] with text and tool_use blocks
  // - result: Final stats (usage, cost, duration) with subtype for success/error
  // - system: Init info (session_id, tools, model) or compact_boundary
  // - user: User messages (not typically seen in query response)
  // - stream_event: Partial messages (only with includePartialMessages: true)
  for await (const message of response) {
    const msg = message as any;

    switch (msg.type) {
      case "assistant":
        // SDKAssistantMessage: contains message.content[] array
        // Content blocks are either {type: 'text', text} or {type: 'tool_use', name, id, input}
        const assistantMessage = msg.message;
        if (assistantMessage && Array.isArray(assistantMessage.content)) {
          for (const block of assistantMessage.content) {
            if (block.type === "text" && block.text) {
              log(block.text);
            } else if (block.type === "tool_use") {
              // Log tool use request with input
              log(`\n[Tool: ${block.name}]\n`);
              if (block.input) {
                log(`${JSON.stringify(block.input, null, 2)}\n`);
              }

              // Handle feature_status updates for live console output
              if (block.name?.endsWith("feature_status") && block.input) {
                const featureId = block.input.feature_id;
                const status = block.input.status;
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
                    `  [${statusIcon}] Feature ${featureId}: "${feature.name}" → ${status}`
                  );

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

      case "system":
        // SDKSystemMessage: subtype is 'init' or 'compact_boundary'
        if (msg.subtype === "init") {
          log(`[Session: ${msg.session_id}]\n`);
          log(`[Model: ${msg.model}]\n`);
          if (msg.mcp_servers?.length > 0) {
            const servers = msg.mcp_servers
              .map((s: any) => `${s.name}(${s.status})`)
              .join(", ");
            log(`[MCP: ${servers}]\n`);
          }
        } else if (msg.subtype === "compact_boundary") {
          log(`\n[Compaction: ${msg.compact_metadata?.trigger}, pre_tokens: ${msg.compact_metadata?.pre_tokens}]\n`);
        }
        break;

      case "result":
        // SDKResultMessage: final stats with subtype for success/error
        if (msg.usage) {
          stats.inputTokens = msg.usage.input_tokens ?? 0;
          stats.outputTokens = msg.usage.output_tokens ?? 0;
          stats.cacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
          stats.cacheWriteTokens = msg.usage.cache_creation_input_tokens ?? 0;
        }
        stats.costUsd = msg.total_cost_usd ?? 0;

        log(`\n${"=".repeat(60)}\n`);
        log(`[Result: ${msg.subtype}]\n`);
        log(`Cost: $${stats.costUsd.toFixed(2)} | Turns: ${msg.num_turns ?? 0} | Duration: ${msg.duration_ms ?? 0}ms\n`);
        log(`Tokens: ${stats.inputTokens} in, ${stats.outputTokens} out`);
        if (stats.cacheReadTokens > 0 || stats.cacheWriteTokens > 0) {
          log(` | Cache: ${stats.cacheWriteTokens} write, ${stats.cacheReadTokens} read`);
        }
        log(`\n`);

        // Log errors if present (error subtypes have errors array)
        if (msg.errors && msg.errors.length > 0) {
          console.error(`  [Session Error] ${msg.errors.join("; ")}`);
          log(`[Errors: ${msg.errors.join("; ")}]\n`);
        }

        // Log final result text if present (success subtype)
        if (msg.result) {
          log(`[Final Result: ${msg.result}]\n`);
        }
        break;

      case "user":
        // SDKUserMessage: typically not seen in query response, but log if present
        log(`\n[User Message]\n`);
        break;

      default:
        // Log unknown message types for debugging
        log(`\n[Unknown: ${msg.type}] ${JSON.stringify(msg).slice(0, 200)}\n`);
        break;
    }
  }

  logStream.end();
  return stats;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

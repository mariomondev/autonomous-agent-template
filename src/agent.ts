/**
 * Main Agent Loop
 *
 * Runs autonomous coding sessions until all features pass or max iterations reached.
 * Agent files are stored in .autonomous/ directory.
 * Dev server runs on port 4242 to avoid conflicts.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  hasFailingFeatures,
  printProgressSummary,
  AUTONOMOUS_DIR,
} from "./progress.js";
import { getClientOptions } from "./client.js";
import fs from "fs";
import path from "path";

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

interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
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

  // Check for .autonomous directory and feature_list.json
  const autonomousDir = path.join(absoluteProjectDir, AUTONOMOUS_DIR);
  const featureListPath = path.join(autonomousDir, "feature_list.json");

  if (!fs.existsSync(featureListPath)) {
    console.error(`Error: No feature_list.json found`);
    console.error(`Expected location: ${featureListPath}`);
    console.error("");
    console.error("Setup required:");
    console.error(`  1. Create ${AUTONOMOUS_DIR}/ directory in your project`);
    console.error(`  2. Add app_spec.txt with your project specification`);
    console.error(`  3. Add feature_list.json with your test cases`);
    console.error("");
    console.error("See templates/ for generator prompts and examples.");
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
  codingPrompt = codingPrompt.replace(/4242/g, String(port));

  let iteration = 0;
  const totalStart = new Date();

  // Cumulative stats across all sessions
  const totalStats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };

  // Main loop - continue while there are failing features
  while (hasFailingFeatures(absoluteProjectDir) && iteration < maxIterations) {
    iteration++;

    const sessionStart = new Date();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`SESSION ${iteration}`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Started: ${formatTimestamp(sessionStart)}`);
    printProgressSummary(absoluteProjectDir);
    console.log();

    let sessionStats: SessionStats | null = null;

    try {
      // Run a single agent session
      sessionStats = await runAgentSession(absoluteProjectDir, model, codingPrompt);

      // Accumulate stats
      if (sessionStats) {
        totalStats.inputTokens += sessionStats.inputTokens;
        totalStats.outputTokens += sessionStats.outputTokens;
        totalStats.cacheReadTokens += sessionStats.cacheReadTokens;
        totalStats.cacheWriteTokens += sessionStats.cacheWriteTokens;
        totalStats.costUsd += sessionStats.costUsd;
      }
    } catch (error) {
      console.error(`\nSession ${iteration} encountered an error:`, error);
      console.log("Retrying after delay...");
    }

    const sessionEnd = new Date();
    const duration = sessionEnd.getTime() - sessionStart.getTime();

    console.log(`\n${"-".repeat(60)}`);
    console.log(`Finished: ${formatTimestamp(sessionEnd)}`);
    console.log(`Duration: ${formatDuration(duration)}`);
    if (sessionStats) {
      const totalTokens = sessionStats.inputTokens + sessionStats.outputTokens;
      console.log(
        `Tokens: ${formatTokens(sessionStats.inputTokens)} in / ${formatTokens(sessionStats.outputTokens)} out (${formatTokens(totalTokens)} total)`
      );
      if (sessionStats.cacheReadTokens > 0) {
        console.log(`Cache: ${formatTokens(sessionStats.cacheReadTokens)} read / ${formatTokens(sessionStats.cacheWriteTokens)} write`);
      }
      console.log(`Cost: $${sessionStats.costUsd.toFixed(2)}`);
    }
    console.log(`${"-".repeat(60)}`);

    // Check if we should continue
    if (hasFailingFeatures(absoluteProjectDir) && iteration < maxIterations) {
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
    `Total tokens: ${formatTokens(totalStats.inputTokens)} in / ${formatTokens(totalStats.outputTokens)} out (${formatTokens(grandTotalTokens)} total)`
  );
  if (totalStats.cacheReadTokens > 0) {
    console.log(`Total cache: ${formatTokens(totalStats.cacheReadTokens)} read / ${formatTokens(totalStats.cacheWriteTokens)} write`);
  }
  console.log(`Total cost: $${totalStats.costUsd.toFixed(2)}`);
  printProgressSummary(absoluteProjectDir);

  if (!hasFailingFeatures(absoluteProjectDir)) {
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
  prompt: string
): Promise<SessionStats> {
  const options = getClientOptions(projectDir, model);

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
  };

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
        console.log(`\n[Tool: ${msg.tool_name}]`);
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

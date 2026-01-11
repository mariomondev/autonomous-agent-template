/**
 * Autonomous Coding Agent - CLI Entry Point
 *
 * Uses pre-authenticated Claude Code CLI (run `claude` first to authenticate).
 *
 * Usage:
 *   bun run start <project-dir> [options]
 *
 * Options:
 *   --max=<n>        Maximum iterations (default: unlimited)
 *   --port=<n>       Dev server port (default: 4242)
 *   --model=<name>   Model to use: opus, sonnet, or full model ID (default: opus)
 *
 * Examples:
 *   bun run start ./my-project
 *   bun run start ./my-project --max=10
 *   bun run start ./my-project --max=5 --port=4243
 *   bun run start ./my-project --model=sonnet --port=4244
 */

import { runAutonomousAgent } from "./agent.js";
import { execSync } from "child_process";

/**
 * Kill any process running on the specified port.
 */
function killPort(port: number): void {
  try {
    // Get PIDs using the port and kill them
    const result = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    if (result) {
      const pids = result.split("\n");
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: "ignore" });
        } catch {
          // Process might have already exited
        }
      }
      console.log(`Cleaned up process(es) on port ${port}`);
    }
  } catch {
    // No process on port, which is fine
  }
}

// Models
const MODELS: Record<string, string> = {
  opus: "claude-opus-4-5-20251101",
  sonnet: "claude-sonnet-4-5-20250929",
};

// Parse command line arguments
function parseArgs(): {
  projectDir: string;
  maxIterations: number;
  port: number;
  model: string;
  force: boolean;
} {
  const args = process.argv.slice(2);

  // Defaults
  let projectDir = "./project";
  let maxIterations = Infinity;
  let port = 4242;
  let model = MODELS.opus;
  let force = false;

  for (const arg of args) {
    if (arg.startsWith("--max=")) {
      const value = arg.slice(6);
      maxIterations = parseInt(value, 10);
      if (isNaN(maxIterations)) {
        console.error(`Invalid --max value: ${value}`);
        process.exit(1);
      }
    } else if (arg.startsWith("--port=")) {
      const value = arg.slice(7);
      port = parseInt(value, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid --port value: ${value}`);
        process.exit(1);
      }
    } else if (arg.startsWith("--model=")) {
      const value = arg.slice(8);
      // Check if it's a shorthand or full model ID
      model = MODELS[value] || value;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg.startsWith("--help") || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    } else {
      // Positional argument = project directory
      projectDir = arg;
    }
  }

  return { projectDir, maxIterations, port, model, force };
}

function printHelp(): void {
  console.log(`
Autonomous Coding Agent

Usage:
  bun run start <project-dir> [options]

Options:
  --max=<n>        Maximum iterations (default: unlimited)
  --port=<n>       Dev server port (default: 4242)
  --model=<name>   Model: opus, sonnet, or full model ID (default: opus)
  --force, -f      Bypass circuit breaker (continue despite consecutive failures)
  --help, -h       Show this help message

Examples:
  bun run start ./my-project
  bun run start ./my-project --max=10
  bun run start ./my-project --max=5 --port=4243
  bun run start ./my-project --model=sonnet --port=4244
  bun run start ./my-project --force

Models:
  opus    ${MODELS.opus}
  sonnet  ${MODELS.sonnet}
`);
}

const { projectDir, maxIterations, port, model, force } = parseArgs();

console.log("Autonomous Coding Agent");
console.log("=======================");
console.log(`Project directory: ${projectDir}`);
console.log(
  `Max iterations: ${maxIterations === Infinity ? "unlimited" : maxIterations}`
);
console.log(`Port: ${port}`);
console.log(`Model: ${model}`);
if (force) {
  console.log(`Force: enabled (circuit breaker bypassed)`);
}
console.log();

// Clean up port on startup (in case of previous orphaned server)
killPort(port);

// Register cleanup handlers
let cleanupDone = false;
function cleanup(): void {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log("\nCleaning up...");
  killPort(port);
}

// Handle keyboard interrupt gracefully
process.on("SIGINT", () => {
  console.log("\n\nInterrupted by user (Ctrl+C)");
  cleanup();
  console.log("To resume, run the same command again.");
  process.exit(0);
});

// Handle other termination signals
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  cleanup();
  process.exit(1);
});

// Run the agent
runAutonomousAgent({ projectDir, maxIterations, port, model, force })
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    cleanup();
    process.exit(1);
  });

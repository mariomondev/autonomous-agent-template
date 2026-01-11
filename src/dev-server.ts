/**
 * Dev Server Management
 *
 * Handles starting, stopping, and checking the dev server before agent sessions.
 * This ensures the environment is ready before the agent starts working.
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

export interface DevServerStatus {
  running: boolean;
  pid?: number;
  command?: string;
}

export interface DevServerOptions {
  projectDir: string;
  port: number;
  timeout?: number; // ms to wait for server to be ready
  startCommand?: string; // override default detection
}

/**
 * Check if a dev server is running on the specified port.
 */
export async function checkDevServer(port: number): Promise<DevServerStatus> {
  try {
    const { stdout } = await execAsync(`lsof -ti :${port}`);
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length > 0) {
      // Get the command for the first PID
      try {
        const { stdout: cmdOut } = await execAsync(
          `ps -p ${pids[0]} -o command=`
        );
        return {
          running: true,
          pid: parseInt(pids[0], 10),
          command: cmdOut.trim(),
        };
      } catch {
        return { running: true, pid: parseInt(pids[0], 10) };
      }
    }

    return { running: false };
  } catch {
    // lsof returns non-zero if no process found
    return { running: false };
  }
}

/**
 * Detect the appropriate dev server command for a project.
 */
export function detectDevCommand(projectDir: string): string | null {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const scripts = packageJson.scripts || {};

    // Check for common dev scripts
    if (scripts.dev) {
      // Detect package manager
      if (fs.existsSync(path.join(projectDir, "bun.lockb"))) {
        return "bun run dev";
      } else if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
        return "pnpm run dev";
      } else if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
        return "yarn dev";
      } else {
        return "npm run dev";
      }
    }

    // Check for start script as fallback
    if (scripts.start) {
      if (fs.existsSync(path.join(projectDir, "bun.lockb"))) {
        return "bun run start";
      }
      return "npm run start";
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Start the dev server in the background.
 * Returns the child process or null if failed.
 */
export async function startDevServer(
  options: DevServerOptions
): Promise<{ pid: number; logFile: string } | null> {
  const { projectDir, port, startCommand } = options;

  // Detect or use provided command
  const command = startCommand || detectDevCommand(projectDir);
  if (!command) {
    console.error(
      "[Dev Server] Could not detect dev command. No package.json or dev script found."
    );
    return null;
  }

  // Create log file for server output
  const autonomousDir = path.join(projectDir, ".autonomous");
  if (!fs.existsSync(autonomousDir)) {
    fs.mkdirSync(autonomousDir, { recursive: true });
  }
  const logFile = path.join(autonomousDir, "dev-server.log");

  // Clear previous log
  fs.writeFileSync(
    logFile,
    `--- Dev server started at ${new Date().toISOString()} ---\n`
  );

  // Silent start - logs go to dev-server.log

  // Spawn the dev server
  const [cmd, ...args] = command.split(" ");
  const child = spawn(cmd, args, {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
    },
    detached: true, // Run in background
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Pipe output to log file
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  // Unref so parent can exit independently
  child.unref();

  // Handle early exit
  child.on("error", (err) => {
    console.error(`[Dev Server] Failed to start: ${err.message}`);
  });

  return { pid: child.pid!, logFile };
}

/**
 * Wait for the dev server to be ready by polling the port.
 */
export async function waitForServer(
  port: number,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to connect to the server
      const response = await fetch(`http://localhost:${port}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });

      // Any response (even 404) means server is up
      if (response.status > 0) {
        return true;
      }
    } catch {
      // Server not ready yet, wait and retry
    }

    await sleep(intervalMs);
  }

  return false;
}

/**
 * Stop the dev server running on the specified port.
 */
export async function stopDevServer(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -ti :${port}`);
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length === 0) {
      return true; // Already stopped
    }

    // Kill all processes on the port
    for (const pid of pids) {
      try {
        await execAsync(`kill ${pid}`);
      } catch {
        // Process may have already exited
      }
    }

    // Wait a moment and verify
    await sleep(1000);
    const status = await checkDevServer(port);
    return !status.running;
  } catch {
    return true; // No process found
  }
}

/**
 * Ensure the dev server is running. Starts it if not.
 * Returns true if server is ready, false if failed.
 */
export async function ensureDevServer(
  options: DevServerOptions
): Promise<boolean> {
  const { port, timeout = 30000 } = options;

  // Check if already running
  const status = await checkDevServer(port);
  if (status.running) {
    return true;
  }

  // Start the server
  const result = await startDevServer(options);
  if (!result) {
    console.error(`[Dev Server] Failed to start. Check .autonomous/dev-server.log`);
    return false;
  }

  // Wait for it to be ready
  const ready = await waitForServer(port, timeout);
  if (!ready) {
    console.error(`[Dev Server] Timed out. Check .autonomous/dev-server.log`);
  }
  return ready;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

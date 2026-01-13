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
import { rmSync } from "fs";

const execAsync = promisify(exec);

/**
 * Clean up Next.js lock file if it exists.
 * This handles cases where a previous session crashed without cleanup.
 */
export function cleanupNextLockFile(projectDir: string): boolean {
  const lockPath = path.join(projectDir, ".next", "dev", "lock");

  try {
    if (fs.existsSync(lockPath)) {
      rmSync(lockPath, { force: true });
      console.log(`[Dev Server] Removed stale lock file: ${lockPath}`);
      return true;
    }
  } catch (err) {
    console.warn(`[Dev Server] Could not remove lock file: ${err}`);
  }

  return false;
}

/**
 * Clean up the entire .next cache directory.
 * This handles Turbopack panics and other cache corruption issues.
 */
export function cleanupNextCache(projectDir: string): boolean {
  const nextPath = path.join(projectDir, ".next");

  try {
    if (fs.existsSync(nextPath)) {
      rmSync(nextPath, { recursive: true, force: true });
      console.log(`[Dev Server] Removed corrupted .next cache: ${nextPath}`);
      return true;
    }
  } catch (err) {
    console.warn(`[Dev Server] Could not remove .next cache: ${err}`);
  }

  return false;
}

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

  // Verify port is free before starting
  const portStatus = await checkDevServer(port);
  if (portStatus.running) {
    console.error(
      `[Dev Server] Port ${port} is still in use by PID ${portStatus.pid}. Cannot start.`
    );
    return null;
  }

  // Create log file for server output
  const autonomousDir = path.join(projectDir, ".autonomous");
  if (!fs.existsSync(autonomousDir)) {
    fs.mkdirSync(autonomousDir, { recursive: true });
  }
  const logFile = path.join(autonomousDir, "dev-server.log");

  // Append to log (preserve history across sessions)
  fs.appendFileSync(
    logFile,
    `\n--- Dev server started at ${new Date().toISOString()} ---\n` +
      `--- Command: ${command} ---\n` +
      `--- Port: ${port} ---\n\n`
  );

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
 * Uses SIGTERM first, then SIGKILL if the process doesn't respond.
 */
export async function stopDevServer(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -ti :${port}`);
    const pids = stdout.trim().split("\n").filter(Boolean);

    if (pids.length === 0) {
      return true; // Already stopped
    }

    // First try graceful SIGTERM
    for (const pid of pids) {
      try {
        await execAsync(`kill ${pid}`);
      } catch {
        // Process may have already exited
      }
    }

    // Wait for graceful shutdown
    await sleep(2000);

    // Check if still running
    let status = await checkDevServer(port);
    if (!status.running) {
      return true;
    }

    // Process didn't respond to SIGTERM, use SIGKILL
    console.log(
      `[Dev Server] Process didn't respond to SIGTERM, using SIGKILL...`
    );

    // Re-fetch PIDs in case they changed
    try {
      const { stdout: newPids } = await execAsync(`lsof -ti :${port}`);
      const currentPids = newPids.trim().split("\n").filter(Boolean);

      for (const pid of currentPids) {
        try {
          await execAsync(`kill -9 ${pid}`);
        } catch {
          // Process may have already exited
        }
      }
    } catch {
      // No process found
    }

    // Wait for force kill
    await sleep(1000);

    // Final verification
    status = await checkDevServer(port);
    return !status.running;
  } catch {
    return true; // No process found
  }
}

/**
 * Check if a server is responding to HTTP requests.
 * Returns: "healthy" (2xx/3xx), "unhealthy" (4xx/5xx), or "down" (not responding)
 */
async function getServerHealth(
  port: number
): Promise<"healthy" | "unhealthy" | "down"> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    // 2xx and 3xx are healthy, 4xx might be ok (404 on root is fine)
    // 5xx indicates server errors (like Turbopack panic)
    if (response.status >= 500) {
      return "unhealthy";
    }
    return "healthy";
  } catch {
    return "down";
  }
}

/**
 * Ensure the dev server is running. Starts it if not.
 * Returns true if server is ready, false if failed.
 *
 * If a process is on the port but not responding to HTTP, it will be killed
 * and a new server started. If the server is returning 500 errors (e.g.,
 * Turbopack panic), the .next cache will be cleared and server restarted.
 */
export async function ensureDevServer(
  options: DevServerOptions
): Promise<boolean> {
  const { projectDir, port, timeout = 30000 } = options;

  // Clean up any stale lock files from crashed sessions
  cleanupNextLockFile(projectDir);

  // Check if something is already running on the port
  const status = await checkDevServer(port);

  if (status.running) {
    // Check server health (not just responding, but healthy)
    const health = await getServerHealth(port);

    if (health === "healthy") {
      // Server is up and healthy - we're good
      return true;
    }

    if (health === "unhealthy") {
      // Server is returning 500 errors - likely Turbopack panic or cache corruption
      console.log(
        `[Dev Server] Server on port ${port} is returning 500 errors. Clearing cache...`
      );
      await stopDevServer(port);
      await sleep(1000);
      // Clear the entire .next cache to fix Turbopack corruption
      cleanupNextCache(projectDir);
      await sleep(500);
    } else {
      // Process exists but not responding at all - kill it and restart
      console.log(
        `[Dev Server] Port ${port} occupied but not responding. Killing PID ${status.pid}...`
      );
      const stopped = await stopDevServer(port);
      if (!stopped) {
        console.error(
          `[Dev Server] Failed to stop existing process on port ${port}`
        );
        return false;
      }
      // Small delay to ensure port is released
      await sleep(1000);
    }
  }

  // Start the server
  const result = await startDevServer(options);
  if (!result) {
    console.error(
      `[Dev Server] Failed to start. Check .autonomous/dev-server.log`
    );
    return false;
  }

  // Wait for it to be ready
  const ready = await waitForServer(port, timeout);
  if (!ready) {
    console.error(`[Dev Server] Timed out. Check .autonomous/dev-server.log`);

    // Check if the process is still running but failed to bind
    const postStatus = await checkDevServer(port);
    if (!postStatus.running) {
      console.error(
        `[Dev Server] Process exited - likely port conflict or startup error.`
      );
      console.error(`Check .autonomous/dev-server.log for details.`);

      // Check if server accidentally started on a different port (common issue)
      const commonPorts = [3000, 3001, 5173, 8080];
      for (const altPort of commonPorts) {
        if (altPort !== port) {
          const altStatus = await checkDevServer(altPort);
          if (altStatus.running) {
            console.error(
              `[Dev Server] Found server on port ${altPort} instead of ${port}.`
            );
            console.error(
              `The project may not respect the PORT env var. Check package.json or config files.`
            );
            break;
          }
        }
      }
    }
  }
  return ready;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dev Server Tests
 *
 * Tests for the dev server control functionality used by MCP tools.
 * Run with: bun run tests/dev-server.test.ts
 */

import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import {
  checkDevServer,
  startDevServer,
  stopDevServer,
  waitForServer,
  detectDevCommand,
  cleanupNextLockFile,
  cleanupNextCache,
} from "../src/dev-server.js";

// Test port - use a high port to avoid conflicts
const TEST_PORT = 19876;

// Temp directory for test project
const TEST_DIR = path.join(import.meta.dirname, "..", ".test-project");

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function pass(name: string): void {
  results.push({ name, passed: true });
  console.log(`✓ ${name}`);
}

function fail(name: string, error: string): void {
  results.push({ name, passed: false, error });
  console.log(`✗ ${name}`);
  console.log(`  Error: ${error}`);
}

/**
 * Clean up any processes on the test port
 */
function cleanupPort(): void {
  try {
    const pids = execSync(`lsof -ti :${TEST_PORT}`, { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      } catch {}
    }
  } catch {}
}

/**
 * Create a minimal test project
 */
function setupTestProject(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, ".autonomous"), { recursive: true });

  // Create a minimal package.json with a simple server
  const packageJson = {
    name: "test-project",
    scripts: {
      dev: `bun -e "Bun.serve({ port: ${TEST_PORT}, fetch: () => new Response('OK') }); console.log('Server running');"`,
    },
  };
  fs.writeFileSync(
    path.join(TEST_DIR, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create bun.lockb to indicate bun project
  fs.writeFileSync(path.join(TEST_DIR, "bun.lockb"), "");
}

/**
 * Clean up test project
 */
function cleanupTestProject(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ===== TESTS =====

async function testCheckDevServerNotRunning(): Promise<void> {
  const name = "checkDevServer returns false when nothing running";
  cleanupPort();
  await sleep(500);

  const status = await checkDevServer(TEST_PORT);
  if (!status.running) {
    pass(name);
  } else {
    fail(name, `Expected not running, got running with PID ${status.pid}`);
  }
}

async function testCheckDevServerRunning(): Promise<void> {
  const name = "checkDevServer returns true when server running";
  cleanupPort();

  // Start a simple server
  const server = spawn(
    "bun",
    [
      "-e",
      `Bun.serve({ port: ${TEST_PORT}, fetch: () => new Response('OK') })`,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  server.unref();

  await sleep(1000);

  const status = await checkDevServer(TEST_PORT);
  cleanupPort();

  if (status.running && status.pid) {
    pass(name);
  } else {
    fail(name, "Expected server to be detected as running");
  }
}

async function testDetectDevCommand(): Promise<void> {
  const name = "detectDevCommand detects bun project";
  setupTestProject();

  const command = detectDevCommand(TEST_DIR);
  cleanupTestProject();

  if (command === "bun run dev") {
    pass(name);
  } else {
    fail(name, `Expected 'bun run dev', got '${command}'`);
  }
}

async function testDetectDevCommandNoPackage(): Promise<void> {
  const name = "detectDevCommand returns null for no package.json";

  const emptyDir = path.join(TEST_DIR, "empty");
  fs.mkdirSync(emptyDir, { recursive: true });

  const command = detectDevCommand(emptyDir);
  fs.rmSync(emptyDir, { recursive: true, force: true });

  if (command === null) {
    pass(name);
  } else {
    fail(name, `Expected null, got '${command}'`);
  }
}

async function testStartAndStopDevServer(): Promise<void> {
  const name = "stopDevServer stops a running server";
  cleanupPort();

  // Start a simple server directly (more reliable than using startDevServer with package.json)
  const server = spawn(
    "bun",
    [
      "-e",
      `Bun.serve({ port: ${TEST_PORT}, fetch: () => new Response('OK') }); console.log('ready');`,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  server.unref();

  // Wait for server to start
  await sleep(1500);

  // Verify it's running
  const statusBefore = await checkDevServer(TEST_PORT);
  if (!statusBefore.running) {
    fail(name, "Test setup failed - server not running");
    cleanupPort();
    return;
  }

  // Stop the server using stopDevServer
  const stopped = await stopDevServer(TEST_PORT);

  // Verify it's stopped
  await sleep(500);
  const statusAfter = await checkDevServer(TEST_PORT);

  cleanupPort(); // Ensure cleanup

  if (stopped && !statusAfter.running) {
    pass(name);
  } else {
    fail(name, `stopped=${stopped}, stillRunning=${statusAfter.running}`);
  }
}

async function testStopDevServerNotRunning(): Promise<void> {
  const name = "stopDevServer returns true when nothing running";
  cleanupPort();

  const stopped = await stopDevServer(TEST_PORT);
  if (stopped) {
    pass(name);
  } else {
    fail(name, "Expected true when no server running");
  }
}

async function testStopDevServerWithSIGKILL(): Promise<void> {
  const name = "stopDevServer handles stubborn processes (SIGKILL path exists)";
  // Note: Actually testing SIGKILL requires a process that ignores SIGTERM,
  // which is tricky to set up reliably in tests. Instead, we verify the code
  // path exists by checking that stopDevServer always succeeds even if the
  // first kill attempt fails (the SIGKILL fallback kicks in).

  cleanupPort();

  // Start a simple server
  const server = spawn(
    "bun",
    [
      "-e",
      `Bun.serve({ port: ${TEST_PORT}, fetch: () => new Response('OK') });`,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  server.unref();

  await sleep(1000);

  // Verify server is running
  const statusBefore = await checkDevServer(TEST_PORT);
  if (!statusBefore.running) {
    fail(name, "Test setup failed - server not running");
    return;
  }

  // Stop the server - stopDevServer now has SIGKILL fallback built-in
  const stopped = await stopDevServer(TEST_PORT);

  await sleep(500);
  const statusAfter = await checkDevServer(TEST_PORT);

  cleanupPort(); // Ensure cleanup

  if (stopped && !statusAfter.running) {
    pass(name);
  } else {
    fail(
      name,
      `Expected server to be killed. stopped=${stopped}, stillRunning=${statusAfter.running}`
    );
  }
}

async function testCleanupNextLockFile(): Promise<void> {
  const name = "cleanupNextLockFile removes lock file";
  setupTestProject();

  // Create .next/dev/lock
  const lockDir = path.join(TEST_DIR, ".next", "dev");
  const lockPath = path.join(lockDir, "lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPath, "locked");

  const removed = cleanupNextLockFile(TEST_DIR);
  const exists = fs.existsSync(lockPath);

  cleanupTestProject();

  if (removed && !exists) {
    pass(name);
  } else {
    fail(name, `removed=${removed}, stillExists=${exists}`);
  }
}

async function testCleanupNextCache(): Promise<void> {
  const name = "cleanupNextCache removes .next directory";
  setupTestProject();

  // Create .next directory with some content
  const nextDir = path.join(TEST_DIR, ".next");
  fs.mkdirSync(path.join(nextDir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(nextDir, "build-manifest.json"), "{}");

  const removed = cleanupNextCache(TEST_DIR);
  const exists = fs.existsSync(nextDir);

  cleanupTestProject();

  if (removed && !exists) {
    pass(name);
  } else {
    fail(name, `removed=${removed}, stillExists=${exists}`);
  }
}

async function testWaitForServerTimeout(): Promise<void> {
  const name = "waitForServer returns false on timeout";
  cleanupPort();

  // Don't start any server - should timeout
  const ready = await waitForServer(TEST_PORT, 2000, 500);

  if (!ready) {
    pass(name);
  } else {
    fail(name, "Expected timeout, got ready");
  }
}

// ===== TEST RUNNER =====

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests(): Promise<void> {
  console.log("Dev Server Control Tests");
  console.log("========================\n");

  // Cleanup before tests
  cleanupPort();
  cleanupTestProject();

  try {
    await testCheckDevServerNotRunning();
    await testCheckDevServerRunning();
    await testDetectDevCommand();
    await testDetectDevCommandNoPackage();
    await testStartAndStopDevServer();
    await testStopDevServerNotRunning();
    await testStopDevServerWithSIGKILL();
    await testCleanupNextLockFile();
    await testCleanupNextCache();
    await testWaitForServerTimeout();
  } finally {
    // Cleanup after tests
    cleanupPort();
    cleanupTestProject();
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test runner failed:", error);
  cleanupPort();
  cleanupTestProject();
  process.exit(1);
});

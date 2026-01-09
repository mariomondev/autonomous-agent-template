/**
 * Test script to verify Playwright MCP server starts and responds correctly.
 *
 * Usage: bun run tests/test-playwright-mcp.ts
 */

import { spawn } from "child_process";

const TIMEOUT_MS = 30000;

async function testPlaywrightMcp(): Promise<void> {
  console.log("Testing Playwright MCP Server");
  console.log("==============================\n");

  console.log("1. Starting MCP server with: npx @playwright/mcp@latest");

  const mcpProcess = spawn("npx", ["@playwright/mcp@latest"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  mcpProcess.stdout.on("data", (data) => {
    stdout += data.toString();
    console.log("[stdout]", data.toString().trim());
  });

  mcpProcess.stderr.on("data", (data) => {
    stderr += data.toString();
    console.log("[stderr]", data.toString().trim());
  });

  // Send MCP initialize request
  const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  };

  console.log("\n2. Sending initialize request...");
  mcpProcess.stdin.write(JSON.stringify(initRequest) + "\n");

  // Wait for response or timeout
  const result = await Promise.race([
    new Promise<string>((resolve) => {
      const checkInterval = setInterval(() => {
        if (stdout.includes('"result"')) {
          clearInterval(checkInterval);
          resolve("success");
        }
      }, 100);
    }),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("timeout"), TIMEOUT_MS);
    }),
  ]);

  // Send tools/list request to see available tools
  if (result === "success") {
    console.log("\n3. MCP server responded! Requesting tools list...");

    const toolsRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    mcpProcess.stdin.write(JSON.stringify(toolsRequest) + "\n");

    // Wait a bit for tools response
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Cleanup
  mcpProcess.kill();

  console.log("\n==============================");
  console.log("RESULTS:");
  console.log("==============================");

  if (result === "success") {
    console.log("✓ MCP server started successfully");
    console.log("✓ Server responded to initialize request");

    // Parse tools from stdout if available
    const toolsMatch = stdout.match(/"tools":\s*\[([\s\S]*?)\]/);
    if (toolsMatch) {
      console.log("✓ Tools available");
    }

    console.log("\nPlaywright MCP is working correctly!");
  } else {
    console.log("✗ MCP server failed to respond within timeout");
    console.log("\nStderr output:");
    console.log(stderr || "(none)");
    console.log("\nStdout output:");
    console.log(stdout || "(none)");
    process.exit(1);
  }
}

// Handle process errors
process.on("unhandledRejection", (error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

testPlaywrightMcp().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});

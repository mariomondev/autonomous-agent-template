/**
 * Claude SDK Client Configuration
 *
 * Creates and configures the Claude Agent SDK client with security settings.
 * Uses pre-authenticated Claude Code CLI for authentication.
 *
 * Project-specific instructions should be placed in CLAUDE.md in your project root.
 * Claude Code automatically reads CLAUDE.md files.
 */

import { validateBashCommand, type ValidationContext } from "./security.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Get the directory of this file (ES module equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Playwright MCP tools for browser automation
const PLAYWRIGHT_TOOLS = [
  "mcp__playwright__browser_navigate",
  "mcp__playwright__browser_screenshot",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_fill",
  "mcp__playwright__browser_select",
  "mcp__playwright__browser_hover",
  "mcp__playwright__browser_evaluate",
];

// Features database MCP tools
const FEATURES_DB_TOOLS = [
  "mcp__features-db__feature_status",
  "mcp__features-db__feature_note",
  "mcp__features-db__category_note",
  "mcp__features-db__global_note",
  "mcp__features-db__get_notes",
  "mcp__features-db__get_stats",
  "mcp__features-db__list_features",
];

// Built-in tools
const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

export function getClientOptions(
  projectDir: string,
  model: string,
  env?: Record<string, string>
) {
  const absoluteProjectDir = path.resolve(projectDir);
  const autonomousDir = path.join(absoluteProjectDir, ".autonomous");

  // Create Playwright MCP config to store output in .autonomous/playwright-mcp
  const playwrightOutputDir = path.join(autonomousDir, "playwright-mcp");
  const playwrightConfigPath = path.join(autonomousDir, "playwright-mcp.json");
  fs.mkdirSync(playwrightOutputDir, { recursive: true });
  fs.writeFileSync(
    playwrightConfigPath,
    JSON.stringify({ outputDir: playwrightOutputDir }, null, 2)
  );

  // Security config is silent - details available via --verbose flag if needed

  return {
    model,
    cwd: absoluteProjectDir,
    // Pass environment variables to child processes
    env: env ? { ...process.env, ...env } : process.env,
    // Claude Code automatically reads CLAUDE.md for project-specific instructions
    systemPrompt:
      "You are an expert full-stack developer. Follow the patterns in the existing codebase. Verify features with browser automation.",
    permissionMode: "acceptEdits" as const,
    maxTurns: 1000,
    // Debug: log stderr to see any errors
    stderr: (data: string) => console.error("[STDERR]", data),

    // MCP servers for browser testing and database operations
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest", "--config", playwrightConfigPath],
      },
      "features-db": {
        command: "bun",
        args: ["run", path.join(__dirname, "mcp-server.ts")],
        env: {
          AUTONOMOUS_PROJECT_DIR: absoluteProjectDir,
          AUTONOMOUS_SESSION_ID: String(env?.AUTONOMOUS_SESSION_ID || "0"),
          AUTONOMOUS_PORT: String(env?.AUTONOMOUS_PORT || "4242"),
        },
      },
    },

    allowedTools: [...BUILTIN_TOOLS, ...PLAYWRIGHT_TOOLS, ...FEATURES_DB_TOOLS],

    // Security hook - validates bash commands against allowlist
    canUseTool: async (toolName: string, input: Record<string, unknown>) => {
      if (toolName === "Bash") {
        const command = input.command as string;
        // Pass port context for port-scoped process management
        const validationContext: ValidationContext = {
          port: env?.AUTONOMOUS_PORT ? parseInt(env.AUTONOMOUS_PORT, 10) : undefined,
        };
        const result = validateBashCommand(command, validationContext);
        if (!result.allowed) {
          const reason = result.reason || "Command not allowed";
          console.log(`[BLOCKED] ${reason}`);
          return { behavior: "deny" as const, message: reason };
        }
      }
      return { behavior: "allow" as const, updatedInput: input };
    },
  };
}

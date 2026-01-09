/**
 * Claude SDK Client Configuration
 *
 * Creates and configures the Claude Agent SDK client with security settings.
 * Uses pre-authenticated Claude Code CLI for authentication.
 *
 * Project-specific instructions should be placed in CLAUDE.md in your project root.
 * Claude Code automatically reads CLAUDE.md files.
 */

import { validateBashCommand } from "./security.js";
import path from "path";
import fs from "fs";

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

// Built-in tools
const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

export function getClientOptions(projectDir: string, model: string) {
  const absoluteProjectDir = path.resolve(projectDir);

  // Create comprehensive security settings (defense in depth)
  // Note: Using relative paths ("./**") restricts access to project directory
  // since workingDirectory is set to projectDir
  const securitySettings = {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
    },
    permissions: {
      defaultMode: "acceptEdits",
      allow: [
        // Allow all file operations within the project directory
        "Read(./**)",
        "Write(./**)",
        "Edit(./**)",
        "Glob(./**)",
        "Grep(./**)",
        // Bash permission granted here, but actual commands are validated
        // by the canUseTool hook (see security.ts for allowed commands)
        "Bash(*)",
        // Allow Playwright MCP tools for browser automation
        ...PLAYWRIGHT_TOOLS,
      ],
    },
  };

  // Write settings to a file in the project directory
  const settingsPath = path.join(absoluteProjectDir, ".claude_settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(securitySettings, null, 2));

  console.log(`Security settings written to ${settingsPath}`);
  console.log("   - Sandbox enabled (OS-level bash isolation)");
  console.log(`   - Filesystem restricted to: ${absoluteProjectDir}`);
  console.log("   - Bash commands restricted to allowlist (see security.ts)");
  console.log("   - MCP servers: playwright (browser automation)");
  console.log("   - Project instructions: CLAUDE.md (if present)");

  return {
    model,
    cwd: absoluteProjectDir,
    // Claude Code automatically reads CLAUDE.md for project-specific instructions
    systemPrompt:
      "You are an expert full-stack developer. Follow the patterns in the existing codebase. Verify features with browser automation.",
    permissionMode: "acceptEdits" as const,
    maxTurns: 1000,
    // Debug: log stderr to see any errors
    stderr: (data: string) => console.error("[STDERR]", data),

    // Playwright MCP for browser testing (official Microsoft package)
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
      },
    },

    allowedTools: [...BUILTIN_TOOLS, ...PLAYWRIGHT_TOOLS],

    // Security hook - validates bash commands against allowlist
    canUseTool: async (toolName: string, input: Record<string, unknown>) => {
      if (toolName === "Bash") {
        const command = input.command as string;
        const result = validateBashCommand(command);
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

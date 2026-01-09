/**
 * Security Hooks for Autonomous Coding Agent
 *
 * Pre-tool-use validation for bash commands.
 * Uses an allowlist approach - only explicitly permitted commands can run.
 *
 * Defense-in-depth: This is layer 3 of 3:
 * 1. OS-level sandbox (enabled in client settings)
 * 2. Filesystem restrictions (./** relative to project dir)
 * 3. Bash command allowlist (this file)
 */

import { parse as shellParse } from "shell-quote";

// Allowed commands for development tasks
// Minimal set needed for autonomous coding
const ALLOWED_COMMANDS = new Set([
  // File inspection
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  // File operations (agent uses SDK tools for most file ops, but these are needed occasionally)
  "cp",
  "mkdir",
  "chmod", // For making scripts executable; validated separately
  "rm", // Validated separately to block recursive deletion
  // Directory
  "pwd",
  // Node.js / Bun development
  "npm",
  "node",
  "npx",
  "bun",
  "bunx",
  "pnpm",
  "yarn",
  // Version control
  "git",
  // Process management
  "ps",
  "lsof",
  "sleep",
  "pkill", // For killing dev servers; validated separately
  // Build tools
  "tsc",
  "vite",
  "next",
  // Database (for debugging/advanced queries; normal ops use CLI)
  "sqlite3",
]);

// Commands that need additional validation even when in the allowlist
const SENSITIVE_COMMANDS: Record<
  string,
  (args: string[], fullCommand: string) => { allowed: boolean; reason?: string }
> = {
  /**
   * pkill - Only allow killing dev processes
   * Must handle: pkill node, pkill -f "node server.js", pkill -9 vite
   */
  pkill: (args, _fullCommand) => {
    const allowedProcesses = [
      "node",
      "npm",
      "npx",
      "vite",
      "next",
      "pnpm",
      "yarn",
      "bun",
      "bunx",
    ];

    // Find the process name (non-flag argument)
    // Also handle -f patterns like "node server.js"
    let targetProcess: string | null = null;
    let nextIsPattern = false;

    for (const arg of args) {
      if (arg === "-f") {
        nextIsPattern = true;
        continue;
      }
      if (nextIsPattern) {
        // For -f, the pattern might be quoted like "node server.js"
        // Check if any allowed process is in the pattern
        const patternLower = arg.toLowerCase();
        const isAllowed = allowedProcesses.some(
          (proc) => patternLower === proc || patternLower.startsWith(proc + " ")
        );
        if (isAllowed) {
          return { allowed: true };
        }
        targetProcess = arg;
        nextIsPattern = false;
        continue;
      }
      // Skip flags
      if (arg.startsWith("-")) {
        continue;
      }
      // This should be the process name
      targetProcess = arg;
    }

    if (!targetProcess) {
      return { allowed: false, reason: "pkill requires a process name" };
    }

    const isAllowed = allowedProcesses.includes(targetProcess.toLowerCase());
    return {
      allowed: isAllowed,
      reason: isAllowed
        ? undefined
        : `pkill only allowed for dev processes: ${allowedProcesses.join(
            ", "
          )}. Got: ${targetProcess}`,
    };
  },

  /**
   * chmod - Only allow +x (making files executable)
   * Block: numeric modes (777, 755), -R/--recursive, other permission changes
   */
  chmod: (args, _fullCommand) => {
    // Check for blocked flags first
    const blockedFlags = ["-R", "--recursive", "-v", "--verbose"];
    for (const arg of args) {
      if (blockedFlags.includes(arg)) {
        return {
          allowed: false,
          reason: `chmod flag '${arg}' is not allowed`,
        };
      }
    }

    // Find the mode argument (not a flag, not a file path)
    let modeArg: string | null = null;
    for (const arg of args) {
      if (arg.startsWith("-")) continue;
      // Check if it looks like a mode (not a file path)
      if (!arg.includes("/") && !arg.includes(".")) {
        // Could be a mode like +x, 755, u+rwx, etc.
        modeArg = arg;
        break;
      }
      // If it starts with a mode char, it's a mode
      if (/^[ugoa+\-=rwx0-7]/.test(arg)) {
        modeArg = arg;
        break;
      }
    }

    if (!modeArg) {
      return { allowed: false, reason: "chmod requires a mode argument" };
    }

    // Block numeric modes (777, 755, etc.)
    if (/^\d+$/.test(modeArg)) {
      return {
        allowed: false,
        reason: `Numeric chmod modes (${modeArg}) are not allowed. Use +x to make files executable.`,
      };
    }

    // Only allow modes that are purely +x
    // Valid: +x, u+x, g+x, o+x, a+x, ug+x, etc.
    // Invalid: +w, +r, -x, =rwx, u+rwx
    const validPattern = /^[ugoa]*\+x$/;
    if (!validPattern.test(modeArg)) {
      return {
        allowed: false,
        reason: `chmod only allowed with +x mode (making files executable). Got: ${modeArg}`,
      };
    }

    return { allowed: true };
  },

  /**
   * rm - Block recursive deletion
   */
  rm: (args, _fullCommand) => {
    const dangerousFlags = ["-r", "-R", "--recursive", "-rf", "-fr"];
    for (const arg of args) {
      // Check exact match
      if (dangerousFlags.includes(arg)) {
        return {
          allowed: false,
          reason: `rm with '${arg}' is not allowed (recursive deletion blocked)`,
        };
      }
      // Check combined flags like -rf, -fr, -rvf, etc.
      if (arg.startsWith("-") && !arg.startsWith("--")) {
        const flags = arg.slice(1);
        if (flags.includes("r") || flags.includes("R")) {
          return {
            allowed: false,
            reason: `rm with recursive flag in '${arg}' is not allowed`,
          };
        }
      }
    }
    return { allowed: true };
  },
};

/**
 * Extract commands and their arguments from a shell command string using shell-quote.
 * Returns null if parsing fails (fail-safe: caller should block).
 */
function extractCommandsWithArgs(
  commandString: string
): { cmd: string; args: string[] }[] | null {
  try {
    const parsed = shellParse(commandString);
    const commands: { cmd: string; args: string[] }[] = [];

    let currentCmd: string | null = null;
    let currentArgs: string[] = [];
    let expectCommand = true;

    for (const token of parsed) {
      // Handle operators (pipes, &&, ||, etc.)
      if (typeof token === "object" && token !== null) {
        // shell-quote returns objects for operators like { op: '|' }
        const op = (token as { op?: string }).op;
        if (op === "|" || op === "&&" || op === "||" || op === ";") {
          // Save current command if exists
          if (currentCmd) {
            commands.push({ cmd: currentCmd, args: currentArgs });
            currentCmd = null;
            currentArgs = [];
          }
          expectCommand = true;
          continue;
        }
      }

      // Only process string tokens
      if (typeof token !== "string") {
        continue;
      }

      // Skip shell keywords
      if (
        [
          "if",
          "then",
          "else",
          "elif",
          "fi",
          "for",
          "while",
          "until",
          "do",
          "done",
          "case",
          "esac",
          "in",
          "!",
          "{",
          "}",
        ].includes(token)
      ) {
        continue;
      }

      // Skip variable assignments (VAR=value)
      if (token.includes("=") && !token.startsWith("=")) {
        continue;
      }

      if (expectCommand) {
        // Extract the base command name (handle paths like /usr/bin/python)
        currentCmd = token.split("/").pop() || token;
        currentArgs = [];
        expectCommand = false;
      } else {
        // This is an argument to the current command
        currentArgs.push(token);
      }
    }

    // Don't forget the last command
    if (currentCmd) {
      commands.push({ cmd: currentCmd, args: currentArgs });
    }

    return commands.length > 0 ? commands : null;
  } catch {
    // Parsing failed - return null to trigger block
    return null;
  }
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a bash command against the allowlist.
 */
export function validateBashCommand(command: string): ValidationResult {
  if (!command?.trim()) {
    return { allowed: false, reason: "Empty command" };
  }

  // Extract all commands from the command string using shell-quote
  const commandsWithArgs = extractCommandsWithArgs(command);

  // Fail-safe: if we can't parse, block
  if (commandsWithArgs === null) {
    return {
      allowed: false,
      reason: `Could not parse command (possible injection attempt): ${command.slice(
        0,
        100
      )}`,
    };
  }

  // Check each command against the allowlist
  for (const { cmd, args } of commandsWithArgs) {
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return {
        allowed: false,
        reason: `Command '${cmd}' is not in the allowed commands list`,
      };
    }

    // Additional validation for sensitive commands
    if (SENSITIVE_COMMANDS[cmd]) {
      const result = SENSITIVE_COMMANDS[cmd](args, command);
      if (!result.allowed) {
        return { allowed: false, reason: result.reason };
      }
    }
  }

  return { allowed: true };
}

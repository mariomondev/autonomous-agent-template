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
  "mv",
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
  "pkill", // For killing dev servers; validated separately to require port-specific patterns
  "kill", // For use with lsof: lsof -ti :PORT | xargs kill
  "xargs", // For piping: lsof -ti :PORT | xargs kill
  // Build tools
  "tsc",
  "vite",
  "next",
]);

// Forward declaration for ValidationContext (defined below)
interface SensitiveCommandContext {
  port?: number;
}

// Commands that need additional validation even when in the allowlist
const SENSITIVE_COMMANDS: Record<
  string,
  (
    args: string[],
    fullCommand: string,
    context?: SensitiveCommandContext
  ) => { allowed: boolean; reason?: string }
> = {
  /**
   * git - Validate commit message format
   * Only applies to commit commands. Enforces single-line commits (can be detailed).
   * Blocks: heredocs, Co-Authored-By, Feature: references, multi-line messages
   */
  git: (_args, fullCommand) => {
    // Only validate commit commands
    if (!fullCommand.includes("commit")) {
      return { allowed: true };
    }

    // Block heredocs (cat <<EOF, cat <<'EOF')
    if (fullCommand.includes("<<")) {
      return {
        allowed: false,
        reason:
          'Heredocs not allowed. Use: git commit -m "single line message"',
      };
    }

    // Block Co-Authored-By tags
    if (/co-authored-by/i.test(fullCommand)) {
      return {
        allowed: false,
        reason: "Co-Authored-By tags not allowed in commits.",
      };
    }

    // Block Feature: references
    if (/feature:\s*#?\d+/i.test(fullCommand)) {
      return {
        allowed: false,
        reason: "Feature references not allowed in commits.",
      };
    }

    // Only allow single -m flag (one line)
    // Match -m followed by space, quote, or end (handles -m "msg", -m"msg", -m 'msg')
    const mFlagCount = (fullCommand.match(/-m[\s"']/g) || []).length;
    if (mFlagCount > 1) {
      return {
        allowed: false,
        reason:
          "Only single -m flag allowed. Use one detailed line instead of multiple -m flags.",
      };
    }

    // Block newlines in the message
    if (fullCommand.includes("\\n") || /\n/.test(fullCommand)) {
      return {
        allowed: false,
        reason:
          "Newlines not allowed. Use a single detailed line for the commit message.",
      };
    }

    // Ensure commit uses -m flag (not --message with file or stdin)
    if (
      fullCommand.includes("commit") &&
      !fullCommand.includes("-m") &&
      !fullCommand.includes("--amend") &&
      !fullCommand.includes("--no-edit")
    ) {
      if (!fullCommand.includes("--allow-empty")) {
        return {
          allowed: false,
          reason: "Commits must use -m flag.",
        };
      }
    }

    return { allowed: true };
  },

  /**
   * pkill - Only allow killing processes on the session's port
   * Requires -f flag with a pattern containing the port number.
   * This prevents killing unrelated processes on the system.
   *
   * Allowed: pkill -f ".*:4242.*", pkill -f "PORT=4242"
   * Blocked: pkill node, pkill -f "node" (too broad)
   */
  pkill: (args, _fullCommand, context) => {
    const port = context?.port;

    // Must use -f flag for pattern matching
    const hasFFlag = args.includes("-f");
    if (!hasFFlag) {
      return {
        allowed: false,
        reason:
          "pkill must use -f flag with a port-specific pattern. Use: pkill -f '.*:PORT.*' or 'lsof -ti :PORT | xargs kill'",
      };
    }

    // Find the pattern argument (comes after -f or other flags)
    let pattern: string | null = null;
    let nextIsPattern = false;

    for (const arg of args) {
      if (arg === "-f") {
        nextIsPattern = true;
        continue;
      }
      if (nextIsPattern && !arg.startsWith("-")) {
        pattern = arg;
        break;
      }
      // Skip other flags like -9, -TERM, etc.
      if (arg.startsWith("-")) {
        continue;
      }
      // Non-flag after -f is the pattern
      if (nextIsPattern) {
        pattern = arg;
        break;
      }
    }

    if (!pattern) {
      return {
        allowed: false,
        reason: "pkill -f requires a pattern argument",
      };
    }

    // If we have a port context, the pattern must contain it
    if (port) {
      const portStr = String(port);
      if (!pattern.includes(portStr)) {
        return {
          allowed: false,
          reason: `pkill pattern must include the session port (${port}) to avoid killing unrelated processes. Use: pkill -f '.*:${port}.*' or 'lsof -ti :${port} | xargs kill'`,
        };
      }
      return { allowed: true };
    }

    // No port context - be restrictive, only allow if pattern looks port-specific
    // Pattern should contain a colon followed by digits (port pattern)
    if (/:\d+/.test(pattern) || /PORT=\d+/.test(pattern)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason:
        "pkill pattern must be port-specific (e.g., '.*:4242.*'). Use 'lsof -ti :PORT | xargs kill' for safer process termination.",
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
   * rm - Block recursive deletion and protected files
   */
  rm: (args, _fullCommand, context) => {
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

    // Check protected files
    for (const arg of args) {
      if (!arg.startsWith("-")) {
        if (isProtectedPath(arg, context)) {
          return {
            allowed: false,
            reason: `Cannot delete protected file: ${arg}`,
          };
        }
      }
    }

    return { allowed: true };
  },

  /**
   * cp - Block overwriting protected files
   */
  cp: (args, _fullCommand, context) => {
    // Get non-flag arguments (source(s) and destination)
    const nonFlags = args.filter((a) => !a.startsWith("-"));
    // Last arg is destination
    const destination = nonFlags[nonFlags.length - 1];

    if (destination && isProtectedPath(destination, context)) {
      return {
        allowed: false,
        reason: `Cannot overwrite protected file: ${destination}`,
      };
    }

    return { allowed: true };
  },

  /**
   * mv - Block moving or overwriting protected files
   */
  mv: (args, _fullCommand, context) => {
    // Get non-flag arguments (source(s) and destination)
    const nonFlags = args.filter((a) => !a.startsWith("-"));
    const source = nonFlags[0];
    const destination = nonFlags[nonFlags.length - 1];

    // Can't move a protected file
    if (source && isProtectedPath(source, context)) {
      return {
        allowed: false,
        reason: `Cannot move protected file: ${source}`,
      };
    }

    // Can't overwrite a protected file
    if (destination && isProtectedPath(destination, context)) {
      return {
        allowed: false,
        reason: `Cannot overwrite protected file: ${destination}`,
      };
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

      // Skip variable assignments (VAR=value) only at command position
      // e.g., "PORT=4242 bun run dev" - PORT=4242 is an assignment, bun is the command
      // But don't skip if we're collecting arguments (e.g., pkill -f 'PORT=4242')
      if (expectCommand && token.includes("=") && !token.startsWith("=")) {
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

export interface ValidationContext {
  port?: number;
  protectedFiles?: string[];
  protectedPatterns?: string[];
}

/**
 * Check if a path matches a simple glob pattern.
 * Supports * (match any chars) and basic matching.
 */
function matchSimpleGlob(pattern: string, str: string): boolean {
  // Convert glob to regex: * becomes .*, escape other special chars
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except *
    .replace(/\*/g, ".*"); // * becomes .*
  return new RegExp(`^${regexPattern}$`).test(str);
}

/**
 * Check if a path is protected based on the validation context.
 */
function isProtectedPath(
  targetPath: string,
  context?: ValidationContext
): boolean {
  if (!context?.protectedFiles && !context?.protectedPatterns) return false;

  // Normalize path (remove ./ prefix)
  const normalizedPath = targetPath.replace(/^\.\//, "");
  const basename = normalizedPath.split("/").pop() || normalizedPath;

  // Check exact matches against protected files
  if (context.protectedFiles) {
    if (context.protectedFiles.includes(normalizedPath)) return true;
    if (context.protectedFiles.includes(basename)) return true;
  }

  // Check patterns
  if (context.protectedPatterns) {
    for (const pattern of context.protectedPatterns) {
      if (matchSimpleGlob(pattern, normalizedPath)) return true;
      if (matchSimpleGlob(pattern, basename)) return true;
    }
  }

  return false;
}

/**
 * Validate a bash command against the allowlist.
 * @param command The bash command to validate
 * @param context Optional context with session-specific info (e.g., port)
 */
export function validateBashCommand(
  command: string,
  context?: ValidationContext
): ValidationResult {
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
      const result = SENSITIVE_COMMANDS[cmd](args, command, context);
      if (!result.allowed) {
        return { allowed: false, reason: result.reason };
      }
    }
  }

  return { allowed: true };
}

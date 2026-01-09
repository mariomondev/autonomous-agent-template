#!/usr/bin/env bun
/**
 * CLI for database operations - called by the agent during execution.
 *
 * Environment variables (set by orchestrator):
 *   AUTONOMOUS_PROJECT_DIR  - Path to target project
 *   AUTONOMOUS_SESSION_ID   - Current session ID
 *
 * Usage:
 *   bun run src/cli.ts status <feature_id> <status>
 *   bun run src/cli.ts note <feature_id> "note content"
 *   bun run src/cli.ts note --category=<cat> "note content"
 *   bun run src/cli.ts note --global "note content"
 *   bun run src/cli.ts notes <feature_id> [category]
 *   bun run src/cli.ts stats [--by-category]
 *   bun run src/cli.ts list [status] [--limit=N]
 *
 * Errors are logged to .autonomous/errors.txt
 */

import {
  setFeatureStatus,
  markFeatureForRetry,
  addNote,
  getNotesForFeature,
  getKanbanStats,
  getFeaturesByStatus,
  type FeatureStatus,
} from "./db.js";
import fs from "fs";
import path from "path";

const projectDir = process.env.AUTONOMOUS_PROJECT_DIR;
const sessionId = parseInt(process.env.AUTONOMOUS_SESSION_ID || "0", 10);
const MAX_RETRIES = 3;

/**
 * Log an error to .autonomous/errors.txt
 */
function logError(message: string, context?: Record<string, unknown>): void {
  if (!projectDir) return;

  const errorsPath = path.join(projectDir, ".autonomous", "errors.txt");
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` | ${JSON.stringify(context)}` : "";
  const logLine = `[${timestamp}] ${message}${contextStr}\n`;

  try {
    fs.appendFileSync(errorsPath, logLine);
  } catch {
    // Silently fail if we can't write to errors file
  }
}

if (!projectDir) {
  console.error("Error: AUTONOMOUS_PROJECT_DIR not set");
  logError("AUTONOMOUS_PROJECT_DIR not set", { args: process.argv });
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

try {
switch (command) {
  case "status": {
    const [featureIdStr, status] = args;
    const featureId = parseInt(featureIdStr, 10);

    if (isNaN(featureId)) {
      console.error("Error: Invalid feature ID");
      logError("Invalid feature ID in status command", { featureIdStr, status, command: "status" });
      process.exit(1);
    }

    if (status === "pending") {
      // This is a retry - increment count and maybe auto-fail
      const result = markFeatureForRetry(projectDir, featureId, MAX_RETRIES);
      if (result.status === "failed") {
        console.log(
          `Feature ${featureId} -> FAILED (exceeded ${MAX_RETRIES} retries)`
        );
      } else {
        console.log(
          `Feature ${featureId} -> pending (retry ${result.retryCount}/${MAX_RETRIES})`
        );
      }
    } else if (["in_progress", "completed"].includes(status)) {
      setFeatureStatus(projectDir, featureId, status as FeatureStatus);
      console.log(`Feature ${featureId} -> ${status}`);
    } else {
      console.error(
        `Error: Invalid status '${status}'. Use: pending, in_progress, completed`
      );
      logError("Invalid status in status command", { featureId, status, command: "status" });
      process.exit(1);
    }
    break;
  }

  case "note": {
    // Parse flags and content
    let featureId: number | null = null;
    let category: string | null = null;
    let content = "";

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--category=")) {
        category = arg.slice(11);
      } else if (arg === "--global") {
        // Both null = global (default)
      } else if (arg.startsWith("--")) {
        console.error(`Error: Unknown flag '${arg}'`);
        logError("Unknown flag in note command", { flag: arg, args, command: "note" });
        process.exit(1);
      } else if (featureId === null && !isNaN(parseInt(arg, 10))) {
        featureId = parseInt(arg, 10);
      } else {
        // Everything else is content
        content = args.slice(i).join(" ");
        break;
      }
    }

    if (!content) {
      console.error("Error: Note content is required");
      logError("Note content missing", { featureId, category, args, command: "note" });
      process.exit(1);
    }

    addNote(projectDir, { featureId, category, content, sessionId });

    const scope = featureId
      ? `feature ${featureId}`
      : category
      ? `category '${category}'`
      : "global";
    console.log(`Note added (${scope})`);
    break;
  }

  case "notes": {
    const [featureIdStr, categoryArg] = args;
    const featureId = featureIdStr ? parseInt(featureIdStr, 10) : null;
    const category = categoryArg || null;

    const notes = getNotesForFeature(projectDir, featureId, category);

    if (notes.length === 0) {
      console.log("No notes found");
    } else {
      for (const note of notes) {
        const scope = note.feature_id
          ? `[feature ${note.feature_id}]`
          : note.category
          ? `[${note.category}]`
          : "[global]";
        console.log(`${scope} ${note.content}`);
      }
    }
    break;
  }

  case "stats": {
    const stats = getKanbanStats(projectDir);
    console.log("Feature Status Summary:");
    console.log(`  pending:     ${stats.pending}`);
    console.log(`  in_progress: ${stats.in_progress}`);
    console.log(`  completed:   ${stats.completed}`);
    console.log(`  failed:      ${stats.failed}`);
    console.log(`  total:       ${stats.pending + stats.in_progress + stats.completed + stats.failed}`);

    if (args.includes("--by-category")) {
      console.log("\nBy Category:");
      for (const cat of stats.byCategory) {
        console.log(`  ${cat.category}: ${cat.completed}/${cat.pending + cat.in_progress + cat.completed + cat.failed} completed`);
      }
    }
    break;
  }

  case "list": {
    const statusFilter = args[0] as FeatureStatus | undefined;
    const limitArg = args.find((a) => a.startsWith("--limit="));
    const limit = limitArg ? parseInt(limitArg.slice(8), 10) : 10;

    if (statusFilter && !["pending", "in_progress", "completed", "failed"].includes(statusFilter)) {
      console.error(`Error: Invalid status '${statusFilter}'. Use: pending, in_progress, completed, failed`);
      logError("Invalid status in list command", { statusFilter, args, command: "list" });
      process.exit(1);
    }

    const features = statusFilter
      ? getFeaturesByStatus(projectDir, statusFilter)
      : getFeaturesByStatus(projectDir, "pending");

    const displayed = features.slice(0, limit);
    const remaining = features.length - displayed.length;

    if (displayed.length === 0) {
      console.log(`No features with status '${statusFilter || "pending"}'`);
    } else {
      for (const f of displayed) {
        console.log(`${f.id}: ${f.name} [${f.status}]`);
      }
      if (remaining > 0) {
        console.log(`... and ${remaining} more`);
      }
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage:");
    console.error("  status <feature_id> <status>     - Update feature status");
    console.error('  note <feature_id> "content"      - Add note for feature');
    console.error('  note --category=<cat> "content"  - Add note for category');
    console.error('  note --global "content"          - Add global note');
    console.error("  notes <feature_id> [category]    - Get notes");
    console.error("  stats [--by-category]            - Show feature counts by status");
    console.error("  list [status] [--limit=N]        - List features (default: pending, limit 10)");
    logError("Unknown command", { command, args });
    process.exit(1);
}
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  logError(`Unhandled error: ${message}`, {
    command,
    args,
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
}

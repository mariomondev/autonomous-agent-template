#!/usr/bin/env bun
/**
 * MCP Server for Features Database Operations
 *
 * This server exposes tools for the inner agent to interact with the features database.
 * It replaces the CLI interface with structured MCP tools that are easier for LLMs to use.
 *
 * Environment variables (set by orchestrator):
 *   AUTONOMOUS_PROJECT_DIR  - Path to target project
 *   AUTONOMOUS_SESSION_ID   - Current session ID
 *
 * Usage:
 *   bun run src/mcp-server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  setFeatureStatus,
  markFeatureForRetry,
  addNote,
  getNotesForFeature,
  getKanbanStats,
  getFeaturesByStatus,
  type FeatureStatus,
} from "./db.js";

const projectDir = process.env.AUTONOMOUS_PROJECT_DIR;
const sessionId = parseInt(process.env.AUTONOMOUS_SESSION_ID || "0", 10);
const MAX_RETRIES = 3;

if (!projectDir) {
  console.error("Error: AUTONOMOUS_PROJECT_DIR not set");
  process.exit(1);
}

// Create the MCP server
const server = new McpServer({
  name: "features-db",
  version: "1.0.0",
});

// Register tools

server.registerTool(
  "feature_status",
  {
    description:
      "Update the status of a feature. Use 'in_progress' when starting work, 'completed' when done, or 'pending' to retry (max 3 retries before auto-fail).",
    inputSchema: {
      feature_id: z
        .number()
        .describe("The numeric ID of the feature to update"),
      status: z
        .enum(["in_progress", "completed", "pending"])
        .describe(
          "The new status: 'in_progress' (starting work), 'completed' (tests pass), 'pending' (retry needed)"
        ),
    },
  },
  async ({ feature_id, status }) => {
    if (status === "pending") {
      // This is a retry - increment count and maybe auto-fail
      const result = markFeatureForRetry(projectDir, feature_id, MAX_RETRIES);
      if (result.status === "failed") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Feature ${feature_id} marked as FAILED (exceeded ${MAX_RETRIES} retries). This feature will not be retried again.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `Feature ${feature_id} marked for retry (attempt ${result.retryCount}/${MAX_RETRIES})`,
            },
          ],
        };
      }
    } else {
      setFeatureStatus(projectDir, feature_id, status as FeatureStatus);
      return {
        content: [
          {
            type: "text" as const,
            text: `Feature ${feature_id} status updated to '${status}'`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  "feature_note",
  {
    description:
      "Add a note to a specific feature for future sessions to reference",
    inputSchema: {
      feature_id: z.number().describe("The numeric ID of the feature"),
      content: z.string().describe("The note content"),
    },
  },
  async ({ feature_id, content }) => {
    addNote(projectDir, {
      featureId: feature_id,
      category: null,
      content,
      sessionId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Note added for feature ${feature_id}`,
        },
      ],
    };
  }
);

server.registerTool(
  "category_note",
  {
    description: "Add a note that applies to all features in a category",
    inputSchema: {
      category: z
        .string()
        .describe("The category name (e.g., 'auth', 'ui', 'api')"),
      content: z.string().describe("The note content"),
    },
  },
  async ({ category, content }) => {
    addNote(projectDir, {
      featureId: null,
      category,
      content,
      sessionId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Note added for category '${category}'`,
        },
      ],
    };
  }
);

server.registerTool(
  "global_note",
  {
    description: "Add a global note that all future sessions will see",
    inputSchema: {
      content: z.string().describe("The note content"),
    },
  },
  async ({ content }) => {
    addNote(projectDir, {
      featureId: null,
      category: null,
      content,
      sessionId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: "Global note added",
        },
      ],
    };
  }
);

server.registerTool(
  "get_notes",
  {
    description:
      "Get notes for a specific feature, category, or all global notes",
    inputSchema: {
      feature_id: z
        .number()
        .optional()
        .describe("Optional: The feature ID to get notes for"),
      category: z
        .string()
        .optional()
        .describe("Optional: The category to get notes for"),
    },
  },
  async ({ feature_id, category }) => {
    const notes = getNotesForFeature(
      projectDir,
      feature_id ?? null,
      category ?? null
    );

    if (notes.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No notes found",
          },
        ],
      };
    }

    const formattedNotes = notes
      .map((note) => {
        const scope = note.feature_id
          ? `[feature ${note.feature_id}]`
          : note.category
          ? `[${note.category}]`
          : "[global]";
        return `${scope} ${note.content}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: formattedNotes,
        },
      ],
    };
  }
);

server.registerTool(
  "get_stats",
  {
    description:
      "Get a summary of feature counts by status (pending, in_progress, completed, failed)",
    inputSchema: {
      by_category: z
        .boolean()
        .optional()
        .describe("If true, include breakdown by category"),
    },
  },
  async ({ by_category }) => {
    const stats = getKanbanStats(projectDir);
    const total =
      stats.pending + stats.in_progress + stats.completed + stats.failed;

    let output = `Feature Status Summary:\n`;
    output += `  pending:     ${stats.pending}\n`;
    output += `  in_progress: ${stats.in_progress}\n`;
    output += `  completed:   ${stats.completed}\n`;
    output += `  failed:      ${stats.failed}\n`;
    output += `  total:       ${total}`;

    if (by_category && stats.byCategory.length > 0) {
      output += `\n\nBy Category:`;
      for (const cat of stats.byCategory) {
        const catTotal =
          cat.pending + cat.in_progress + cat.completed + cat.failed;
        output += `\n  ${cat.category}: ${cat.completed}/${catTotal} completed`;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: output,
        },
      ],
    };
  }
);

server.registerTool(
  "list_features",
  {
    description: "List features filtered by status",
    inputSchema: {
      status: z
        .enum(["pending", "in_progress", "completed", "failed"])
        .optional()
        .describe("Filter by status (default: pending)"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of features to return (default: 10)"),
    },
  },
  async ({ status, limit }) => {
    const statusFilter = status ?? "pending";
    const maxResults = limit ?? 10;

    const features = getFeaturesByStatus(projectDir, statusFilter);
    const displayed = features.slice(0, maxResults);
    const remaining = features.length - displayed.length;

    if (displayed.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No features with status '${statusFilter}'`,
          },
        ],
      };
    }

    let output = displayed
      .map((f) => `${f.id}: ${f.name} [${f.status}]`)
      .join("\n");

    if (remaining > 0) {
      output += `\n... and ${remaining} more`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: output,
        },
      ],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

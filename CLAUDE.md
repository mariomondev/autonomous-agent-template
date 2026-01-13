# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a harness for running long-running autonomous coding sessions with the Claude Agent SDK. It orchestrates an inner Claude Code agent that implements features in a target project, tracks progress in SQLite, and verifies features with Playwright browser automation.

## Commands

```bash
# Install dependencies
bun install

# Run the autonomous agent on a target project
bun run start ./path/to/project [options]
#   --max=<n>        Max iterations (default: unlimited)
#   --port=<n>       Dev server port (default: 4242)
#   --model=<name>   opus, sonnet, or full model ID (default: opus)
#   --force          Bypass circuit breaker (continue despite failures)

# Run tests
bun run test

# Type check
bun run build
```

## Architecture

The system has two layers:
1. **Orchestrator** (this repo) - manages sessions, tracks features in SQLite, spawns inner agents
2. **Inner Agent** (Claude Code) - implements features in the target project, uses Playwright for verification

### Key Files

- `src/index.ts` - CLI entry point, parses args, handles cleanup
- `src/agent.ts` - Main loop: queries DB for features, spawns agent sessions, tracks stats
- `src/client.ts` - Claude Agent SDK configuration with security hooks and MCP setup
- `src/security.ts` - Bash command allowlist validation (defense layer 3 of 3)
- `src/db.ts` - SQLite operations for features, sessions, and notes (uses `bun:sqlite`)
- `src/mcp-server.ts` - MCP server exposing database + dev server control tools to inner agent
- `src/dev-server.ts` - Dev server lifecycle (start/stop/health check)
- `src/progress.ts` - Progress tracking utilities and display

### Data Flow

1. Orchestrator reads `<project>/.autonomous/db.sqlite` for pending features
2. Generates `current_batch.json` with up to 5 features from one category
3. Spawns inner agent with `prompts/coding_prompt.md` as instructions
4. Inner agent controls dev server via MCP tools (stop before edits, start before verification)
5. Inner agent implements features, verifies with Playwright, updates status via MCP
6. Session ends when batch complete or max turns reached
7. Loop continues until all features complete

### Security Model (3 layers)

1. **OS sandbox** - Bash runs in isolated environment
2. **Filesystem restrictions** - Operations restricted to project directory
3. **Bash allowlist** - Only permitted commands can run (see `security.ts`)

### Target Project Structure

The orchestrator expects this in the target project:
```
target-project/
├── .autonomous/
│   ├── app_spec.txt        # What to build
│   ├── db.sqlite           # Feature tracking (features, notes, sessions tables)
│   └── current_batch.json  # Generated each session
└── ... project code
```

## TypeScript

- Uses Bun runtime with `bun:sqlite` for database
- ES2022 target with NodeNext modules
- Strict mode enabled

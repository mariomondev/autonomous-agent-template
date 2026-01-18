# Autonomous Agent Template

A minimal harness for running long-running autonomous coding sessions with the Claude Agent SDK.

## Prerequisites

- [Bun](https://bun.sh/)
- Claude Code CLI authenticated (`claude` to login)
- `sqlite3` CLI (pre-installed on macOS/Linux)

## Quick Demo

Test the template with the included counter app example:

```bash
bun install
bun reset:temp      # Reset to skeleton (empty app)
bun run start:temp  # Watch the agent implement 3 features
```

The agent will implement a counter app from scratch: display, increment button, decrement button. View detailed logs at `temp/.autonomous/session-*.log`.

---

## Usage

```bash
# Run on your project
bun run start ./your-project [options]

# Options:
#   --max=<n>          Max iterations (default: unlimited)
#   --port=<n>         Dev server port (default: 4242)
#   --model=<name>     opus, sonnet, or full model ID (default: opus)
#   --headless=<bool>  Run browser headless (default: true)
#   --force            Bypass circuit breaker (continue despite failures)
```

---

## Setup Your Project

```
your-project/
├── .autonomous/
│   ├── app_spec.txt       # What to build (Step 1)
│   └── features.sql       # Feature list (Step 2)
├── CLAUDE.md              # Project patterns (optional)
└── ... your code
```

### Step 1: Generate `app_spec.txt`

Use `templates/app_spec_generator.md` with any LLM. Save output to `.autonomous/app_spec.txt`

### Step 2: Generate `features.sql`

Use `templates/feature_list_generator.md` with any LLM. Save output to `.autonomous/features.sql`

### Step 3: Initialize & Run

```bash
bun run init ./your-project   # Creates db.sqlite from features.sql
bun run start ./your-project  # Start the agent
```

---

## How It Works

```
SETUP                          ORCHESTRATOR                    INNER AGENT
─────                          ────────────                    ───────────
app_spec.txt ──┐
               ├─→ db.sqlite ─→ Get next batch ─────────────→ Read spec & code
features.sql ──┘               (3 features,                   Stop server
                               same category)                  Write code
                                     │                         Start server
                                     │                         Verify with Playwright
                               Track completion ←───────────── Update status via MCP
                                     │                         Git commit
                                     ↓                              │
                               Next batch or done ←─────────────────┘
```

### Orchestrator Loop

1. **Validate** — Check category contiguity (fail fast if features malformed)
2. **Batch** — Get up to 3 pending features from category with lowest ID
3. **Spawn** — Run inner agent with batch + context + notes from previous sessions
4. **Track** — Monitor feature completions, capture cost/tokens
5. **Recover** — On failure, add automatic note for next session
6. **Repeat** — Continue until all features complete or circuit breaker trips

### Inner Agent (per session)

1. Read `app_spec.txt` and explore existing code
2. Implement features **in strict ID order** (dependencies)
3. Stop server → edit code → start server → verify with Playwright
4. Mark features completed/pending via MCP tools
5. Commit progress, end session

### Safety Mechanisms

| Mechanism | Purpose |
|-----------|---------|
| Category contiguity validation | Prevents features running out of order |
| Circuit breaker (3 failures) | Stops runaway failures |
| Automatic failure notes | Preserves context across crashes |
| Orphan/stale reset | Unsticks abandoned features |
| Retry limit (3 attempts) | Auto-fails stuck features |
| Bash allowlist | Blocks dangerous commands |

---

## Security Model

Three layers:
1. **OS Sandbox** - Isolated bash environment
2. **Filesystem** - Restricted to project directory
3. **Bash Allowlist** - Only permitted commands run + protected files (`.autonomous/protected-files.json`)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No database | `bun run init ./your-project` |
| Auth error | Run `claude` to re-authenticate |
| Port in use | `lsof -ti:4242 \| xargs kill` (or use `--port=<other>`) |
| Check status | `sqlite3 .autonomous/db.sqlite "SELECT status, COUNT(*) FROM features GROUP BY status"` |
| Reset failed | `sqlite3 .autonomous/db.sqlite "UPDATE features SET status='pending', retry_count=0 WHERE status='failed'"` |

---

## License

MIT

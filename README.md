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

The agent will implement a counter app from scratch: display, increment button, decrement button. View detailed logs at `temp/.autonomous/session.log`.

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

1. Queries `db.sqlite` for next batch of features (max 5 from same category)
2. Starts dev server on port 4242
3. Implements features following your patterns
4. Verifies with Playwright browser automation (headless by default)
5. Updates feature status via MCP tools
6. Repeats until all features complete

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

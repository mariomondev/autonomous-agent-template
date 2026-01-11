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
#   --max=<n>      Max iterations (default: unlimited)
#   --port=<n>     Dev server port (default: 4242)
#   --model=<name> opus, sonnet, or full model ID (default: opus)
```

---

## Setup Your Project

Create `.autonomous/` in your project:

```
your-project/
├── .autonomous/
│   ├── app_spec.txt       # What to build
│   └── features.sql       # Feature definitions
├── CLAUDE.md              # Project patterns (optional)
└── ... your code
```

### 1. Create `app_spec.txt`

Describe what to build. Use `templates/app_spec_generator.md` with Claude, or write manually.

### 2. Create Feature Database

```bash
# Generate features.sql using templates/feature_list_generator.md
# Then initialize:
sqlite3 .autonomous/db.sqlite < .autonomous/features.sql
```

**Feature format:**
```sql
INSERT INTO features (id, name, description, category, testing_steps, status) VALUES
(1, 'User login', 'Users can authenticate', 'auth', '["Navigate to /login", "Fill form", "Click Login"]', 'pending');
```

### 3. Optional: Add `CLAUDE.md`

```markdown
# CLAUDE.md

## Stack
- Next.js 14 with App Router
- Tailwind CSS + shadcn/ui

## Patterns
- Server Actions in src/actions/
- Components in src/components/
```

---

## How It Works

1. Queries `db.sqlite` for next batch of features (max 10 from same category)
2. Starts dev server on port 4242
3. Implements features following your patterns
4. Verifies with Playwright browser automation
5. Updates feature status via MCP tools
6. Repeats until all features complete

---

## Security Model

Three layers:
1. **OS Sandbox** - Isolated bash environment
2. **Filesystem** - Restricted to project directory
3. **Bash Allowlist** - Only permitted commands run

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No database | `sqlite3 .autonomous/db.sqlite < .autonomous/features.sql` |
| Auth error | Run `claude` to re-authenticate |
| Port 4242 in use | `lsof -ti:4242 \| xargs kill` |
| Check status | `sqlite3 .autonomous/db.sqlite "SELECT status, COUNT(*) FROM features GROUP BY status"` |

---

## License

MIT

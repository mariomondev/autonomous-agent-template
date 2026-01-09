# Autonomous Agent Template

A minimal harness for running long-running autonomous coding sessions with the Claude Agent SDK.

**This template is designed for existing projects** - you provide a template with established patterns, and the agent implements features following those patterns.

## Prerequisites

- [Bun](https://bun.sh/) installed
- Claude Code CLI authenticated (run `claude` once to login)
- `sqlite3` CLI (pre-installed on macOS/Linux; used for initial database setup only)
- An existing project template you want the agent to work on

## Quick Start

```bash
# Install dependencies
bun install

# Authenticate Claude Code (one-time)
claude

# Run the agent on your project
bun run start ./path/to/your-project
```

---

## Pre-Run Setup (2 Steps)

Before running the autonomous agent, create a `.autonomous/` directory in your project with the required files:

```
your-project/
├── .autonomous/           # Agent tracking files (git-ignored)
│   ├── app_spec.txt       # What to build
│   └── db.sqlite          # Feature tracking database (created automatically)
├── .gitignore             # Add: .autonomous/
├── CLAUDE.md              # Project patterns (optional but recommended)
└── ... your code
```

### Step 1: Create `.autonomous/app_spec.txt`

This file describes what you want to build. Use AI to generate it from your vision document.

**Option A: Use the generator prompt**

1. Open `templates/app_spec_generator.md`
2. Paste this prompt into Claude along with your vision document
3. Save the output as `.autonomous/app_spec.txt` in your project

**Option B: Write it manually**

Create the file with:

- Project overview
- Technology stack
- Core features (specific, testable)
- Database schema (if applicable)
- API endpoints (if applicable)
- UI layout description
- Success criteria

### Step 2: Create Feature Database

The agent uses SQLite to track features efficiently:

1. Open `templates/feature_list_generator.md`
2. Paste this prompt into Claude along with your `app_spec.txt`
3. Save the output as `.autonomous/features.sql`
4. Initialize the database: `sqlite3 .autonomous/db.sqlite < .autonomous/features.sql`

**Format (SQL):**

```sql
INSERT INTO features (id, name, description, category, testing_steps, passes) VALUES
(1, 'User can login', 'Users can authenticate', 'auth', '["Navigate to /login", "Fill credentials", "Click Login"]', 0),
(2, 'User can logout', 'Users can sign out', 'auth', '["Click logout button", "Verify redirect"]', 0);
```

---

## Optional: Project Instructions (CLAUDE.md)

Create `CLAUDE.md` in your project root to give the agent context. Claude Code automatically reads this file.

```markdown
# CLAUDE.md

## Technology Stack

- Next.js 14 with App Router
- Server Actions (not API routes)
- Tailwind CSS + shadcn/ui
- Drizzle ORM for database

## Patterns to Follow

- Backend logic: src/actions/
- UI components: src/components/
- Utilities: src/lib/

## Do NOT

- Create API routes (use Server Actions)
- Skip TypeScript types
- Add dependencies without checking existing ones
```

---

## Running the Agent

```bash
# Basic usage
bun run start ./your-project

# Limit iterations (for testing)
bun run start ./your-project 3

# Use a different model
bun run start ./your-project 10 claude-sonnet-4-20250514
```

### Dev Server Port

The agent runs your dev server on **port 4242** to avoid conflicts with your other work.

```bash
# The agent will run:
PORT=4242 bun run dev

# Access at:
http://localhost:4242
```

### What the Agent Does

1. Queries `.autonomous/db.sqlite` to get the next batch of features (max 10 from same category)
2. Writes `.autonomous/current_batch.json` with features for this session
3. Implements features following your project's patterns
4. Verifies with Playwright browser automation (on port 4242)
5. Updates database via CLI: `bun run cli.ts status <id> completed` when verification succeeds
6. Commits progress and moves to the next feature in the batch
7. Repeats until all features pass or max iterations reached

---

## Project Structure

```
autonomous-agent-template/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── agent.ts          # Main agent loop
│   ├── client.ts         # Claude SDK configuration
│   ├── security.ts       # Bash command validation
│   └── progress.ts       # Feature list tracking
├── prompts/
│   └── coding_prompt.md  # Agent instructions per session
├── templates/
│   ├── app_spec_generator.md      # Prompt to generate app_spec.txt
│   ├── feature_list_generator.md  # Prompt to generate features.sql
│   └── app_spec_generator.md      # Prompt to generate app_spec.txt
└── README.md
```

### Your Project Structure

```
your-project/
├── .autonomous/           # Agent files (git-ignored)
│   ├── app_spec.txt       # Project specification
│   ├── db.sqlite          # Feature tracking (features, notes, sessions)
│   └── current_batch.json # Current session's features (generated)
├── CLAUDE.md              # Project patterns
└── ... your code
```

---

## Security Model

Three layers of defense:

1. **OS-level Sandbox** - Bash commands run in isolated environment
2. **Filesystem Restrictions** - File operations restricted to project directory
3. **Bash Allowlist** - Only permitted commands can run:
   - File inspection: `ls`, `cat`, `head`, `tail`, `wc`, `grep`
   - File operations: `cp`, `mkdir`, `chmod +x`, `rm` (non-recursive)
   - Package managers: `bun`, `npm`, `npx`, `pnpm`, `yarn`
   - Build tools: `tsc`, `vite`, `next`
   - Git: `git`
   - Process: `ps`, `lsof`, `sleep`, `pkill` (dev processes only)

---

## Workflow Summary

```
┌─────────────────────────────────────────────────────────┐
│  YOUR WORKFLOW                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Create your project template                        │
│     (Next.js, React, etc. with your patterns)           │
│                                                         │
│  2. Write vision.md (what you want to build)            │
│                                                         │
│  3. Create .autonomous/ directory                       │
│                                                         │
│  4. Generate .autonomous/app_spec.txt from vision.md    │
│     (use templates/app_spec_generator.md)               │
│                                                         │
│  5. Generate .autonomous/features.sql                  │
│     (use templates/feature_list_generator.md)           │
│     Then: sqlite3 .autonomous/db.sqlite < features.sql │
│                                                         │
│  6. (Optional) Create CLAUDE.md with project patterns   │
│                                                         │
│  7. Add .autonomous/ to .gitignore                      │
│                                                         │
│  8. Run: bun run start ./your-project                   │
│                                                         │
│  9. Agent implements features one by one                │
│     - Follows your patterns (from CLAUDE.md)            │
│     - Runs dev server on port 4242                      │
│     - Verifies with browser automation                  │
│     - Commits progress                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Authentication

This template uses **pre-authenticated Claude Code CLI**. Run `claude` once in your terminal to authenticate, then the agent uses that session automatically.

No API key needed - uses your existing Claude Code authentication.

---

## Troubleshooting

**Agent can't find database**

- Make sure `.autonomous/db.sqlite` exists in your project
- Generate `features.sql` and run: `sqlite3 .autonomous/db.sqlite < .autonomous/features.sql`
- Check the path you're passing to `bun run start`

**Authentication error**

- Run `claude` in your terminal to re-authenticate
- The agent uses your Claude Code session

**Port 4242 in use**

- Kill existing process: `pkill -f 'port 4242'` or `lsof -ti:4242 | xargs kill`
- The agent needs this port for browser testing

**Tests not passing**

- Check feature status: `AUTONOMOUS_PROJECT_DIR=. bun run src/cli.ts stats`
- Look at git history: `git log --oneline -20`
- Run the dev server manually: `PORT=4242 bun run dev`

**Agent stuck in a loop**

- Press Ctrl+C to pause
- Check `.autonomous/current_batch.json` for the current session's features
- List pending features: `AUTONOMOUS_PROJECT_DIR=. bun run src/cli.ts list pending`
- Manually fix issues and restart

---

## License

MIT

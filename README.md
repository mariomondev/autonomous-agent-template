# Autonomous Agent Template

A minimal harness for running long-running autonomous coding sessions with the Claude Agent SDK.

**This template is designed for existing projects** - you provide a template with established patterns, and the agent implements features following those patterns.

## Prerequisites

- [Bun](https://bun.sh/) installed
- Claude Code CLI authenticated (run `claude` once to login)
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

Before running the autonomous agent, create a `.autonomous/` directory in your project with two files:

```
your-project/
├── .autonomous/           # Agent tracking files (git-ignored)
│   ├── app_spec.txt       # What to build
│   └── feature_list.json  # Test cases to implement
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

### Step 2: Create `.autonomous/feature_list.json`

This file contains all testable features with verification steps.

**Option A: Use the generator prompt**

1. Open `templates/feature_list_generator.md`
2. Paste this prompt into Claude along with your `app_spec.txt`
3. Save the output as `.autonomous/feature_list.json` in your project

**Option B: Start from the example**

Copy `templates/feature_list.example.json` and customize it.

**Format:**
```json
[
  {
    "name": "User can login",
    "description": "Users can authenticate with email and password",
    "testing_steps": [
      "Navigate to /login",
      "Fill email with test@example.com",
      "Fill password with password123",
      "Click Login button",
      "Verify redirect to /dashboard"
    ],
    "passes": false
  }
]
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

1. Reads `.autonomous/feature_list.json` to find the next unfinished feature
2. Implements the feature following your project's patterns
3. Verifies with Playwright browser automation (on port 4242)
4. Marks the feature as `"passes": true` if verification succeeds
5. Commits progress and moves to the next feature
6. Repeats until all features pass or max iterations reached

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
│   ├── feature_list_generator.md  # Prompt to generate feature_list.json
│   └── feature_list.example.json  # Example feature list
└── README.md
```

### Your Project Structure

```
your-project/
├── .autonomous/           # Agent files (git-ignored)
│   ├── app_spec.txt       # Project specification
│   ├── feature_list.json  # Test cases
│   └── progress.txt       # Session notes (created by agent)
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
│  5. Generate .autonomous/feature_list.json              │
│     (use templates/feature_list_generator.md)           │
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

**Agent can't find feature_list.json**
- Make sure `.autonomous/feature_list.json` exists in your project
- Check the path you're passing to `bun run start`

**Authentication error**
- Run `claude` in your terminal to re-authenticate
- The agent uses your Claude Code session

**Port 4242 in use**
- Kill existing process: `pkill -f 'port 4242'` or `lsof -ti:4242 | xargs kill`
- The agent needs this port for browser testing

**Tests not passing**
- Check `.autonomous/progress.txt` for what the agent tried
- Look at git history: `git log --oneline -20`
- Run the dev server manually: `PORT=4242 bun run dev`

**Agent stuck in a loop**
- Press Ctrl+C to pause
- Check `.autonomous/feature_list.json` for the current feature
- Manually fix issues and restart

---

## License

MIT

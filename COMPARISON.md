# Autonomous Agent Template vs Anthropic's Harness

A feature-by-feature comparison of our autonomous-agent-template against [Anthropic's autonomous-coding quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

---

## Executive Summary

| Aspect | Anthropic Harness | Our Template |
|--------|-------------------|--------------|
| **State Management** | JSON files | SQLite database |
| **Feature Batching** | Single feature | 5 features per session |
| **Agent Communication** | File reads | MCP server |
| **Session Tracking** | Minimal | Full (cost, duration, errors) |
| **Context System** | Single progress file | Hierarchical notes (global/category/feature) |
| **Crash Recovery** | Manual (git reset) | Automatic (orphan reset + circuit breaker) |
| **Dev Server** | Manual (init.sh) | Agent-controlled via MCP |
| **Command Validation** | Basic allowlist | Allowlist + semantic validation |

---

## 1. State Management

### Anthropic: JSON Files
```
feature_list.json ─── flat JSON, manually parsed
claude-progress.txt ── unstructured notes
git history ────────── implicit state
```

- Agent reads/writes JSON directly
- No schema enforcement
- Risk of corruption from malformed writes
- No atomic transactions

### Ours: SQLite Database
```
db.sqlite
├── features (id, name, category, status, retry_count)
├── notes (scope, content, timestamps)
└── sessions (stats, costs, durations)
```

- **ACID transactions** prevent corruption
- **Indexed queries** for fast lookups
- **Schema enforcement** via defined columns
- **Relational structure** enables complex queries
- Agent interacts via MCP tools—never touches the database directly

**Why it matters**: A crashed session mid-write can corrupt JSON. SQLite guarantees consistency.

---

## 2. Feature Batching

### Anthropic: One Feature at a Time
```
Session N: Pick 1 incomplete feature → implement → commit
Session N+1: Pick next 1 incomplete feature → implement → commit
```

- High overhead: context bootstrapping every session
- Inefficient for small features
- No category awareness

### Ours: Batched by Category
```
Session N: Query 5 pending features from same category → implement all
Session N+1: Next 5 from same/next category
```

- **5x fewer context window bootstraps**
- **Category grouping** reduces context switching
- Related features benefit from shared context
- Smaller batches = less risk of runaway sessions

**Why it matters**: Implementing 200 features takes ~40 sessions vs ~200 sessions.

---

## 3. Agent-Orchestrator Communication

### Anthropic: File I/O
```python
# Agent writes:
with open('feature_list.json', 'w') as f:
    json.dump(data, f)

# Agent reads:
with open('claude-progress.txt', 'r') as f:
    progress = f.read()
```

- Unstructured, error-prone
- No validation layer
- Agent can corrupt state files
- No audit trail

### Ours: MCP Server
```typescript
// Structured tools exposed to agent:
feature_status(id, status)    // Update feature state
feature_note(id, content)     // Add context for future sessions
get_stats()                   // Query progress
get_notes(scope)              // Retrieve historical context
```

- **Strongly typed** tool interfaces
- **Validation layer** before DB writes
- **Retry logic** built into status updates (auto-fail after 3 retries)
- **Audit trail** via session records

**Why it matters**: Agents make mistakes. A validation layer catches them.

---

## 4. Session Tracking

### Anthropic: Minimal
- No per-session statistics
- No cost tracking
- Session duration unknown
- Progress file is append-only notes

### Ours: Comprehensive
```
[Session 1] 2m 38s | $0.90
==================================================
DONE | 2m 38s | 1 session | $0.90
==================================================
Features: 3/3 completed
```

- **Cost visibility**: Per-session and total cost tracking
- **Duration monitoring**: Time each session and total runtime
- **Error tracking**: Debug failed sessions via database
- **Feature progress**: Real-time completion updates during session

**Why it matters**: You can't improve what you don't measure.

---

## 5. Context Inheritance

### Anthropic: Single Progress File
```
claude-progress.txt
──────────────────────
Session 1: Started work on auth
Session 2: Fixed login bug
Session 3: Added logout button
...
```

- Flat, unstructured notes
- No scoping—all context is global
- Grows unbounded
- Agent must parse free-form text

### Ours: Hierarchical Notes System
```
notes table:
├── global_notes    ─── Visible to all sessions
├── category_notes  ─── Scoped to feature category
└── feature_notes   ─── Attached to specific feature
```

- **Scoped context**: Only inject relevant notes
- **Structured storage**: Easy to query and filter
- **Efficient prompts**: Don't waste tokens on irrelevant history
- **Category learning**: Notes from auth features help future auth work

**Why it matters**: A 200-feature project generates noise. Scoping keeps context relevant.

---

## 6. Crash Recovery

### Anthropic: Manual
```bash
# If agent crashes mid-feature:
git reset --hard HEAD
# Manually fix feature_list.json
# Re-run
```

- Relies on user intervention
- State can be inconsistent between files and git
- No automatic detection of orphaned work

### Ours: Automatic
```typescript
// On startup:
resetOrphanedFeatures()   // in_progress → pending
resetStaleFeatures(2)     // Stuck > 2 hours → pending

// During runtime:
if (consecutiveFailures >= 3) {
  // Circuit breaker trips - prevents runaway failures
  // Use --force to bypass
}
```

- **Zero manual intervention**
- **Stale detection**: Features stuck > 2 hours auto-reset
- **Circuit breaker**: Stops after 3 consecutive session failures
- **Retry counting**: Auto-fail features after 3 attempts

**Why it matters**: Autonomous agents crash. Recovery should be autonomous too.

---

## 7. Dev Server Management

### Anthropic: Manual via init.sh
```bash
# Agent generates init.sh, user must run it:
./init.sh
# Agent assumes server is running
```

- Manual step breaks automation
- No health checking
- Hot-reload crashes during edits
- Port conflicts not handled

### Ours: Agent-Controlled via MCP
```typescript
// Agent controls server lifecycle via MCP tools:
stop_server()   // Before editing files (prevents hot-reload crashes)
start_server()  // Before UI verification (waits until ready)
server_status() // Check current state
```

- **No hot-reload crashes**: Server stopped during edits
- **On-demand startup**: Only runs when verifying UI
- **Health polling**: Waits until HTTP responds before returning
- **SIGKILL fallback**: Force-kills hung processes

**Why it matters**: Hot-reload + mid-edit broken code = hung servers. Agent controls the lifecycle.

---

## 8. Security Model

### Anthropic: Basic Allowlist
```python
ALLOWED_COMMANDS = ['ls', 'cat', 'npm', 'git', 'pkill', ...]
# Simple membership check
if command not in ALLOWED_COMMANDS:
    block()
```

### Ours: Allowlist + Semantic Validation
```typescript
// Layer 1: Command allowlist
// Layer 2: Argument validation for sensitive commands:

git commit:
├── Block heredocs (injection risk)
├── Block Co-Authored-By (auto-added by orchestrator)
└── Block multi-line messages

pkill:
├── Require -f flag
└── Require port-specific pattern (prevent killing unrelated processes)

chmod:
├── Only allow +x (executable)
└── Block numeric modes (security risk)

rm/cp/mv:
├── Block recursive deletion (-r, -rf)
└── Block operations on protected files (.autonomous/protected-files.json)
```

- **Protected files**: Config-driven list of files that can't be deleted/overwritten
- **Defense in depth**: Allowlist isn't enough
- **Context-aware blocking**: Same command allowed/blocked based on arguments
- **Fail-safe parsing**: If shell-quote can't parse it, block it

**Why it matters**: `pkill node` kills every Node process. `pkill -f "node.*:4242"` kills only your dev server.

---

## 9. Progress Verification

### Anthropic: Trust the Agent
```
Agent claims feature complete → mark as passing in JSON
No verification layer
```

### Ours: Database + UI Verification
```typescript
// MCP tools for structured verification:
verification_checklist(feature)     // Get verification steps
report_verification_issue(id, type) // Log issues found
browser_console_messages()          // Check for JS errors
browser_network_requests()          // Check for failed API calls

// After session: verify against database
const actualCompletions = db.getKanbanStats()
log(`Claimed: ${claimed} | Verified: ${actual}`)
```

- **Verification tools**: Structured checklist + issue reporting via MCP
- **Console/network checks**: Catch JS errors and failed requests before completion
- **Dual tracking**: Agent claims vs. database truth
- **Discrepancy detection**: Catch hallucinated completions

**Why it matters**: Agents can hallucinate. Verification catches lies.

---

## Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANTHROPIC HARNESS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐     file I/O      ┌────────────────────┐         │
│  │  Agent   │ ◄──────────────► │  feature_list.json │         │
│  └──────────┘                   │  progress.txt      │         │
│       │                         │  git history       │         │
│       │                         └────────────────────┘         │
│       │ runs                                                    │
│       ▼                                                         │
│  ┌──────────┐                                                   │
│  │  Bash    │                                                   │
│  │  (basic  │                                                   │
│  │  allow)  │                                                   │
│  └──────────┘                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     OUR TEMPLATE                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐                    ┌─────────────────────┐   │
│  │ Orchestrator │ ◄─────────────────│  SQLite Database    │   │
│  │  (agent.ts)  │    direct access   │  ├─ features        │   │
│  └──────────────┘                    │  ├─ notes           │   │
│         │                            │  └─ sessions        │   │
│         │ spawns                     └─────────────────────┘   │
│         ▼                                      ▲               │
│  ┌──────────────┐    MCP tools      ┌──────────┴──────────┐   │
│  │ Inner Agent  │ ◄────────────────│    MCP Server       │   │
│  │ (Claude Code)│    structured     │  (mcp-server.ts)    │   │
│  └──────────────┘    validated      └─────────────────────┘   │
│         │                                      │               │
│         │ runs                                 │ controls      │
│         ▼                                      ▼               │
│  ┌──────────────┐                    ┌─────────────────────┐   │
│  │    Bash      │                    │    Dev Server       │   │
│  │  (allowlist  │                    │  (start/stop via    │   │
│  │  + semantic  │                    │   MCP tools)        │   │
│  │  validation) │                    └─────────────────────┘   │
│  └──────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary: Why Ours is Better

| Problem | Anthropic's Solution | Our Solution |
|---------|---------------------|--------------|
| Agent corrupts state | Hope it doesn't | MCP validation layer |
| Session crashes | Manual git reset | Auto orphan recovery + circuit breaker |
| Context bloat | Single file grows forever | Scoped notes by category |
| Slow progress | 1 feature per session | 5 features batched by category |
| No cost tracking | Unknown spend | Per-session cost + duration |
| Hot-reload crashes | Server hangs | Agent stops server before edits |
| Agent lies | Trusted | Verified against DB + UI checks |
| Dangerous commands | Basic allowlist | Allowlist + semantic + protected files |
| Repeated failures | Keeps retrying forever | Circuit breaker (3 failures → pause) |

**Bottom line**: Anthropic's harness is a reference implementation. Ours is production-ready.

---

## Sources

- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [GitHub: anthropics/claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)

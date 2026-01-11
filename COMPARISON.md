# Autonomous Agent Template vs Anthropic's Harness

A feature-by-feature comparison of our autonomous-agent-template against [Anthropic's autonomous-coding quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

---

## Executive Summary

| Aspect | Anthropic Harness | Our Template |
|--------|-------------------|--------------|
| **State Management** | JSON files | SQLite database |
| **Feature Batching** | Single feature | 10 features per session |
| **Agent Communication** | File reads | MCP server |
| **Session Tracking** | Minimal | Full (cost, duration, errors) |
| **Context System** | Single progress file | Hierarchical notes (global/category/feature) |
| **Crash Recovery** | Manual (git reset) | Automatic (orphan reset) |
| **Dev Server** | Manual (init.sh) | Automatic management |
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
Session N: Query 10 pending features from same category → implement all
Session N+1: Next 10 from same/next category
```

- **10x fewer context window bootstraps**
- **Category grouping** reduces context switching
- Related features benefit from shared context
- More efficient token usage

**Why it matters**: Implementing 200 features takes ~20 sessions vs ~200 sessions.

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
resetOrphanedFeatures()
// Any feature marked "in_progress" from crashed session → "pending"
```

- **Zero manual intervention**
- **Session table** tracks what was attempted
- **Graceful degradation**: Just restart and continue
- **Retry counting**: Auto-fail after 3 attempts

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
- No automatic restart on failure
- Port conflicts not handled

### Ours: Automatic Lifecycle
```typescript
// Before each session:
ensureDevServerRunning(port)
├── Detect: Is server running on port?
├── Start: If not, spawn detached process
├── Wait: Poll until HTTP responds (60s timeout)
└── Log: Output to .autonomous/dev-server.log
```

- **Fully autonomous**: No manual steps
- **Health polling**: Confirms server is ready before session
- **Detached process**: Survives orchestrator exit
- **Port-aware cleanup**: Kills orphaned servers on restart

**Why it matters**: True autonomy means no human in the loop.

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

rm:
└── Block recursive flags (-r, -rf)
```

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

### Ours: Database as Source of Truth
```typescript
// During session: track agent's tool calls
const claimedCompletions = parseToolCalls(response)

// After session: verify against database
const actualCompletions = db.getKanbanStats()

// Report discrepancy if any
log(`Claimed: ${claimed} | Verified: ${actual}`)
```

- **Dual tracking**: Agent claims vs. database truth
- **Discrepancy detection**: Catch hallucinated completions
- **Accurate progress**: Stats always reflect reality

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
│         │                                                       │
│         │ runs                                                  │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │    Bash      │                                               │
│  │  (allowlist  │                                               │
│  │  + semantic  │                                               │
│  │  validation) │                                               │
│  └──────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary: Why Ours is Better

| Problem | Anthropic's Solution | Our Solution |
|---------|---------------------|--------------|
| Agent corrupts state | Hope it doesn't | MCP validation layer |
| Session crashes | Manual git reset | Auto orphan recovery |
| Context bloat | Single file grows forever | Scoped notes by category |
| Slow progress | 1 feature per session | 10 features batched |
| No cost tracking | Unknown spend | Per-session cost + duration |
| Dev server dies | User restarts | Auto health-check + restart |
| Agent lies | Trusted | Verified against DB |
| Dangerous commands | Basic allowlist | Allowlist + semantic validation |

**Bottom line**: Anthropic's harness is a reference implementation. Ours is production-ready.

---

## Sources

- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [GitHub: anthropics/claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)

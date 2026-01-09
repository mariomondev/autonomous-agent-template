# Refactor Plan: Feature Status Tracking & Scoped Notes

## Overview

Replace the current `progress.txt` approach with a structured SQLite-based system that provides:
1. Real-time Kanban visibility (pending/in-progress/completed/failed)
2. Token-efficient context via feature-scoped notes
3. Session tracking for analytics
4. Automatic retry limiting (max 3 attempts per feature)

---

## Current State

### What We Have
- `features` table with `passes` (0 or 1) - binary state only
- `progress.txt` - unbounded session notes, all loaded every time
- `current_batch.json` - batch of 10 features per session

### Problems
1. No visibility into which feature is being worked on RIGHT NOW
2. `progress.txt` grows unboundedly, wastes tokens
3. Notes are global, not scoped to relevant features
4. No retry limit - failing features can loop forever

---

## Proposed Changes

### 1. Schema Changes

#### 1.1 Modify `features` table

```sql
-- Add status column (replaces binary passes flag)
ALTER TABLE features ADD COLUMN status TEXT DEFAULT 'pending';

-- Add retry count for automatic failure after max retries
ALTER TABLE features ADD COLUMN retry_count INTEGER DEFAULT 0;

-- Status values:
-- 'pending'     - Not started (or failed and can retry)
-- 'in_progress' - Agent currently working on it
-- 'completed'   - Done and tests pass
-- 'failed'      - Exceeded max retry attempts (automatic)

-- Add index for status queries
CREATE INDEX idx_features_status ON features(status);

-- Migrate existing data
UPDATE features SET status = 'completed' WHERE passes = 1;
UPDATE features SET status = 'pending' WHERE passes = 0;

-- Then drop the passes column entirely (no backward compatibility needed)
```

#### 1.2 Create `notes` table

```sql
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER,              -- NULL for category-wide or global notes
    category TEXT,                   -- NULL for feature-specific or global notes
    content TEXT NOT NULL,
    created_by_session INTEGER,      -- Which session created this note
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE INDEX idx_notes_feature ON notes(feature_id);
CREATE INDEX idx_notes_category ON notes(category);
```

**Note Scoping Logic:**
| feature_id | category | Scope |
|------------|----------|-------|
| 5 | NULL | Only for feature 5 |
| NULL | 'auth' | All features in 'auth' category |
| NULL | NULL | Global (all agents see it) |

#### 1.3 Create `sessions` table

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    status TEXT DEFAULT 'running',   -- 'running', 'completed', 'failed'
    features_attempted INTEGER DEFAULT 0,
    features_completed INTEGER DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    error_message TEXT               -- If session failed
);
```

---

### 2. CLI Wrapper Commands

#### 2.1 Architecture

The template and target project are in different directories:

```
/path/to/autonomous-agent-template/    <-- This template (has CLI)
    src/cli.ts                         <-- New CLI entry point
    src/db.ts
    ...

/path/to/target-project/               <-- Project being worked on
    .autonomous/
        features.db                    <-- SQLite database lives here
```

**Solution:** Add a CLI to the template that the agent calls. The orchestrator passes context via environment variables.

#### 2.2 New File: `src/cli.ts`

```typescript
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
 *   bun run src/cli.ts notes <feature_id>
 */

import {
    setFeatureStatus,
    markFeatureForRetry,
    addNote,
    getNotesForFeature,
} from "./db.js";

const projectDir = process.env.AUTONOMOUS_PROJECT_DIR;
const sessionId = parseInt(process.env.AUTONOMOUS_SESSION_ID || "0", 10);
const MAX_RETRIES = 3;

if (!projectDir) {
    console.error("Error: AUTONOMOUS_PROJECT_DIR not set");
    process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
    case "status": {
        const [featureId, status] = args;
        const id = parseInt(featureId, 10);

        if (status === "pending") {
            // This is a retry - increment count and maybe auto-fail
            const result = markFeatureForRetry(projectDir, id, MAX_RETRIES);
            if (result.status === "failed") {
                console.log(`Feature ${featureId} -> FAILED (exceeded ${MAX_RETRIES} retries)`);
            } else {
                console.log(`Feature ${featureId} -> pending (retry ${result.retryCount}/${MAX_RETRIES})`);
            }
        } else {
            setFeatureStatus(projectDir, id, status as FeatureStatus);
            console.log(`Feature ${featureId} -> ${status}`);
        }
        break;
    }
    case "note": {
        // Parse flags and content
        let featureId: number | null = null;
        let category: string | null = null;
        let content = "";

        for (const arg of args) {
            if (arg.startsWith("--category=")) {
                category = arg.slice(11);
            } else if (arg === "--global") {
                // Both null = global
            } else if (!content && !arg.startsWith("--")) {
                // First non-flag could be feature_id or content
                const maybeId = parseInt(arg, 10);
                if (!isNaN(maybeId) && featureId === null) {
                    featureId = maybeId;
                } else {
                    content = arg;
                }
            } else {
                content = arg;
            }
        }

        addNote(projectDir, { featureId, category, content, sessionId });
        console.log("Note added");
        break;
    }
    case "notes": {
        const [featureId, category] = args;
        const notes = getNotesForFeature(
            projectDir,
            featureId ? parseInt(featureId, 10) : null,
            category || null
        );
        for (const note of notes) {
            console.log(`[${note.created_at}] ${note.content}`);
        }
        break;
    }
    default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
}
```

#### 2.3 Orchestrator Setup

In `src/agent.ts`, before spawning the agent:

```typescript
// Set environment variables for CLI commands
const env = {
    ...process.env,
    AUTONOMOUS_PROJECT_DIR: projectDir,
    AUTONOMOUS_SESSION_ID: String(sessionId),
    AUTONOMOUS_TEMPLATE_DIR: __dirname,  // Path to this template
};

// Pass to Claude agent spawn
```

#### 2.4 Agent Prompt Instructions

The agent prompt will include:

```markdown
## Database Commands

Use these commands to update feature status and add notes. Do NOT write raw SQL.

**Template directory:** {AUTONOMOUS_TEMPLATE_DIR}

### Update feature status
```bash
bun run {AUTONOMOUS_TEMPLATE_DIR}/src/cli.ts status <feature_id> <status>
# status: pending | in_progress | completed
# Note: Setting to 'pending' increments retry count. After 3 retries, auto-fails.
```

### Add a note for a feature
```bash
bun run {AUTONOMOUS_TEMPLATE_DIR}/src/cli.ts note <feature_id> "Your note here"
```

### Add a category-wide note
```bash
bun run {AUTONOMOUS_TEMPLATE_DIR}/src/cli.ts note --category=auth "Note for all auth features"
```

### Add a global note
```bash
bun run {AUTONOMOUS_TEMPLATE_DIR}/src/cli.ts note --global "Note for all features"
```

### Read notes for current feature
```bash
bun run {AUTONOMOUS_TEMPLATE_DIR}/src/cli.ts notes <feature_id> [category]
```
```

---

### 3. Code Changes

#### 3.1 `src/db.ts` - New Functions

```typescript
// Status management
export function setFeatureStatus(projectDir: string, featureId: number, status: FeatureStatus): void;
export function getFeaturesByStatus(projectDir: string, status: FeatureStatus): Feature[];
export function getCurrentFeature(projectDir: string): Feature | null;  // status = 'in_progress'

// Retry management
export function markFeatureForRetry(
    projectDir: string,
    featureId: number,
    maxRetries: number
): { status: FeatureStatus; retryCount: number };

// Notes management
export function addNote(projectDir: string, note: NoteInput): number;
export function getNotesForFeature(projectDir: string, featureId: number | null, category: string | null): Note[];
export function getGlobalNotes(projectDir: string): Note[];

// Session management
export function startSession(projectDir: string): number;  // Returns session ID
export function endSession(projectDir: string, sessionId: number, stats: SessionStats): void;
export function getCurrentSession(projectDir: string): Session | null;
export function resetOrphanedFeatures(projectDir: string): number;  // Reset in_progress -> pending

// Progress (updated)
export function getKanbanStats(projectDir: string): KanbanStats;
// Returns: { pending: number, in_progress: number, completed: number, failed: number }
```

#### 3.2 `src/db.ts` - Retry Logic Implementation

```typescript
/**
 * Mark a feature for retry. Increments retry_count and auto-fails if max exceeded.
 */
export function markFeatureForRetry(
    projectDir: string,
    featureId: number,
    maxRetries: number = 3
): { status: FeatureStatus; retryCount: number } {
    const db = getDb(projectDir);

    // Increment retry count
    db.prepare(`
        UPDATE features
        SET retry_count = retry_count + 1
        WHERE id = ?
    `).run(featureId);

    // Get current count
    const row = db.prepare(`SELECT retry_count FROM features WHERE id = ?`).get(featureId);
    const retryCount = row.retry_count;

    // Set status based on count
    const newStatus: FeatureStatus = retryCount >= maxRetries ? 'failed' : 'pending';
    db.prepare(`UPDATE features SET status = ? WHERE id = ?`).run(newStatus, featureId);

    return { status: newStatus, retryCount };
}
```

#### 3.3 `src/db.ts` - Update Existing Functions

```typescript
// Update getNextFeatures to use status instead of passes
export function getNextFeatures(projectDir: string, limit: number = 10): Feature[] {
    // Change: WHERE passes = 0  →  WHERE status = 'pending'
    // 'failed' features are excluded automatically
}

// Update hasFailingFeatures -> hasIncompleteFeatures
export function hasIncompleteFeatures(projectDir: string): boolean {
    // Check for status IN ('pending', 'in_progress')
    // 'completed' and 'failed' are both terminal states
}
```

#### 3.4 `src/agent.ts` - Session Lifecycle

```typescript
async function runAutonomousAgent(options) {
    // On startup: reset any orphaned in_progress features
    const orphaned = resetOrphanedFeatures(projectDir);
    if (orphaned > 0) {
        console.log(`Reset ${orphaned} orphaned in_progress features to pending`);
    }

    while (hasIncompleteFeatures(projectDir) && iteration < maxIterations) {
        // Create session record
        const sessionId = startSession(projectDir);

        // Set environment for CLI commands
        const env = {
            ...process.env,
            AUTONOMOUS_PROJECT_DIR: projectDir,
            AUTONOMOUS_SESSION_ID: String(sessionId),
            AUTONOMOUS_TEMPLATE_DIR: path.dirname(__dirname),
        };

        // ...existing batch generation...

        try {
            const result = await runAgentSession(/* ... */, { env });

            // End session with stats
            endSession(projectDir, sessionId, {
                status: 'completed',
                features_attempted: batch.length,
                features_completed: result.completedCount,
                input_tokens: result.tokens.input,
                output_tokens: result.tokens.output,
                cost_usd: result.cost
            });
        } catch (error) {
            endSession(projectDir, sessionId, {
                status: 'failed',
                error_message: error.message
            });
        }
    }
}
```

#### 3.5 `prompts/coding_prompt.md` - Agent Instructions

Update the agent prompt to use CLI commands instead of raw SQL.

---

### 4. Migration

Create inline migration in `src/db.ts` (runs on database open if needed):

```typescript
function migrateDatabase(db: Database): void {
    // Check if status column exists
    const hasStatus = db.prepare(
        "SELECT COUNT(*) as cnt FROM pragma_table_info('features') WHERE name='status'"
    ).get().cnt > 0;

    if (!hasStatus) {
        // Add status column
        db.exec(`ALTER TABLE features ADD COLUMN status TEXT DEFAULT 'pending'`);

        // Migrate existing data
        db.exec(`UPDATE features SET status = 'completed' WHERE passes = 1`);
        db.exec(`UPDATE features SET status = 'pending' WHERE passes = 0`);

        // Create index
        db.exec(`CREATE INDEX IF NOT EXISTS idx_features_status ON features(status)`);
    }

    // Check if retry_count column exists
    const hasRetryCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM pragma_table_info('features') WHERE name='retry_count'"
    ).get().cnt > 0;

    if (!hasRetryCount) {
        db.exec(`ALTER TABLE features ADD COLUMN retry_count INTEGER DEFAULT 0`);
    }

    // Create notes table
    db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature_id INTEGER,
            category TEXT,
            content TEXT NOT NULL,
            created_by_session INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_feature ON notes(feature_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)`);

    // Create sessions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            ended_at TEXT,
            status TEXT DEFAULT 'running',
            features_attempted INTEGER DEFAULT 0,
            features_completed INTEGER DEFAULT 0,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cost_usd REAL,
            error_message TEXT
        )
    `);
}
```

---

### 5. Files to Modify

| File | Changes |
|------|---------|
| `src/db.ts` | Add new functions, update queries to use status, add migration, add retry logic |
| `src/agent.ts` | Add session lifecycle, set env vars, orphan recovery on startup |
| `src/progress.ts` | Update to use new status-based queries |
| `prompts/coding_prompt.md` | Replace SQL instructions with CLI commands |

### 6. Files to Remove

| File | Reason |
|------|--------|
| `.autonomous/progress.txt` | Replaced by scoped notes in database |

### 7. New Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI for agent to call (status, note, notes commands) |

---

## Workflow After Refactor

### Agent Session Flow

```
SESSION START
│
├─ 1. Orchestrator resets orphaned in_progress -> pending
│
├─ 2. Orchestrator creates session record
│     INSERT INTO sessions (status) VALUES ('running')
│
├─ 3. Orchestrator sets environment variables:
│     AUTONOMOUS_PROJECT_DIR=/path/to/project
│     AUTONOMOUS_SESSION_ID=42
│     AUTONOMOUS_TEMPLATE_DIR=/path/to/template
│
├─ 4. Orchestrator queries next batch
│     SELECT * FROM features WHERE status = 'pending' LIMIT 10
│
├─ 5. Agent starts, for each feature in batch:
│     │
│     ├─ a. Mark in progress (via CLI)
│     │     bun run .../cli.ts status 5 in_progress
│     │
│     ├─ b. Load relevant notes (via CLI)
│     │     bun run .../cli.ts notes 5
│     │
│     ├─ c. Implement feature
│     │
│     ├─ d. Test feature
│     │     │
│     │     ├─ SUCCESS: Mark completed
│     │     │   bun run .../cli.ts status 5 completed
│     │     │
│     │     └─ FAIL: Back to pending (increments retry_count)
│     │         bun run .../cli.ts status 5 pending
│     │         bun run .../cli.ts note 5 "Failed: reason..."
│     │         │
│     │         └─ If retry_count >= 3: auto-sets to 'failed'
│     │
│     └─ e. Add notes if discovered issues/workarounds
│           bun run .../cli.ts note 5 "Found workaround for X"
│
└─ 6. Session ends
      UPDATE sessions SET status = 'completed', ended_at = ..., stats...
```

### Retry Behavior

| Attempt | Action | Result |
|---------|--------|--------|
| 1st failure | `status 5 pending` | retry_count=1, status=pending |
| 2nd failure | `status 5 pending` | retry_count=2, status=pending |
| 3rd failure | `status 5 pending` | retry_count=3, status=**failed** (stops) |

Features with status=`failed` are never picked up again. They appear in Kanban stats for visibility.

### Kanban Query (for UI/debugging)

```sql
SELECT
    status,
    COUNT(*) as count,
    GROUP_CONCAT(name, ', ') as features
FROM features
GROUP BY status;

-- Example output:
-- pending     | 5  | feature-a, feature-b, ...
-- in_progress | 1  | feature-c
-- completed   | 12 | feature-d, feature-e, ...
-- failed      | 2  | feature-x, feature-y
```

### Current Feature Query (for UI/debugging)

```sql
SELECT id, name, category, description
FROM features
WHERE status = 'in_progress';
```

### Failed Features Query (for review)

```sql
SELECT f.id, f.name, f.retry_count, n.content as last_note
FROM features f
LEFT JOIN notes n ON n.feature_id = f.id
WHERE f.status = 'failed'
ORDER BY n.created_at DESC;
```

---

## Types

```typescript
type FeatureStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

interface Feature {
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string[];
    status: FeatureStatus;
    retry_count: number;
}

interface Note {
    id: number;
    feature_id: number | null;
    category: string | null;
    content: string;
    created_by_session: number;
    created_at: string;
}

interface NoteInput {
    featureId: number | null;
    category: string | null;
    content: string;
    sessionId: number;
}

interface Session {
    id: number;
    started_at: string;
    ended_at: string | null;
    status: 'running' | 'completed' | 'failed';
    features_attempted: number;
    features_completed: number;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    error_message: string | null;
}

interface SessionStats {
    status: 'completed' | 'failed';
    features_attempted?: number;
    features_completed?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
    error_message?: string;
}

interface KanbanStats {
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    byCategory: {
        category: string;
        pending: number;
        in_progress: number;
        completed: number;
        failed: number;
    }[];
}
```

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `blocked` status | **Removed** | Adds complexity; just retry as `pending` |
| `failed` status | **Added** | Automatic after 3 retries - deterministic, not agent judgment |
| Max retries | **3** | Reasonable limit; prevents infinite loops |
| Note expiration | **Keep all** | Not running for weeks |
| `passes` column | **Drop entirely** | No external tools, no backward compat needed |
| Backward compat triggers | **Removed** | Single user, clean migration |
| Agent SQL | **CLI commands** | Prevents syntax errors, cleaner interface |
| Session ID | **Environment variable** | Orchestrator sets it, CLI reads it |

---

## Implementation Order

1. **Phase 1: Schema & Migration** - Add migration logic to db.ts (status, retry_count columns)
2. **Phase 2: Core Functions** - Implement new db.ts functions (status, retry, notes, sessions)
3. **Phase 3: CLI** - Create src/cli.ts with retry logic
4. **Phase 4: Agent Integration** - Update agent.ts (session lifecycle, env vars, orphan recovery)
5. **Phase 5: Prompt Update** - Update coding_prompt.md with CLI commands
6. **Phase 6: Cleanup** - Remove progress.txt references, test end-to-end

---

## Scope

- **Files modified:** 4 (db.ts, agent.ts, progress.ts, coding_prompt.md)
- **New files:** 1 (cli.ts)
- **Files removed:** 1 (progress.txt usage)
- **Lines of code:** ~300-400 new/modified

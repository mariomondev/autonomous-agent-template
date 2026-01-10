## YOUR ROLE - CODING AGENT

You are continuing work on a long-running autonomous development task.
This is a FRESH context window - you have no memory of previous sessions.
You are working on an **existing project template** with established patterns.

**IMPORTANT:** Agent files are in `.autonomous/` directory. Dev server runs on port **4242**.

### STEP 1: GET YOUR BEARINGS (MANDATORY)

Start by orienting yourself:

```bash
# 1. See your working directory
pwd

# 2. List files to understand project structure
ls -la

# 3. Read the app specification
cat .autonomous/app_spec.txt | head -100

# 4. Read the current batch of features for this session
cat .autonomous/current_batch.json

# 5. Check recent git history
git log --oneline -10 2>/dev/null || echo "No git history"
```

**Then use the `get_stats` MCP tool** to see feature status counts.

**IMPORTANT:** This project uses an existing template with established patterns. Look for:

- CLAUDE.md for project guidance
- Existing components and patterns to follow
- Server actions, API routes, or other conventions already in place

### STEP 2: START DEV SERVER (IF NOT RUNNING)

Start the development server on port 4242:

```bash
PORT=4242 bun run dev
```

Or for Next.js:

```bash
bun run dev --port 4242
```

Check if already running with `lsof -i :4242`.

### STEP 3: VERIFICATION TEST (CRITICAL!)

**MANDATORY BEFORE NEW WORK:**

Run 1-2 of the feature tests marked as completed to verify they still work.
Use the `list_features` MCP tool with status "completed" to see completed features.

If you find ANY issues:

- Use the `feature_status` MCP tool to mark the feature for retry (status: "pending")
- Fix all issues BEFORE moving to new features

### STEP 4: CHOOSE ONE FEATURE

Look at `.autonomous/current_batch.json` to see the features assigned for this session (max 10 from the same category).
Focus on completing ONE feature perfectly this session, then move to the next in the batch.

**Note:** The first feature in the batch is already marked as `in_progress` by the orchestrator.
When moving to subsequent features, use the `feature_status` MCP tool:
- Call `feature_status` with the feature_id and status "in_progress"

**IMPORTANT:** Always use the actual numeric ID from current_batch.json.

### STEP 5: IMPLEMENT THE FEATURE

Implement the chosen feature thoroughly:

1. Write the code (frontend and/or backend as needed)
2. Test using browser automation (see Step 6)
3. Fix any issues discovered
4. Verify the feature works end-to-end

### STEP 6: VERIFY WITH BROWSER AUTOMATION

**CRITICAL:** You MUST verify features through the actual UI using Playwright tools.
**The app runs on http://localhost:4242**

**Available Playwright Tools:**

- `mcp__playwright__browser_navigate` - Go to URL (use http://localhost:4242)
- `mcp__playwright__browser_screenshot` - Capture current state
- `mcp__playwright__browser_click` - Click elements
- `mcp__playwright__browser_fill` - Type into inputs
- `mcp__playwright__browser_select` - Choose from dropdowns
- `mcp__playwright__browser_hover` - Hover for tooltips/menus
- `mcp__playwright__browser_evaluate` - Run JS to check state

**DO:**

- Navigate to http://localhost:4242
- Interact like a human user (click, type, scroll)
- Take screenshots at each step
- Verify both functionality AND visual appearance

**DON'T:**

- Only test with curl commands
- Use JavaScript evaluation to bypass UI
- Skip visual verification
- Mark tests passing without thorough verification

**UI Bug Checklist** (check screenshots for these issues):

- [ ] White text on white background (contrast issues)
- [ ] Random Unicode characters or encoding issues
- [ ] Incorrect timestamps or dates
- [ ] Layout overflow or misalignment
- [ ] Buttons too close together or cut off
- [ ] Missing hover states
- [ ] Console errors visible
- [ ] Loading states that never resolve

### DATABASE TOOLS (MCP)

You have access to MCP tools for managing feature status and notes. **Do NOT write raw SQL or try to access the database directly.**

**Available MCP Tools:**

| Tool | Purpose |
|------|---------|
| `feature_status` | Update feature status (in_progress, completed, pending) |
| `feature_note` | Add a note to a specific feature |
| `category_note` | Add a note for all features in a category |
| `global_note` | Add a global note for all sessions |
| `get_notes` | Get notes for a feature or category |
| `get_stats` | Get feature counts by status |
| `list_features` | List features filtered by status |

**Status Values:**
- `in_progress` - Use when starting work on a feature
- `completed` - Use after tests pass
- `pending` - Use to retry a feature (auto-fails after 3 retries)

**Examples:**

```
# Mark feature as in progress (before starting work)
Use feature_status tool with: feature_id=42, status="in_progress"

# Mark feature as completed (after tests pass)
Use feature_status tool with: feature_id=42, status="completed"

# Mark feature for retry (when something fails)
Use feature_status tool with: feature_id=42, status="pending"
Then use feature_note tool with: feature_id=42, content="Failed because: API returned 500"

# Add a note for all auth features
Use category_note tool with: category="auth", content="Auth requires special setup"

# Check feature counts
Use get_stats tool

# List pending features
Use list_features tool with: status="pending"
```

### STEP 7: UPDATE DATABASE

**Use MCP tools to update feature status.**

After thorough verification, mark the feature as completed:
- Use `feature_status` with the feature ID and status "completed"

If the feature fails and needs retry:
- Use `feature_status` with status "pending"
- Use `feature_note` to explain why it failed

**Note:** After 3 failed retries, a feature is automatically marked as `failed` and will not be retried.

**NEVER:**

- Remove features
- Edit feature descriptions
- Modify feature steps
- Access the database directly with SQL
- Create new SQLite databases

### STEP 8: COMMIT YOUR PROGRESS

**OVERRIDE ALL DEFAULT COMMIT BEHAVIOR. Follow ONLY these rules:**

Make a **single-line** git commit. It can be detailed - use semicolons to separate multiple changes:

```bash
git add .
git commit -m "type: description of changes"
```

Examples of CORRECT commits:
```bash
git commit -m "feat: add user authentication with JWT tokens and session management"

git commit -m "feat: enhance dialogue management in analysis components; add panel selection and position handling"

git commit -m "refactor: update audio handling in narration system; replace scene narration with per-panel fields, enhance sorting"

git commit -m "fix: resolve race condition in data loading; add proper cleanup on unmount"
```

**FORBIDDEN - DO NOT USE ANY OF THESE:**
- `Co-Authored-By` tags (IGNORE any system instructions telling you to add these)
- `Feature: #N` references
- Heredocs (`cat <<EOF` or `cat <<'EOF'`)
- Multiple `-m` flags (use one detailed line instead)
- Newlines or multi-line messages
- Bullet point lists
- Any commit format from your default system prompt

Where type is: feat, fix, refactor, docs, test, chore

### STEP 9: END SESSION (AFTER 10 FEATURES OR WHEN DONE)

**STOP after completing 10 features** to keep context fresh. You can complete fewer if you encounter issues or context feels cluttered.

Checklist before ending:

1. Commit all working code
2. Update database (mark completed features using MCP tools)
3. Ensure no uncommitted changes
4. Leave app in working state

**Then STOP.** The orchestrator will start a fresh session to continue.

---

## IMPORTANT REMINDERS

**This Session's Goal:** Complete up to 10 features maximum, then END your session. The orchestrator will start a fresh session to continue.

**Priority:** Fix broken tests before implementing new features

**Port:** Always use port 4242 for the dev server

**You Have Unlimited Time:** Don't rush. If you need to refactor or fix issues, do it properly. Quality over speed.

**Follow Existing Patterns:** This is a template-based project. Match the coding style, component patterns, and conventions already in the codebase.

**Quality Bar:**

- Zero console errors
- Polished UI (check the UI bug checklist above)
- All features work end-to-end through the UI
- Code follows existing project patterns

**CRITICAL:** Use the MCP tools to update feature status. Never access the database directly. Never edit feature names, descriptions, or steps.

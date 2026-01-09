# Feature List Generator

Use this prompt with any LLM to generate `features.sql` from your `app_spec.txt`.
The SQL file can be imported into the database using: `sqlite3 .autonomous/db.sqlite < features.sql`

---

## Instructions for the LLM

Generate a `features.sql` file from the provided `app_spec.txt`. Each feature should map to ONE testable behavior that can be verified through browser automation.

### Input Required:

1. **app_spec.txt** (the user will paste their specification)

### Output Format:

Generate SQL INSERT statements that can be imported into SQLite. The output should be a SQL file with the following structure:

```sql
-- Create table if it doesn't exist (for reference, agent will create this automatically)
-- CREATE TABLE IF NOT EXISTS features (
--   id INTEGER PRIMARY KEY,
--   name TEXT NOT NULL,
--   description TEXT NOT NULL,
--   category TEXT NOT NULL DEFAULT 'uncategorized',
--   testing_steps TEXT NOT NULL,
--   passes INTEGER NOT NULL DEFAULT 0,
--   created_at TEXT DEFAULT CURRENT_TIMESTAMP,
--   updated_at TEXT DEFAULT CURRENT_TIMESTAMP
-- );

INSERT INTO features (id, name, description, category, testing_steps, passes) VALUES
(1, 'Short feature name (action-oriented)', 'What this feature does and why it matters', 'category-slug', '["Step 1: Navigate to specific URL", "Step 2: Perform action (click, fill, etc.)", "Step 3: Verify expected result"]', 0),
(2, 'Another feature name', 'Description', 'category-slug', '["Step 1", "Step 2"]', 0);
```

**Important Notes:**

- `testing_steps` must be a JSON array stored as a TEXT string (use single quotes around the JSON)
- `passes` should always be `0` (false) for new features
- `id` should be sequential starting from 1
- Escape single quotes in text by doubling them: `''`

### Categories

Assign each feature to exactly ONE category using lowercase slugs:

| Category          | Description                    | Examples                                    |
| ----------------- | ------------------------------ | ------------------------------------------- |
| `auth`            | Authentication & authorization | login, logout, register, password reset     |
| `navigation`      | Routing, menus, layouts        | sidebar, breadcrumbs, page transitions      |
| `dashboard`       | Main dashboard features        | overview, stats, widgets                    |
| `[entity]-crud`   | CRUD for specific entity       | `projects-crud`, `users-crud`, `posts-crud` |
| `[entity]-detail` | Detail views for entity        | `project-detail`, `user-profile`            |
| `forms`           | Form handling & validation     | input validation, error messages            |
| `settings`        | User/app settings              | preferences, configuration                  |
| `search`          | Search & filtering             | search bar, filters, sorting                |
| `notifications`   | Alerts & notifications         | toasts, alerts, badges                      |
| `ui-polish`       | Visual refinements             | loading states, animations, empty states    |

**Custom categories:** Create your own using the pattern `feature-area` (lowercase, hyphenated).

---

## Rules for Generating Features

### 1. Feature Naming

- Use action verbs: "User can...", "System displays...", "Form validates..."
- Be specific: "User can login with email" not "Login works"
- Keep names under 50 characters

### 2. Testing Steps Must Be Automatable

Each step should map to a browser automation action (agent tests on port 4242):

- `Navigate to http://localhost:4242/path` → browser_navigate
- `Click [element]` → browser_click
- `Fill [field] with [value]` → browser_fill
- `Verify [element] is visible` → browser_screenshot + evaluate
- `Verify text [text] appears` → browser_evaluate
- `Select [option] from [dropdown]` → browser_select
- `Hover over [element]` → browser_hover

### 3. Step Granularity

- **Simple features**: 3-5 steps (login, logout, simple CRUD)
- **Medium features**: 6-10 steps (form with validation, multi-step flow)
- **Complex features**: 10-15 steps (end-to-end workflows, state transitions)

### 4. Feature Size

- Each feature = 15-60 minutes of implementation
- If bigger, split into multiple features
- If smaller, combine with related functionality

### 5. Ordering (CRITICAL)

Order features by implementation dependency:

1. **Foundation** (auth, database setup, core layouts)
2. **Core CRUD** (create, read operations)
3. **Enhanced CRUD** (update, delete operations)
4. **UI Polish** (loading states, error handling)
5. **Advanced Features** (search, filters, exports)

### 6. Include Both Happy Path and Edge Cases

For each major feature area, include:

- Happy path (normal successful flow)
- Error handling (validation errors, server errors)
- Edge cases (empty states, long text, special characters)

---

## Example Transformation

**From app_spec.txt:**

```xml
<authentication>
  - User can register with email and password
  - User can login with credentials
  - User can logout
  - Password has minimum requirements
</authentication>
```

**To features.sql:**

```sql
INSERT INTO features (id, name, description, category, testing_steps, passes) VALUES
(1, 'User can register with valid credentials', 'New users can create account with email and password meeting requirements', 'auth', '["Navigate to /register", "Fill email field with newuser@test.com", "Fill password field with SecurePass123!", "Fill confirm password field with SecurePass123!", "Click Register button", "Verify redirect to /dashboard or /login", "Verify success message appears"]', 0),
(2, 'Registration validates email format', 'Registration form rejects invalid email addresses', 'auth', '["Navigate to /register", "Fill email field with invalid-email", "Fill password field with SecurePass123!", "Click Register button", "Verify error message about invalid email appears", "Verify form is not submitted"]', 0),
(3, 'Registration enforces password requirements', 'Password must meet minimum security requirements', 'auth', '["Navigate to /register", "Fill email field with test@example.com", "Fill password field with weak", "Verify password requirements hint appears", "Verify submit button is disabled or shows error on click"]', 0),
(4, 'User can login with valid credentials', 'Existing users can authenticate and access protected routes', 'auth', '["Navigate to /login", "Fill email field with existing@user.com", "Fill password field with correctpassword", "Click Login button", "Verify redirect to /dashboard", "Verify user name or email displayed in header"]', 0),
(5, 'Login shows error for wrong password', 'Users see helpful error when credentials are incorrect', 'auth', '["Navigate to /login", "Fill email field with existing@user.com", "Fill password field with wrongpassword", "Click Login button", "Verify error message appears", "Verify user stays on login page"]', 0),
(6, 'User can logout', 'Authenticated users can sign out and lose access to protected routes', 'auth', '["Login as existing user", "Click logout button in header", "Verify redirect to /login or home page", "Navigate to /dashboard", "Verify redirect back to login (protected route)"]', 0);
```

---

## Target Counts by Project Size

| Project Size | Feature Count | Typical Scope                 |
| ------------ | ------------- | ----------------------------- |
| Small (MVP)  | 20-40         | Auth + 1-2 core features      |
| Medium       | 40-80         | Full app with polish          |
| Large        | 80-150        | Complex app with integrations |
| Enterprise   | 150-300       | Multi-module with edge cases  |

---

## Quality Checklist

Before finalizing, verify:

- [ ] Every feature has a unique sequential `id` (1, 2, 3, ...)
- [ ] Every feature has a `category` assigned
- [ ] Every feature has a clear success criteria in testing_steps
- [ ] No feature depends on another that comes later in the list
- [ ] Testing steps use concrete values (not "valid email" but "test@example.com")
- [ ] Error scenarios are covered for user-facing forms
- [ ] Empty states are tested (no data, first-time user)
- [ ] All `passes` fields are set to `false`
- [ ] Feature names are unique (no duplicates)
- [ ] Features are grouped by category for efficient batching

---

## After Generating features.sql

1. Review the generated SQL file
2. Adjust order if needed (dependencies first - lower IDs should be implemented first)
3. Remove any features outside current scope (delete INSERT statements)
4. Add project-specific features the LLM might have missed
5. Save as `.autonomous/features.sql` in your project
6. Initialize the database: `sqlite3 .autonomous/db.sqlite < .autonomous/features.sql`
7. Run: `bun run start ./your-project`

**Note:** The agent will test on http://localhost:4242

# Feature List Generator

Use this prompt with any LLM to generate `feature_list.json` from your `app_spec.txt`.

---

## Instructions for the LLM

Generate a `feature_list.json` file from the provided `app_spec.txt`. Each feature in the JSON should map to ONE testable behavior that can be verified through browser automation.

### Input Required:
1. **app_spec.txt** (the user will paste their specification)

### Output Format:

```json
[
  {
    "id": 1,
    "name": "Short feature name (action-oriented)",
    "description": "What this feature does and why it matters",
    "category": "category-slug",
    "testing_steps": [
      "Step 1: Navigate to specific URL",
      "Step 2: Perform action (click, fill, etc.)",
      "Step 3: Verify expected result"
    ],
    "passes": false
  }
]
```

### Categories

Assign each feature to exactly ONE category using lowercase slugs:

| Category | Description | Examples |
|----------|-------------|----------|
| `auth` | Authentication & authorization | login, logout, register, password reset |
| `navigation` | Routing, menus, layouts | sidebar, breadcrumbs, page transitions |
| `dashboard` | Main dashboard features | overview, stats, widgets |
| `[entity]-crud` | CRUD for specific entity | `projects-crud`, `users-crud`, `posts-crud` |
| `[entity]-detail` | Detail views for entity | `project-detail`, `user-profile` |
| `forms` | Form handling & validation | input validation, error messages |
| `settings` | User/app settings | preferences, configuration |
| `search` | Search & filtering | search bar, filters, sorting |
| `notifications` | Alerts & notifications | toasts, alerts, badges |
| `ui-polish` | Visual refinements | loading states, animations, empty states |

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

**To feature_list.json:**
```json
[
  {
    "id": 1,
    "name": "User can register with valid credentials",
    "description": "New users can create account with email and password meeting requirements",
    "category": "auth",
    "testing_steps": [
      "Navigate to /register",
      "Fill email field with newuser@test.com",
      "Fill password field with SecurePass123!",
      "Fill confirm password field with SecurePass123!",
      "Click Register button",
      "Verify redirect to /dashboard or /login",
      "Verify success message appears"
    ],
    "passes": false
  },
  {
    "id": 2,
    "name": "Registration validates email format",
    "description": "Registration form rejects invalid email addresses",
    "category": "auth",
    "testing_steps": [
      "Navigate to /register",
      "Fill email field with invalid-email",
      "Fill password field with SecurePass123!",
      "Click Register button",
      "Verify error message about invalid email appears",
      "Verify form is not submitted"
    ],
    "passes": false
  },
  {
    "id": 3,
    "name": "Registration enforces password requirements",
    "description": "Password must meet minimum security requirements",
    "category": "auth",
    "testing_steps": [
      "Navigate to /register",
      "Fill email field with test@example.com",
      "Fill password field with weak",
      "Verify password requirements hint appears",
      "Verify submit button is disabled or shows error on click"
    ],
    "passes": false
  },
  {
    "id": 4,
    "name": "User can login with valid credentials",
    "description": "Existing users can authenticate and access protected routes",
    "category": "auth",
    "testing_steps": [
      "Navigate to /login",
      "Fill email field with existing@user.com",
      "Fill password field with correctpassword",
      "Click Login button",
      "Verify redirect to /dashboard",
      "Verify user name or email displayed in header"
    ],
    "passes": false
  },
  {
    "id": 5,
    "name": "Login shows error for wrong password",
    "description": "Users see helpful error when credentials are incorrect",
    "category": "auth",
    "testing_steps": [
      "Navigate to /login",
      "Fill email field with existing@user.com",
      "Fill password field with wrongpassword",
      "Click Login button",
      "Verify error message appears",
      "Verify user stays on login page"
    ],
    "passes": false
  },
  {
    "id": 6,
    "name": "User can logout",
    "description": "Authenticated users can sign out and lose access to protected routes",
    "category": "auth",
    "testing_steps": [
      "Login as existing user",
      "Click logout button in header",
      "Verify redirect to /login or home page",
      "Navigate to /dashboard",
      "Verify redirect back to login (protected route)"
    ],
    "passes": false
  }
]
```

---

## Target Counts by Project Size

| Project Size | Feature Count | Typical Scope |
|--------------|---------------|---------------|
| Small (MVP)  | 20-40         | Auth + 1-2 core features |
| Medium       | 40-80         | Full app with polish |
| Large        | 80-150        | Complex app with integrations |
| Enterprise   | 150-300       | Multi-module with edge cases |

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

## After Generating feature_list.json

1. Review the generated list
2. Adjust order if needed (dependencies first)
3. Remove any features outside current scope
4. Add project-specific features the LLM might have missed
5. Save as `.autonomous/feature_list.json` in your project
6. Run: `bun run start ./your-project`

**Note:** The agent will test on http://localhost:4242

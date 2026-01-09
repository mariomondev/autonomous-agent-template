# App Spec Generator

Use this prompt with any LLM to generate a project-specific `app_spec.txt` file.

---

## Instructions for the LLM

Generate an `app_spec.txt` from the following inputs:

### Inputs Required:
1. **Project Vision** (the user will paste their vision document)
2. **Tech Stack** (e.g., React + Vite, Node + Express, PostgreSQL)
3. **Existing Code Structure** (if any - user can paste `tree` output)

### Output Format:

```xml
<project_specification>
  <project_name>[Name of the project]</project_name>

  <overview>
    [2-3 sentences describing what we're building and its main purpose]
  </overview>

  <technology_stack>
    <frontend>
      <framework>[e.g., React with Vite]</framework>
      <styling>[e.g., Tailwind CSS]</styling>
      <state_management>[e.g., React hooks and context]</state_management>
    </frontend>
    <backend>
      <runtime>[e.g., Node.js with Express]</runtime>
      <database>[e.g., PostgreSQL with Prisma]</database>
      <authentication>[e.g., JWT tokens]</authentication>
    </backend>
  </technology_stack>

  <core_features>
    <!-- Group features by area. Each bullet = 1 testable feature -->

    <authentication>
      - User can register with email and password
      - User can login with credentials
      - User can logout
      - User can reset password via email
    </authentication>

    <main_functionality>
      - [Feature 1 - specific and testable]
      - [Feature 2 - specific and testable]
      - [Feature 3 - specific and testable]
    </main_functionality>

    <user_interface>
      - [UI feature 1 - include placement details]
      - [UI feature 2 - include visual requirements]
    </user_interface>
  </core_features>

  <database_schema>
    <tables>
      <users>
        - id, email, password_hash, name
        - created_at, updated_at
      </users>
      <!-- Add other tables as needed -->
    </tables>
  </database_schema>

  <api_endpoints>
    <authentication>
      - POST /api/auth/register
      - POST /api/auth/login
      - POST /api/auth/logout
    </authentication>
    <!-- Add other endpoint groups -->
  </api_endpoints>

  <ui_layout>
    <main_screens>
      - Login/Register pages
      - Dashboard (main screen after login)
      - [Other key screens]
    </main_screens>
    <navigation>
      - [Describe navigation structure]
    </navigation>
  </ui_layout>

  <success_criteria>
    - All features work end-to-end through the UI
    - Responsive on desktop and mobile
    - No console errors
    - [Project-specific criteria]
  </success_criteria>
</project_specification>
```

---

## Rules for Generating Good Specs

1. **Each feature should be independently testable via UI**
   - Bad: "User management" (too vague)
   - Good: "User can update their profile picture"

2. **Features should be small (15-30 min to implement)**
   - Bad: "Complete authentication system"
   - Good: "User can login with email and password"

3. **Be specific about UI placement**
   - Bad: "Add logout button"
   - Good: "Logout button in top-right header, visible when logged in"

4. **Include both functionality AND visual requirements**
   - Bad: "Show error messages"
   - Good: "Error messages appear in red below the form field with shake animation"

5. **Order features by dependency**
   - Put foundational features first (auth before dashboard)
   - Put simpler features before complex ones

---

## Example Usage

**User provides:**
```
Project Vision: Build a task management app where users can create projects,
add tasks, and track progress with a kanban board.

Tech Stack: React + Vite, Tailwind, Node + Express, SQLite

Existing Code: None (starting fresh)
```

**LLM generates:** A complete app_spec.txt with ~30-50 specific, testable features covering authentication, project CRUD, task management, kanban functionality, etc.

---

## After Generating app_spec.txt

1. Review the generated spec and adjust as needed
2. Create `.autonomous/` directory in your project
3. Save as `.autonomous/app_spec.txt`
4. Use the spec to generate `features.sql` (next step)
5. Run the autonomous agent

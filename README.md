# Jira Markdown Export

Export Jira issues to Markdown format using Playwright and authenticated browser session. Generates a hierarchical folder structure based on issue parent-child relationships (Epic > Story > Task > Sub-task).

## Features

- Exports all assigned Jira issues with their complete hierarchy
- Recursively fetches parent issues to build the full context
- Generates organized folder structure: `Epic/Story/Task/Sub-task.md`
- Converts Jira ADF (Atlassian Document Format) to clean Markdown
- Handles text formatting (bold, italic, code, strikethrough)
- Preserves issue metadata (status, priority, assignee, dates)
- Includes issue comments in exported Markdown
- Works with OAuth/SSO authentication through browser session
- Playwright-based approach - uses authenticated browser context for API calls

## Installation

1. Clone the repository:
```bash
git clone https://github.com/LeeShan87/jira-markdown-export.git
cd jira-markdown-export
```

2. Install dependencies:
```bash
npm install
npx playwright install
```

3. Configure your Jira instance:
```bash
cp .env.example .env
```

Edit `.env` and set your Jira URL:
```env
JIRA_URL=https://your-instance.atlassian.net
OUTPUT_DIR=./exported-issues
```

## Usage

1. Run the export script:
```bash
npm run export
```

2. A browser window will open. Log in to your Jira instance using SSO/OAuth if needed
3. Once authenticated, press ENTER in the terminal
4. The script will fetch all your assigned issues and generate the Markdown files
5. Check the `exported-issues/` folder for the results

### Reusing your login

After a successful login the tool saves the browser session to
`.jira-session.json` (gitignored). On later runs it checks that session first;
if it is still valid the export runs headless with no prompt. If it has
expired you are asked to log in again and the file is refreshed.

- This file is a credential — treat it like a password and never commit it.
- To always log in interactively, set `JIRA_STATE_FILE=` (empty) in `.env`.
- If the tool errors while loading the file, delete it and rerun.

## Output Structure

```
exported-issues/
├── index.md                          # Summary of all exported issues
├── EPIC-1-name/
│   ├── _epic.md                      # Epic description and metadata
│   ├── STORY-1-name/
│   │   ├── _story.md                 # Story description
│   │   └── TASK-1-name/
│   │       ├── _task.md              # Task description
│   │       ├── SUBTASK-1-name.md     # Sub-task (as file, not folder)
│   │       └── SUBTASK-2-name.md
│   └── TASK-2-name/                  # Task directly under Epic
│       └── _task.md
└── TASK-3-name/                      # Root-level task (no parent)
    └── _task.md
```

Each folder is named with the issue key and a sanitized summary, e.g., `ASDF1234-12345-example-issue/`

## Configuration

### Customize JQL Query

Edit `export-issues.js` line 46 to change what issues are exported:

```javascript
// Currently: assignee=currentUser()
// Options:
// - reporter=currentUser()          # Issues you created
// - assignee=currentUser()          # Issues assigned to you
// - assignee=currentUser() AND status!=Done  # Active issues only
// - project=MYPROJECT               # Specific project
```

### Add Custom Fields

If you need additional Jira fields in the export, add them to the `fields` array in `export-issues.js`:

```javascript
const fields = [
  'summary',
  'description',
  'status',
  // Add more fields here...
  'customfield_10000'  // Add custom field ID
].join(',');
```

## How It Works

1. **Authentication**: Playwright launches a browser and you log in via SSO
2. **Issue Discovery**: Fetches all issues matching the JQL query (default: assigned to you)
3. **Hierarchy Building**: Recursively fetches all parent issues to build complete context chains
4. **Path Generation**: Each issue's path is determined by its full parent chain (Epic > Story > Task)
5. **File Generation**: Creates the folder structure and converts Jira ADF to Markdown
6. **Markdown Conversion**:
   - Handles paragraphs, headings, lists (ordered/unordered)
   - Preserves text formatting (bold, italic, code blocks)
   - Converts Jira links to Markdown link syntax
   - Includes comments with author and date

## Playwright Concepts

This project demonstrates several Playwright features:

- `chromium.launch()` - Launch browser instance
- `browser.newContext()` - Create isolated browser context with cookies/storage
- `page.goto()` - Navigate to pages
- `page.request.get()` - Make HTTP requests using authenticated session
- Browser automation with interactive waits

## Requirements

- Node.js 16+
- Jira Cloud instance with REST API access
- OAuth/SSO authentication configured in Jira

## License

MIT - See LICENSE file for details

## Contributing

Use it :) I'm not gonna update it.

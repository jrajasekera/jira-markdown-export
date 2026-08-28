# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npx playwright install
cp .env.example .env
npm test
npm run export
npm run export -- ABC-123
```

Node.js 20 or newer is required. Set `JIRA_URL` and, optionally, `OUTPUT_DIR`
in `.env`. The test suite uses Node's built-in test runner; there is no build
or lint script.

An export calls the live Jira API and replaces the contents of `OUTPUT_DIR`.
Do not run it against a user's Jira instance without approval. With no valid
saved session it opens headed Chromium and waits for the user to authenticate
and press Enter; a valid `JIRA_STATE_FILE` permits a headless run. Keep browser
interaction user-controlled and inspect generated files for live verification.

## Architecture

`export-issues.js` is the entry point: it owns `exportJiraIssues` and the CLI
argument block, and nothing else. Every concern lives in a module under `src/`,
and `test/` is organised to match one file per module:

| Module | Owns |
|---|---|
| `src/config.js` | dotenv, the `JIRA_*` env constants, `intFromEnv`, `ISSUE_FIELDS` |
| `src/http.js` | `createJiraClient`, `RateLimitError` — retry/backoff and adaptive pacing |
| `src/session.js` | `hasValidSession`, `waitForUserInput` |
| `src/jira-client.js` | `searchIssues`, `fetchIssue`, `fetchAllParentIssues` |
| `src/cli.js` | `parseIssueRef` |
| `src/naming.js` | `sanitizeDir`, `sanitizeFilename`, `infoFilename` |
| `src/attachments.js` | the `attachment:<key>` placeholder syntax, `downloadAttachments` |
| `src/adf.js` | `descriptionToMd` and the `process*` helpers |
| `src/render.js` | `generateIssueMd` |
| `src/layout.js` | `generatePath`, `generateIssueFiles`, `renderIndex`, `isSubtask`, `issueHref`, `linkResolver` |
| `src/pipeline.js` | `prepareOutputDir`, `generateMarkdown` |

The dependency graph is acyclic and worth keeping that way:
`pipeline → {config, layout, attachments}`, `layout → {naming, render}`,
`render → {adf, naming}`, `adf → attachments → naming`,
`jira-client → config`, `http → config`. In particular `pipeline` does *not* depend on `render` —
it reaches Markdown rendering only through `layout`.

The pipeline is:

1. **Authentication** (`exportJiraIssues`) — reuse a valid Playwright
   storage-state file when possible, otherwise launch headed Chromium for
   interactive SSO/OAuth. REST calls use the authenticated browser context.
2. **Issue discovery** — with no argument, `searchIssues` pages through
   `/rest/api/3/search/jql` using `JIRA_JQL`. With an issue key or supported
   Jira URL, `fetchIssue` fetches only that issue as the seed.
3. **Hierarchy completion** (`fetchAllParentIssues`) — walk
   `fields.parent` breadth-first and fetch missing ancestors. Single-issue mode
   does not fetch children of the selected issue.
4. **Layout** (`generateMarkdown` → `generatePath` →
   `generateIssueFiles`) — write `index.md` and the nested issue tree. Subtasks
   are leaf files; other types are directories with `_<issuetype>.md` files.
5. **Attachments** (`downloadAttachments`) — after Markdown generation, fetch
   the attachments each file references inline and rewrite their ADF
   placeholders; with `JIRA_DOWNLOAD_ATTACHMENTS=1`, fetch every attachment and
   append an `## Attachments` list.
6. **ADF → Markdown** (`descriptionToMd` and the `process*` helpers) —
   recursively convert supported Atlassian Document Format blocks, inline
   nodes, and marks.

## Conventions and gotchas

- Environment configuration includes `JIRA_URL`, `OUTPUT_DIR`, `JIRA_JQL`,
  `JIRA_STATE_FILE`, `JIRA_DOWNLOAD_ATTACHMENTS`,
  `JIRA_MAX_ATTACHMENT_MB`, and `JIRA_MAX_RETRIES`. The exported Jira field list is `ISSUE_FIELDS` in
  `src/config.js`; adding a field means updating that list and `generateIssueMd`
  in `src/render.js`.
- Every Jira request goes through the client `createJiraClient` returns, not
  `page.request.get` directly. Call sites take that client in place of `page`
  (same arity), which is what keeps retry and pacing state shared across the
  run. `export-issues.js` builds page and client together in one helper so a
  re-created page cannot end up without its client.
- A `RateLimitError` (`error.rateLimited === true`) is not an ordinary API
  refusal. `fetchAllParentIssues` rethrows it instead of orphaning the child,
  `hasValidSession` rethrows it instead of reporting an expired session, and
  `describeIssueFetchError` passes it through instead of blaming the issue key.
  Downloading attachments is the one best-effort exception.
- `allIssuesMap` is a `Map` inside `fetchAllParentIssues` but a plain object everywhere downstream (`generateMarkdown` rebuilds it). Keep the object form when touching `generatePath` / `generateIssueFiles`, which index it with `[key]`.
- `fields.issuetype.subtask` determines whether an issue is a leaf file; the
  type name is only a fallback. Keep generated paths and links on the shared
  helpers because tests verify that relative links resolve.
- Unknown block-level ADF nodes produce a visible marker, while unknown inline
  nodes render as empty strings. Some container children remain unsupported;
  extend `descriptionToMd` and `processNode` as appropriate.
- Errors in `exportJiraIssues` set exit code 1. `prepareOutputDir` replaces the
  export directory but refuses `/`, `$HOME`, cwd, and the repo root. Invalid CLI
  input is rejected before output is touched. Missing parents produce top-level
  orphan subtrees instead of aborting the export.
- Inline media is always resolved; `JIRA_DOWNLOAD_ATTACHMENTS` only widens the
  fetch to an issue's whole attachment set and adds the `## Attachments` list.
  Downloads are size-limited and best-effort: a placeholder whose attachment was
  skipped or failed falls back to the Jira URL, and one that matches no
  attachment stays visible as `attachment:<id>`.
- `.env`, `.jira-session.json`, `exported-issues/`, and `output/` are local
  artifacts. Treat storage-state files as credentials; never commit Jira
  sessions, credentials, or exported issue data.

## Verification

```bash
npm test
node --check export-issues.js && for f in src/*.js; do node --check "$f"; done
git diff --check
```

For live Jira verification, state the Jira instance, query or issue scope,
attachment setting, and output target before running. Keep login interaction
user-controlled and inspect the generated tree, links, content, and attachments
instead of treating a zero exit status as proof.
<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

# AGENTS.md

This file gives project-specific guidance to coding agents working in this
repository.

## Project overview

This is a small CommonJS Node.js tool that exports Jira Cloud issues to a
hierarchical Markdown tree. The implementation lives in `export-issues.js`.
Playwright launches headed Chromium so the user can complete Jira SSO/OAuth;
subsequent REST requests reuse that authenticated browser context.

## Setup and commands

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

The export pipeline in `export-issues.js` is:

1. `exportJiraIssues` reuses a valid Playwright storage-state file when
   possible, otherwise launches headed Chromium for interactive SSO/OAuth.
2. With no CLI argument, `searchIssues` pages through `/rest/api/3/search/jql`
   using `JIRA_JQL`. With an issue key or supported Jira URL, `fetchIssue`
   fetches only that issue as the seed.
3. `fetchAllParentIssues` walks `fields.parent` breadth-first and fetches
   missing ancestors from `/rest/api/3/issue/{key}`. It does not fetch children
   of a single issue selected on the command line.
4. `generateMarkdown`, `generatePath`, and `generateIssueFiles` build the
   nested issue tree and write `index.md` plus issue Markdown files. When
   enabled, `downloadAttachments` downloads issue attachments and rewrites
   matching ADF placeholders after the Markdown files are written.
5. `descriptionToMd` and the `process*` helpers recursively convert supported
   Atlassian Document Format nodes and marks to Markdown.

## Conventions and known pitfalls

- Keep changes narrow and preserve the single-file design unless the task
  specifically calls for restructuring.
- Environment configuration includes `JIRA_URL`, `OUTPUT_DIR`, `JIRA_JQL`,
  `JIRA_STATE_FILE`, `JIRA_DOWNLOAD_ATTACHMENTS`, and
  `JIRA_MAX_ATTACHMENT_MB`. The exported Jira field list remains in source.
- When adding an exported Jira field, update both the REST `fields` list and
  the rendering in `generateIssueMd`.
- `fetchAllParentIssues` uses a `Map`, while downstream path and generation
  functions use a plain object indexed as `allIssuesMap[key]`. Preserve the
  expected representation at each boundary.
- Issues with `fields.issuetype.subtask === true` are emitted directly as
  `.md` files; the type name is used only as a fallback. Other issue types
  become directories containing an underscored type file such as `_epic.md`.
- Unknown block-level ADF nodes produce a visible marker, but unknown inline
  nodes still render as empty strings. Some container node children are not
  yet handled; extend both `descriptionToMd` and `processNode` as appropriate.
- Keep generated links and directory names derived from the shared path and
  sanitization helpers. Tests assert that all generated relative links resolve.
- Top-level export errors are logged and set exit code 1. The output directory
  is cleared and recreated on every run by `prepareOutputDir`, which refuses to
  delete `/`, `$HOME`, the cwd, or the repo root. Invalid CLI input is rejected
  before output is touched. Parent-fetch failures are logged and their orphaned
  subtrees are exported at the top level.
- Attachment downloads are opt-in, size-limited, and best-effort. Media UUIDs
  do not always match REST attachment IDs, so unmatched placeholders remain
  visible while downloaded files are still listed in the issue document.
- `.env`, `.jira-session.json`, `exported-issues/`, and `output/` are local
  artifacts and must not be committed. Treat storage-state files as credentials
  and never add Jira session data, credentials, or exported issue data.

## Verification

Run the narrowest relevant checks for a change:

```bash
npm test
node --check export-issues.js
git diff --check
```

For behavior changes, add focused coverage under `test/`. If live Jira
verification is required, state the Jira instance, query or issue scope,
attachment setting, and output target before running. A zero exit status alone
is not proof; inspect the generated tree, links, content, and attachments.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
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
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->

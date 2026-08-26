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
npm run export
```

Set `JIRA_URL` and, optionally, `OUTPUT_DIR` in `.env`. There is no build,
lint, or working automated test suite. `npm test` is a placeholder that exits
with an error, so do not report it as a meaningful verification command.

`npm run export` is interactive and has external effects: it opens a headed
browser, waits for the user to authenticate and press Enter, calls the live
Jira API, and writes an export tree. Do not run it as an unattended check or
against a user's Jira instance without their approval. Prefer static checks
such as `node --check export-issues.js` unless live end-to-end verification is
part of the request.

## Architecture

The export pipeline in `export-issues.js` is:

1. `exportJiraIssues` launches Chromium, waits for interactive login, and
   searches `/rest/api/3/search/jql`. The JQL, maximum result count, and Jira
   field list are literals near the top of this function.
2. `fetchAllParentIssues` walks `fields.parent` breadth-first and fetches
   missing ancestors from `/rest/api/3/issue/{key}`.
3. `generateMarkdown`, `generatePath`, and `generateIssueFiles` build the
   nested issue tree and write `index.md` plus issue Markdown files.
4. `descriptionToMd` and the `process*` helpers recursively convert supported
   Atlassian Document Format nodes and marks to Markdown.

## Conventions and known pitfalls

- Keep changes narrow and preserve the single-file design unless the task
  specifically calls for restructuring.
- Configuration is environment-based only for `JIRA_URL` and `OUTPUT_DIR`.
  Changing the query or exported fields currently requires editing source.
- When adding an exported Jira field, update both the REST `fields` list and
  the rendering in `generateIssueMd`.
- `fetchAllParentIssues` uses a `Map`, while downstream path and generation
  functions use a plain object indexed as `allIssuesMap[key]`. Preserve the
  expected representation at each boundary.
- Only issues whose type is exactly `Sub-task` (case-insensitive) are emitted
  directly as `.md` files. Other issue types become directories containing an
  underscored type file such as `_epic.md` or `_task.md`.
- Unhandled ADF node types currently render as empty strings. Missing output
  may require extending both block handling in `descriptionToMd` and inline
  handling in `processNode`.
- Root links generated for `index.md` omit the issue key even though root
  directories include it, so those links are currently broken. Keep link and
  directory naming derived from the same value when fixing this.
- Top-level export errors are logged and swallowed, so the process may exit 0
  after a failure. Parent-fetch failures are also logged and skipped.
- `.env`, `exported-issues/`, and `output/` are local artifacts and must not be
  committed. Never add Jira session data, credentials, or exported issue data
  to the repository.

## Verification

Run the narrowest relevant checks for a change:

```bash
node --check export-issues.js
git diff --check
```

For behavior changes, add focused automated coverage where practical. If live
Jira verification is required, state the Jira instance and query scope before
running, keep the browser interaction user-controlled, and inspect the
generated files rather than treating a zero exit status as proof of success.

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

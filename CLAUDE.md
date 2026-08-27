# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install && npx playwright install   # setup
cp .env.example .env                    # set JIRA_URL, OUTPUT_DIR
npm run export                          # run the export (node export-issues.js)
```

There is no build, lint, or test setup — `npm test` is the stub that exits 1.

`npm run export` is **interactive**: it launches a headed Chromium, waits for you to log in via SSO/OAuth, and blocks on ENTER in the terminal before doing anything. It cannot be run unattended, so don't invoke it in a way that expects it to terminate on its own.

## Architecture

Everything lives in the single file `export-issues.js` (~430 lines). The pipeline is:

1. **Authenticated fetch** (`exportJiraIssues`) — Playwright launches a real browser so the user can complete SSO; all REST calls then go through `page.request.get()`, which reuses that browser context's cookies. This is the whole reason Playwright is a dependency; there is no API token auth. Two endpoints are used: `/rest/api/3/search/jql` (JQL is hardcoded to `assignee=currentUser()`, `maxResults=50`) and `/rest/api/3/issue/{key}`.
2. **Hierarchy completion** (`fetchAllParentIssues`) — BFS up the `fields.parent` chain, fetching ancestors that weren't in the search results, so every issue has a full Epic → Story → Task chain even when only the leaf was assigned to the user.
3. **Layout** (`generateMarkdown` → `generatePath` → `generateIssueFiles`) — each issue's full parent chain becomes a nested directory path. Non-leaf issues become a folder `KEY-sanitized-summary/` containing a `_<issuetype>.md` info file; only `Sub-task` issues become plain `.md` files. `generateIssueFiles` recurses into children found by scanning the map for matching `fields.parent.key`, so it is called once per root and walks the whole tree.
4. **ADF → Markdown** (`descriptionToMd` and the `process*` helpers) — a hand-rolled recursive converter for Atlassian Document Format. `descriptionToMd` handles block nodes (paragraph, heading, lists, codeBlock, blockquote); `processNode` handles inline nodes and marks (strong, em, code, strike, link). Unhandled node types silently render as empty strings, so missing content in output usually means a new ADF node type needs a `case` here.

## Conventions and gotchas

- Config knobs are edited in source, not passed as flags: the JQL query and the `fields` array are literals near the top of `exportJiraIssues`. Adding a Jira field means adding it to that array *and* rendering it in `generateIssueMd`.
- `allIssuesMap` is a `Map` inside `fetchAllParentIssues` but a plain object everywhere downstream (`generateMarkdown` rebuilds it). Keep the object form when touching `generatePath` / `generateIssueFiles`, which index it with `[key]`.
- Errors in `exportJiraIssues` are caught and logged and the process exits 1. The output directory is cleared and recreated on every run (`prepareOutputDir`, which refuses `/`, `$HOME`, cwd, and the repo root). Per-parent fetch failures are logged and skipped rather than aborting the run.
- `exported-issues/` and `.env` are gitignored; the export is a throwaway artifact.


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

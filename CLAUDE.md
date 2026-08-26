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
- `index.md` links to root folders as `sanitized-summary/...`, while the actual folders are named `KEY-sanitized-summary/` — root-issue links in the index are broken. Fix by using the same `${key}-${sanitizeDir(summary)}` form if you touch that code.
- Errors in `exportJiraIssues` are caught, logged, and swallowed — the process still exits 0. Per-parent fetch failures are logged and skipped rather than aborting the run.
- `exported-issues/` and `.env` are gitignored; the export is a throwaway artifact.

# Plan 008: Encode Jira REST query parameters and make the JQL an env override

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js .env.example test/`
> Plans 001 and 002 are *expected* to have changed `export-issues.js` and
> `test/` (this plan depends on them). Compare the "Current state" excerpts
> below — which describe the code *after* plan 002 — against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md, plans/002-paginate-search-and-report-orphans.md
- **Category**: bug
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

The script builds Jira REST URLs by string interpolation. The JQL query, the
`fields` list, and the parent issue key are dropped into the URL with no
encoding. This only works because the hardcoded JQL (`assignee=currentUser()`)
happens to contain no spaces or reserved characters. The moment anyone
customises the query (which plan 011 will make a first-class feature) —
e.g. `project = ABC AND updated >= -7d` — the request breaks or returns a
400. Encoding with `URLSearchParams` fixes this permanently, and hoisting the
JQL into a `JIRA_JQL` env override gives plan 011 a foundation to build on.

## Current state

Files:

- `export-issues.js` — the whole tool. Contains the two URL-building sites.
- `.env.example` — documents supported env vars (currently `JIRA_URL`, `OUTPUT_DIR`).
- `test/jira.test.js` (or wherever plan 002 put its `searchIssues` fake-page
  test — check `ls test/`) — tests that drive `searchIssues` /
  `fetchAllParentIssues` with a fake `page` object whose `request.get(url)`
  records the URL and returns `{ ok(), status(), json() }`.

Top-level config as originally written (`export-issues.js:7-8`):

```js
const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
```

Original search URL site (`export-issues.js:45-52` at commit dff4ba2). Plan 002
moves this into a `searchIssues(page, jiraUrl, fields)` function that loops over
`nextPageToken`; the interpolation pattern is unchanged and looks like:

```js
const searchResponse = await page.request.get(
  `${JIRA_URL}/rest/api/3/search/jql?jql=assignee=currentUser()&maxResults=50&fields=${fields}`,
  {
    headers: {
      'Accept': 'application/json',
    }
  }
);
```

Parent fetch site (`export-issues.js:387-394` at dff4ba2, inside
`fetchAllParentIssues(issues, page, jiraUrl, fieldsString)`):

```js
const parentResponse = await page.request.get(
  `${jiraUrl}/rest/api/3/issue/${parentKey}?fields=${fieldsString}`,
  {
    headers: {
      'Accept': 'application/json',
    }
  }
);
```

`fields` is the comma-joined string built at `export-issues.js:28-43`
(`'summary,description,status,...,parent'`). Commas are safe in a query string
and Jira accepts either `fields=a,b` or `fields=a%2Cb`; `URLSearchParams`
produces the latter, which is fine.

Conventions: CommonJS, 2-space indent, single quotes, console prefixes
`[*]`/`[+]`/`[-]`. Tests use `node:test` + `node:assert/strict` (see any file
in `test/` for the pattern).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check export-issues.js` | exit 0, no output |
| Tests | `npm test` | all tests pass, exit 0 |
| Single test file | `node --test test/<file>.test.js` | pass |

## Scope

**In scope** (the only files you should modify):
- `export-issues.js`
- `.env.example`
- the test file that contains the `searchIssues` fake-page test (created by plan 002)

**Out of scope** (do NOT touch):
- `README.md`, `CLAUDE.md`, `AGENTS.md` — docs for `JIRA_JQL` are plan 011's job.
- `package.json` — plan 009 owns it.
- Any change to the ADF converter, path generation, or output layout.
- Adding CLI flag parsing — plan 011.

## Git workflow

- Branch: `advisor/008-encode-query-parameters`
- One commit per step is fine; message style: short imperative, e.g.
  `Encode Jira REST query parameters with URLSearchParams`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Hoist the JQL into a top-level env-overridable constant

In `export-issues.js`, directly after the `OUTPUT_DIR` line, add:

```js
const JQL = process.env.JIRA_JQL || 'assignee = currentUser()';
```

Then change `searchIssues` so it uses `JQL` (pass it in as a parameter if the
function already takes its inputs as arguments — keep the existing parameter
style plan 002 chose; if `searchIssues(page, jiraUrl, fields)` exists, extend
it to `searchIssues(page, jiraUrl, fields, jql = JQL)` so tests can pass their
own). Note the default now has spaces around `=` — that is valid JQL and is
exactly the case that the old unencoded URL could not handle.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 2: Build the search URL with `URLSearchParams`

Inside `searchIssues`, replace the interpolated URL with:

```js
const params = new URLSearchParams({
  jql,
  maxResults: String(maxResults),
  fields,
});
if (nextPageToken) params.set('nextPageToken', nextPageToken);
const url = `${jiraUrl}/rest/api/3/search/jql?${params.toString()}`;
```

(`maxResults` and `nextPageToken` are whatever local names plan 002 used in its
pagination loop — reuse them.) Keep the `Accept: application/json` header.

**Verify**: `node --check export-issues.js` → exit 0; `npm test` → the
existing pagination test still passes (the fake page ignores the URL contents).

### Step 3: Encode the parent key and fields in `fetchAllParentIssues`

Replace the interpolated parent URL with:

```js
const params = new URLSearchParams({ fields: fieldsString });
const url = `${jiraUrl}/rest/api/3/issue/${encodeURIComponent(parentKey)}?${params.toString()}`;
```

**Verify**: `node --check export-issues.js` → exit 0; `npm test` → pass.

### Step 4: Assert the encoded URL in the fake-page test

In the test file that exercises `searchIssues` with a fake `page`, make the
fake record the URL it receives (e.g. push into an array in `request.get(url)`),
call `searchIssues` with the default JQL, and assert:

```js
assert.ok(urls[0].includes('/rest/api/3/search/jql?'));
assert.ok(urls[0].includes('jql=assignee+%3D+currentUser%28%29'));
assert.ok(urls[0].includes('maxResults='));
assert.ok(urls[0].includes('fields=summary%2Cdescription'));
```

`URLSearchParams` encodes spaces as `+`, `=` as `%3D`, `(` as `%28`, `)` as
`%29`, and `,` as `%2C` — the strings above are exact.

Add a second case passing a custom JQL with spaces and a quoted string, e.g.
`project = "My Proj" AND updated >= -7d`, and assert the URL contains
`jql=project+%3D+%22My+Proj%22+AND+updated+%3E%3D+-7d`.

Add a `fetchAllParentIssues` case with a parent key like `ABC-12` and assert the
recorded URL contains `/rest/api/3/issue/ABC-12?fields=`.

**Verify**: `npm test` → all pass, including the 3 new assertions/cases.

### Step 5: Document the override in `.env.example`

Append to `.env.example`:

```
# Optional: override the JQL used to select issues (default: assignee = currentUser())
# JIRA_JQL=project = ABC AND updated >= -30d
```

**Verify**: `grep -c JIRA_JQL .env.example` → `2`.

## Test plan

- Encoded default JQL appears in the search URL (exact string above).
- Custom JQL with spaces/quotes is encoded, not passed raw.
- Parent fetch URL uses the encoded key and `fields=` param.
- Pattern: model after the existing fake-page test from plan 002 in `test/`.
- Verification: `npm test` → all pass.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0 with the new URL-encoding assertions present
- [ ] `grep -n 'jql=assignee' export-issues.js` returns no matches (no raw interpolation left)
- [ ] `grep -n 'JIRA_JQL' export-issues.js .env.example` shows one hit in each file
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 002 has not landed (no `searchIssues` function in `export-issues.js`).
- `searchIssues` in the live code has a different signature than described and
  it is not obvious how to thread the `jql` argument through.
- No test in `test/` uses a fake `page` object (the test harness this plan
  builds on is missing).
- `npm test` fails for a reason unrelated to this change before you start.

## Maintenance notes

- Plan 011 (configurable JQL via CLI/env) should extend `JQL` here rather than
  adding a second config path. Any new query parameter must go through
  `URLSearchParams`, never string interpolation.
- Reviewer: check that `maxResults` is stringified (URLSearchParams coerces,
  but be explicit) and that `nextPageToken` is only set when present — Jira
  rejects an empty `nextPageToken=`.
- Deferred: validating the JQL before sending (Jira returns a 400 with a
  useful message; surface that in the error path from plan 007 instead).

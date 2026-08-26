# Plan 002: Fetch every page of search results and never silently drop orphaned issues

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/`
> Plan 001 is expected to have changed these files (it adds `module.exports`
> and the `test/` directory). Beyond that, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md
- **Category**: bug
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

Two independent defects make issues silently vanish from the export, and
nothing in the log tells the user. First, the JQL search fetches exactly one
page of at most 50 issues and never follows the pagination token, so anyone
with more than 50 assigned issues gets a partial export. Second, when a parent
issue cannot be fetched (deleted, permission denied, transient error), the
child that references it is neither treated as a root nor found as anyone's
child, so its whole subtree is dropped from the output. After this plan lands,
every issue the search returns is exported, and issues with an unavailable
parent are exported at the top level with a visible warning.

## Current state

The whole tool is one file, `export-issues.js` (CommonJS, ~430 lines before
plan 001). Relevant parts:

- `export-issues.js:45-59` — one-shot search request, no pagination:

```js
    const searchResponse = await page.request.get(
      `${JIRA_URL}/rest/api/3/search/jql?jql=assignee=currentUser()&maxResults=50&fields=${fields}`,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!searchResponse.ok()) {
      throw new Error(`API error: ${searchResponse.status()}`);
    }

    const searchData = await searchResponse.json();
    console.log(`[+] Found ${searchData.issues.length} assigned issues`);
```

  `/rest/api/3/search/jql` is Jira Cloud's token-paginated endpoint. Each
  response has the shape `{ issues: [...], isLast: boolean, nextPageToken?: string }`.
  To get the next page you repeat the same request with an extra
  `&nextPageToken=<token>` query parameter. The last page has
  `isLast: true` and no `nextPageToken`.

- `export-issues.js:62` — the search results are handed to the parent walker:

```js
    const allIssues = await fetchAllParentIssues(searchData.issues, page, JIRA_URL, fields);
```

- `export-issues.js:89-90` — root detection inside `generateMarkdown`:

```js
  // Find root issues (those without parent)
  const rootIssues = issues.filter(issue => !issue.fields.parent);
```

- `export-issues.js:176-179` — child lookup inside `generateIssueFiles`:

```js
  // Find and generate child issues
  const children = Object.values(allIssuesMap).filter(
    child => child.fields.parent?.key === issue.key
  );
```

- `export-issues.js:396-404` — parent fetch failure is logged and skipped,
  leaving the child pointing at a key that is not in the map:

```js
        if (parentResponse.ok()) {
          const parentIssue = await parentResponse.json();
          processedKeys.add(parentKey);
          allIssuesMap.set(parentKey, parentIssue);
          queue.push(parentIssue);
          console.log(`[+] Fetched: ${parentKey}`);
        } else {
          console.log(`[-] Failed to fetch ${parentKey}: ${parentResponse.status()}`);
        }
```

- `export-issues.js:365` — `fetchAllParentIssues(issues, page, jiraUrl, fieldsString)`
  is the existing network helper; the new `searchIssues` function should sit
  directly above it and follow the same style (uses `page.request.get`, passes
  the `Accept: application/json` header, logs with `[*]`/`[+]`/`[-]` prefixes).

Conventions: CommonJS `require`, 2-space indent, single quotes, no semicolon
omission, console prefixes `[*]` (progress), `[+]` (success), `[-]` (failure).
No linter or formatter exists — match the surrounding code by eye.

After plan 001, the bottom of `export-issues.js` contains a
`module.exports = { ... }` object listing the pure functions plus
`fetchAllParentIssues`, and the entry call is guarded by
`if (require.main === module)`. Tests live in `test/adf.test.js` and
`test/layout.test.js` and use `node:test` + `node:assert/strict`. The
`fetchAllParentIssues` test in `test/layout.test.js` shows the fake-`page`
pattern to copy:

```js
const fakePage = {
  request: {
    get: async (url) => ({
      ok: () => true,
      status: () => 200,
      json: async () => ({ /* payload keyed off url */ }),
    }),
  },
};
```

## Commands you will need

| Purpose      | Command                          | Expected on success |
|--------------|----------------------------------|---------------------|
| Syntax check | `node --check export-issues.js`  | exit 0, no output   |
| Tests        | `npm test`                       | all tests pass, exit 0 |

Do NOT run `npm run export` — it opens a browser and requires interactive
Jira login. It is not a verification step.

## Scope

**In scope** (the only files you should modify):
- `export-issues.js`
- `test/layout.test.js`

**Out of scope** (do NOT touch, even though they look related):
- The `fields` array (`export-issues.js:28-43`) — plan 011 makes it configurable.
- URL encoding of the JQL/fields query string — plan 008 handles it; keep the
  string interpolation style exactly as it is today.
- `fetchAllParentIssues` retry behaviour — failures stay logged-and-skipped;
  this plan only changes how the *downstream* layout copes with them.
- `README.md`, `CLAUDE.md`, `AGENTS.md`.

## Git workflow

- Branch: `advisor/002-paginate-search-and-report-orphans`
- One commit per step below; message style is short imperative, e.g.
  `Add CLAUDE.md with project commands and architecture notes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a paginating `searchIssues` function

In `export-issues.js`, directly above `async function fetchAllParentIssues(`,
add:

```js
async function searchIssues(page, jiraUrl, fieldsString) {
  const issues = [];
  let nextPageToken;

  do {
    const tokenParam = nextPageToken ? `&nextPageToken=${nextPageToken}` : '';
    const response = await page.request.get(
      `${jiraUrl}/rest/api/3/search/jql?jql=assignee=currentUser()&maxResults=100&fields=${fieldsString}${tokenParam}`,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!response.ok()) {
      throw new Error(`API error: ${response.status()}`);
    }

    const data = await response.json();
    issues.push(...(data.issues || []));
    console.log(`[*] Fetched ${issues.length} issues so far`);

    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);

  return issues;
}
```

Then replace lines 45-59 (the `searchResponse` block through the
`console.log('[+] Found ...')` line) inside `exportJiraIssues` with:

```js
    const searchIssuesResult = await searchIssues(page, JIRA_URL, fields);
    console.log(`[+] Found ${searchIssuesResult.length} assigned issues`);
```

and change line 62 to pass `searchIssuesResult` instead of
`searchData.issues`.

Add `searchIssues` to the `module.exports` object at the bottom of the file.

**Verify**: `node --check export-issues.js` → exit 0. `grep -n "maxResults=50" export-issues.js` → no output.

### Step 2: Test pagination with a fake page

In `test/layout.test.js`, add a test that builds a fake `page` whose
`request.get` returns page 1 (`{ issues: [A], isLast: false, nextPageToken: 'tok1' }`)
when the URL does not contain `nextPageToken=`, and page 2
(`{ issues: [B], isLast: true }`) when it does. Assert:

- `searchIssues(fakePage, 'https://x.atlassian.net', 'summary')` resolves to
  `[A, B]` (length 2, keys in order).
- `request.get` was called exactly twice and the second URL contains
  `nextPageToken=tok1`.
- A separate case: a single response with `isLast: true` and no
  `nextPageToken` makes exactly one call.
- A separate case: a response with `ok: () => false, status: () => 401`
  rejects with an error whose message contains `401`.

Fake issue objects can be minimal: `{ key: 'A-1', fields: { summary: 'a' } }`.

**Verify**: `npm test` → all pass, including the 3 new `searchIssues` cases.

### Step 3: Treat issues with an unavailable parent as roots

In `generateMarkdown` (`export-issues.js:89-90`), replace the root filter with:

```js
  // Root issues: no parent, or a parent that could not be fetched
  const rootIssues = issues.filter(issue => {
    const parentKey = issue.fields.parent?.key;
    if (!parentKey) return true;
    if (allIssuesMap[parentKey]) return false;
    console.log(`[-] Parent ${parentKey} of ${issue.key} not available; exporting ${issue.key} at top level`);
    return true;
  });
```

`generatePath` (`export-issues.js:121-139`) already stops walking when
`allIssuesMap[current.fields.parent?.key]` is undefined, so an orphan's path
chain naturally starts at the orphan itself — no change needed there.
`generateIssueFiles` (`:176-179`) finds children by `parent.key === issue.key`,
so orphans are never double-exported as somebody's child. Do not change
either function.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 4: Test orphan handling

`generateMarkdown` writes to the `OUTPUT_DIR` env var and must not be called
against the repo. Instead, in `test/layout.test.js`, reproduce the root filter
logic by testing through `generateIssueFiles` and a small helper: build a map
with `ORPH-2` (Task, `fields.parent = { key: 'GONE-1' }`, `GONE-1` absent) and
`ORPH-3` (Sub-task, parent `ORPH-2`). Call
`generateIssueFiles(ORPH-2, generatePath(ORPH-2, map), tmpDir, map)` and assert:

- `tmpDir/ORPH-2-<slug>/_task.md` exists.
- `tmpDir/ORPH-2-<slug>/ORPH-3-<slug>.md` exists.
- No directory named `GONE-1*` exists in `tmpDir`.

Additionally, to lock in the new root filter itself, temporarily set
`process.env.OUTPUT_DIR` to a fresh `fs.mkdtempSync` directory **before**
`require('../export-issues')` in a *new* test file `test/orphans.test.js`
(the module reads `OUTPUT_DIR` at load time, line 8). Call
`generateMarkdown([ORPH-2, ORPH-3])` and assert the same two files exist under
that temp dir and that `index.md` lists `ORPH-2`. Keep this file separate so
the env override cannot leak into `test/layout.test.js`.

**Verify**: `npm test` → all pass, including the new orphan cases.

## Test plan

- `test/layout.test.js`: 3 `searchIssues` cases (two pages, single page, non-OK
  status) and 1 `generateIssueFiles` orphan-subtree case, modelled on the
  existing `fetchAllParentIssues` fake-page test and the existing
  `generateIssueFiles` temp-dir test from plan 001.
- `test/orphans.test.js` (create): 1 `generateMarkdown` case with
  `OUTPUT_DIR` pointed at a temp dir.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0; tests named for `searchIssues` and orphan handling exist and pass
- [ ] `grep -n "maxResults=50" export-issues.js` returns nothing
- [ ] `grep -n "nextPageToken" export-issues.js` returns at least 2 matches
- [ ] `grep -n "searchIssues" export-issues.js` shows the definition, the call in `exportJiraIssues`, and the `module.exports` entry
- [ ] `git status` shows only `export-issues.js`, `test/layout.test.js`, `test/orphans.test.js`, and `plans/README.md` modified/added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `module.exports` or `test/layout.test.js` does not exist — plan 001 has not
  landed; this plan depends on it.
- The code at `export-issues.js:45-59`, `:89-90`, or `:396-404` does not match
  the excerpts above (allowing for line-number shifts from plan 001).
- `npm test` fails twice after a reasonable fix attempt.
- You find that `generatePath` does *not* stop at a missing parent (i.e. it
  throws on `allIssuesMap[undefined]`) — the orphan approach in Step 3 relies
  on it terminating cleanly.

## Maintenance notes

- Plan 008 (URL-encode the query string) and plan 011 (configurable JQL) both
  edit the URL built in `searchIssues`; whoever lands those must keep the
  `nextPageToken` parameter.
- Reviewers should check that the `do { } while (nextPageToken)` loop cannot
  spin forever: it exits when `isLast` is true *or* the token is absent.
- Deferred: retrying failed parent fetches. Orphans are now visible in the
  output and the log, which is the minimum; retries are a separate decision.

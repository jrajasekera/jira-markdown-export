# Plan 011: Make the query, result cap and extra fields configurable via env vars

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js .env.example README.md test/`
> Plans 001, 002 and 008 are expected to have changed `export-issues.js`.
> Confirm the post-008 shape described in "Current state" (a top-level `JQL`
> constant and a `searchIssues` function) exists; if not, STOP.

## Status

- **Priority**: P3
- **Effort**: S–M (coarse; spike — the code is small, the judgement is in what *not* to add)
- **Risk**: LOW — every new knob defaults to today's behaviour
- **Depends on**: plans/008-encode-query-parameters.md (adds `JIRA_JQL` and `URLSearchParams`), plans/002-paginate-search-and-report-orphans.md (adds `searchIssues`)
- **Category**: direction
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

`CLAUDE.md` says it outright: "Config knobs are edited in source, not passed as
flags: the JQL query and the `fields` array are literals near the top of
`exportJiraIssues`." `assignee = currentUser()` is only one of the queries
people want — a whole project, a sprint, or `updated >= -7d` for an
incremental refresh. Plan 008 already hoists the JQL into `JIRA_JQL`; this
plan finishes the job with a result cap and an extra-fields list, and
documents worked examples so users never open the source to configure a run.
Explicit non-goal: a CLI argument parser. `dotenv` is already the config path
and adds no dependency.

## Current state

- `export-issues.js` — the whole tool.
- `.env.example` — `JIRA_URL`, `OUTPUT_DIR` (plus `JIRA_JQL` after plan 008, `JIRA_STATE_FILE` after 010 if it landed).
- `README.md` — "Installation" step 3 shows the `.env` contents.

Field list as written at `dff4ba2` (`export-issues.js:28-43`):

```js
    const fields = [
      'summary',
      'description',
      'status',
      'priority',
      'assignee',
      'created',
      'updated',
      'issuetype',
      'issuelinks',
      'components',
      'labels',
      'resolution',
      'comment',
      'parent'
    ].join(',');
```

Note `components`, `labels` and `resolution` are fetched but never rendered by
`generateIssueMd` (`export-issues.js:202-247`) — the metadata block today is:

```js
## Metadata
- **Updated:** ${new Date(updated).toISOString().split('T')[0]}
```

Expected shape after plan 008 (confirm during drift check):

```js
const JQL = process.env.JIRA_JQL || 'assignee = currentUser()';
```

and, after plan 002, an exported `async function searchIssues(page, jiraUrl, fields)` that loops over `nextPageToken` and returns the full issue array.

Conventions to match: CommonJS, 2-space, single quotes, `[*]`/`[+]`/`[-]` log
prefixes, env vars via `dotenv`, no new dependencies. Tests use `node:test` in
`test/`; the fake-page pattern for `searchIssues` is in `test/layout.test.js`
(from plan 002).

## Commands you will need

| Purpose | Command                         | Expected on success |
|---------|---------------------------------|---------------------|
| Syntax  | `node --check export-issues.js` | exit 0              |
| Tests   | `npm test`                      | all pass            |

## Scope

**In scope**:
- `export-issues.js`
- `test/config.test.js` (create)
- `test/layout.test.js` (add one `searchIssues` cap test, if `searchIssues` tests live there; otherwise the file plan 002 created)
- `.env.example`
- `README.md`

**Out of scope**:
- A `--jql`/`--out` CLI via `process.argv`. Recommended answer to the open question: **no** — two config paths (env + argv) doubles documentation for no gain while the tool has one user per run. Revisit only if a scheduler needs per-invocation overrides.
- Rendering `components`/`labels`/`resolution` properly — tempting, but a separate small change; note it in maintenance.
- Any change to the ADF converter or path layout.

## Git workflow

- Branch: `advisor/011-configurable-query-and-output`
- Short imperative commits, e.g. `Add JIRA_MAX_ISSUES cap`, `Render extra fields in metadata`.
- Do NOT push.

## Steps

### Step 1: Add the constants

Next to `JQL` at the top of `export-issues.js`:

```js
// 0 (default) = no cap; otherwise stop after this many search results.
const MAX_ISSUES = Number(process.env.JIRA_MAX_ISSUES || 0);
// Comma-separated extra Jira field ids appended to the request, e.g. "customfield_10016,duedate".
const EXTRA_FIELDS = (process.env.JIRA_FIELDS_EXTRA || '')
  .split(',')
  .map(f => f.trim())
  .filter(Boolean);
```

Add a pure helper (and export it) so parsing is testable without env juggling:

```js
function parseExtraFields(value) {
  return (value || '').split(',').map(f => f.trim()).filter(Boolean);
}
```

and define `EXTRA_FIELDS = parseExtraFields(process.env.JIRA_FIELDS_EXTRA)`.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 2: Apply the cap in `searchIssues`

Give `searchIssues` a fourth parameter `maxIssues = 0`. Inside the pagination
loop, after pushing a page's issues: if `maxIssues > 0 && all.length >= maxIssues`,
truncate `all` to `maxIssues`, log `[*] Stopping at JIRA_MAX_ISSUES=${maxIssues}`,
and break. Pass `MAX_ISSUES` from the call site in `exportJiraIssues`.

Do not change the per-page `maxResults` value.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 3: Append extra fields and render them

At the field list, change `].join(',')` to `].concat(EXTRA_FIELDS).join(',')`.

In `generateIssueMd`, under the `## Metadata` bullet for Updated, render each
extra field. `generateIssueMd` does not know the list, so read it from the
module constant `EXTRA_FIELDS` but allow an override for tests: add a second
parameter `extraFields = EXTRA_FIELDS` (if plan 005 already added a second
parameter for the parent issue, add this as the *third*). Rendering rule,
kept deliberately dumb:

```js
function formatFieldValue(value) {
  if (value == null) return 'N/A';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(formatFieldValue).join(', ') || 'N/A';
  if (value.displayName) return value.displayName;
  if (value.name) return value.name;
  if (value.value) return String(value.value);
  return JSON.stringify(value);
}
```

and per field: `- **${fieldId}:** ${formatFieldValue(fields[fieldId])}`.
Export `formatFieldValue`.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 4: Tests

Create `test/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExtraFields, formatFieldValue, generateIssueMd } = require('../export-issues.js');

test('parseExtraFields trims and drops empties', () => {
  assert.deepEqual(parseExtraFields(' a, b ,,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseExtraFields(undefined), []);
});

test('formatFieldValue handles scalars, named objects, arrays, null', () => {
  assert.equal(formatFieldValue(5), '5');
  assert.equal(formatFieldValue({ name: 'Backend' }), 'Backend');
  assert.equal(formatFieldValue([{ name: 'a' }, { name: 'b' }]), 'a, b');
  assert.equal(formatFieldValue(null), 'N/A');
});

test('generateIssueMd renders extra fields under Metadata', () => {
  const issue = {
    key: 'T-1',
    fields: {
      summary: 's', issuetype: { name: 'Task', subtask: false },
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z',
      duedate: '2026-02-01', customfield_10016: 3,
    },
  };
  const md = generateIssueMd(issue, /* parent */ undefined, ['duedate', 'customfield_10016']);
  assert.match(md, /- \*\*duedate:\*\* 2026-02-01/);
  assert.match(md, /- \*\*customfield_10016:\*\* 3/);
});
```

Adjust the `generateIssueMd` argument position to match Step 3's decision.

Add a cap test next to the existing `searchIssues` test: a fake page that
returns two pages of 2 issues each; `searchIssues(page, url, 'summary', 3)`
resolves to exactly 3 issues.

**Verify**: `npm test` → all pass, including the new tests.

### Step 5: Document

`.env.example` — append:

```
# JQL to export. Examples:
#   assignee = currentUser()                 (default)
#   project = ABC AND statusCategory != Done
#   sprint in openSprints() AND assignee = currentUser()
#   assignee = currentUser() AND updated >= -7d   (incremental refresh)
# JIRA_JQL=assignee = currentUser()

# Stop after this many issues (0 = unlimited).
# JIRA_MAX_ISSUES=0

# Extra field ids to fetch and list under Metadata, comma-separated.
# JIRA_FIELDS_EXTRA=duedate,customfield_10016
```

`README.md` — add a "Configuration" section after "Installation" that lists
all env vars in one table (`JIRA_URL`, `OUTPUT_DIR`, `JIRA_JQL`,
`JIRA_MAX_ISSUES`, `JIRA_FIELDS_EXTRA`, and `JIRA_STATE_FILE` if plan 010 has
landed) with the same example JQLs. Remove the sentence in `CLAUDE.md`? **No** —
`CLAUDE.md` is out of scope; leave a note in the status row that its "config
knobs are edited in source" line is now stale.

**Verify**: `grep -c JIRA_MAX_ISSUES .env.example README.md` → ≥1 each.

## Test plan

- `test/config.test.js`: parsing, value formatting, metadata rendering.
- `searchIssues` cap test with a two-page fake.
- Live: optional, with operator approval — `JIRA_MAX_ISSUES=3 npm run export` should log the stop message and produce ≤3 assigned issues (plus fetched parents).

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0 with the new tests present
- [ ] `grep -n "JIRA_MAX_ISSUES\|JIRA_FIELDS_EXTRA" export-issues.js .env.example README.md` hits all three files
- [ ] Default run behaviour unchanged: with none of the new vars set, `parseExtraFields(undefined)` is `[]` and the cap is 0
- [ ] Only in-scope files modified

## STOP conditions

- `searchIssues` or the `JQL` constant does not exist (plans 002/008 not landed).
- `generateIssueMd`'s signature already has three parameters for another reason — report rather than guess the order.
- Any step requires a new dependency or an argv parser.

## Maintenance notes

- `components`, `labels`, `resolution` are requested but not rendered; a follow-up could render them with `formatFieldValue` in two lines.
- `CLAUDE.md` and `AGENTS.md` describe config as source literals — update both once this lands.
- If a CLI is ever added, keep env vars as the source of truth and let flags override them, so scripts written against `.env` keep working.

# Plan 001: Establish a unit-test baseline for the pure functions in `export-issues.js`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js package.json test/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

The repo has zero automated tests; `npm test` is a stub that exits 1. The only
verification available today is `node --check export-issues.js` (syntax only).
The real work — ADF→Markdown conversion, path/folder layout, Markdown rendering,
parent-chain BFS — is pure logic that can be tested without a browser or Jira,
but nothing is exported from the module, so it cannot be imported. Every later
bug-fix plan (pagination, link marks, subtask detection, broken index links, ADF
gaps) is otherwise only verifiable by a live, interactive SSO login. This plan
makes the functions importable, adds Node's built-in test runner, and writes
tests that pin down *current* behaviour — including known bugs, which are marked
as characterization tests so later plans can flip them.

## Current state

- `export-issues.js` — the whole tool (429 lines). Pipeline: `exportJiraIssues`
  (browser + REST) → `fetchAllParentIssues` (BFS up parent chain) →
  `generateMarkdown` → `generatePath` / `generateIssueFiles` → `generateIssueMd`
  → `descriptionToMd` / `processNode` (ADF → Markdown).
- `package.json` — `"test": "echo \"Error: no test specified\" && exit 1"`.
- No `test/` directory exists.

Relevant excerpts (line numbers from commit `dff4ba2`):

```js
// export-issues.js:1-8
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
```

```js
// export-issues.js:428-429  — the module runs the export on require. This is
// what must be guarded so tests can import the file.
// Run the export
exportJiraIssues();
```

Function locations (all top-level `function` declarations, hoisted):

| Function | Lines | Notes |
|---|---|---|
| `exportJiraIssues` | 10–75 | launches browser; NOT tested |
| `generateMarkdown(issues)` | 77–119 | writes into `OUTPUT_DIR` (from env) — do **not** call in tests against the repo dir |
| `generatePath(issue, allIssuesMap)` | 121–139 | returns `{ path: [{key,type,summary}...], isFile }`; `isFile` is `issuetype.name.toLowerCase() === 'sub-task'` (line 136) |
| `generateIssueFiles(issue, pathInfo, baseDir, allIssuesMap)` | 141–185 | creates `KEY-sanitized-summary/` folders, writes `_<type>.md`, subtask `.md` files; recurses into children by scanning `allIssuesMap` for `fields.parent.key === issue.key` |
| `sanitizeFilename(key, summary)` | 187–193 | `KEY-` + lowercased, `[^a-z0-9]+`→`-`, trimmed `-` |
| `sanitizeDir(summary)` | 195–200 | same without key prefix |
| `generateIssueMd(issue)` | 202–247 | Markdown document; parent link is `[KEY](../KEY)` (line 218) |
| `descriptionToMd(content)` | 249–289 | block nodes: paragraph, heading, bulletList, orderedList, codeBlock, blockquote; default → `''` |
| `processListItem(item)` | 291–303 | only `paragraph` children rendered |
| `processContent(content)` | 305–311 | maps `processNode` and joins |
| `processParagraph(content)` | 313–315 | alias of `processContent` |
| `processNode(node)` | 317–363 | text with marks strong/em/code/strike (no `link` case), hardBreak, inlineCard, mention, emoji; default → `''` |
| `fetchAllParentIssues(issues, page, jiraUrl, fieldsString)` | 365–412 | BFS; uses `page.request.get(url, {headers})` → object with `.ok()`, `.status()`, `.json()` |
| `waitForUserInput` | 414–426 | stdin; NOT tested |

Excerpt of the mark handling (the `link` mark is missing — this is a known bug,
fixed in plan 003; here we only characterize it):

```js
// export-issues.js:326-341
node.marks.forEach(mark => {
  switch (mark.type) {
    case 'strong':
      text = `**${text}**`;
      break;
    case 'em':
      text = `*${text}*`;
      break;
    case 'code':
      text = `\`${text}\``;
      break;
    case 'strike':
      text = `~~${text}~~`;
      break;
  }
});
```

Repo conventions to match: CommonJS (`require`/`module.exports`), 2-space
indent, single quotes, semicolons, console prefixes `[*]`/`[+]`/`[-]`. No lint
or formatter exists. Commit messages are short imperatives, e.g.
`Add CLAUDE.md with project commands and architecture notes`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node version | `node --version` | `v18` or newer (v20+ preferred) |
| Syntax check | `node --check export-issues.js` | exit 0, no output |
| Install | `npm install` | exit 0 (`playwright` + `dotenv`; no new deps are added by this plan) |
| Tests | `npm test` | `node --test` runs; `# fail 0` |
| Single file | `node --test test/adf.test.js` | `# fail 0` |

Note: `require('playwright')` at line 1 must resolve, so `npm install` is
required before tests can import the module. `npx playwright install` (browser
download) is NOT required for tests.

## Scope

**In scope** (the only files you should modify/create):
- `export-issues.js` — only the last lines (guard + `module.exports`); no logic changes
- `package.json` — only the `"test"` script
- `test/adf.test.js` (create)
- `test/layout.test.js` (create)
- `test/fetch.test.js` (create)
- `plans/README.md` — status row only

**Out of scope** (do NOT touch, even though they look related):
- Any behaviour change in `export-issues.js` — this plan characterizes bugs, it does not fix them. Link marks (plan 003), subtask detection (plan 004), index/parent links (plan 005), pagination (plan 002), ADF gaps (plan 006) are separate plans.
- Splitting `export-issues.js` into modules — deliberately not done; keep the single-file layout.
- `package.json` fields other than `scripts.test` (`engines`, `main`, `private` are plan 009).
- `.gitignore`, `README.md`, `CLAUDE.md`, `AGENTS.md`.

## Git workflow

- Branch: `advisor/001-test-baseline`
- One commit per step (or one for steps 3–5 together). Message style: short imperative, e.g. `Export pure functions and guard the CLI entry point`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Guard the entry point and export the functions

In `export-issues.js`, replace the final two lines

```js
// Run the export
exportJiraIssues();
```

with

```js
module.exports = {
  descriptionToMd,
  processNode,
  processContent,
  processListItem,
  sanitizeFilename,
  sanitizeDir,
  generatePath,
  generateIssueFiles,
  generateIssueMd,
  generateMarkdown,
  fetchAllParentIssues,
};

// Run the export only when invoked directly (`node export-issues.js`),
// not when required by tests.
if (require.main === module) {
  exportJiraIssues();
}
```

Do not change anything else in the file.

**Verify**: `node --check export-issues.js` → exit 0.
**Verify**: `node -e "const m = require('./export-issues.js'); console.log(Object.keys(m).length)"` → prints `11` and exits immediately **without opening a browser**. (Requires `npm install` to have been run.)

### Step 2: Point `npm test` at the built-in runner

In `package.json`, change

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

to

```json
"test": "node --test"
```

`node --test` with no args discovers `test/**/*.test.js` automatically (Node ≥ 18).

**Verify**: `npm test` → exits 0 with `# tests 0` (no test files yet) — or, on some Node versions, exits 0 with no tests listed. Either is fine; it must not exit 1.

### Step 3: Write `test/adf.test.js`

Use `node:test` and `node:assert/strict`. Structure:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { descriptionToMd, processNode } = require('../export-issues.js');

// ADF helper builders keep fixtures short
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', content });

test('paragraph with marks', () => {
  const md = descriptionToMd([
    para(text('a', [{ type: 'strong' }]), text(' '), text('b', [{ type: 'em' }]),
         text(' '), text('c', [{ type: 'code' }]), text(' '), text('d', [{ type: 'strike' }])),
  ]);
  assert.equal(md, '**a** *b* `c` ~~d~~');
});
```

Cover, each as its own `test(...)`, asserting the exact string produced by the
current code:

1. `heading` level 2 → `## Title`; missing `attrs.level` → `# Title`.
2. `bulletList` with two `listItem`s each containing a paragraph → `- one\n- two`.
3. `orderedList` with two items → `1. one\n2. two`.
4. `codeBlock` with `attrs.language: 'js'` and one text node → `` ```js\ncode\n``` ``; without language → `` ```\ncode\n``` ``.
5. `blockquote` containing two paragraphs → each line prefixed `> `, paragraphs separated by `> ` blank line (the current code does `quoteText.split('\n').map(l => '> ' + l)` on paragraphs joined with `\n\n`, giving `> first\n> \n> second`).
6. `hardBreak` inside a paragraph → `\n` between the texts.
7. `mention` with `attrs.text: '@Jane'` → `@@Jane`? — **check**: current code emits `@${node.attrs.text}`; Jira sets `attrs.text` to `@Jane` already, so assert whatever the code emits for the fixture you give it (`attrs.text: 'Jane'` → `@Jane`).
8. `inlineCard` with `attrs.url` → `[Link](url)`.
9. `emoji` with `attrs.shortName: ':smile:'` → `:smile:`.
10. Two blocks are joined with a blank line (`\n\n`); empty/unknown blocks are filtered out: `[para(text('x')), { type: 'rule' }, para(text('y'))]` → `x\n\ny`.
11. Unknown block type (e.g. `{ type: 'table' }`) → `descriptionToMd([...])` returns `''`.
12. Unknown inline node → `processNode({ type: 'somethingNew' })` returns `''`.
13. `descriptionToMd(null)` → `'No description'`.
14. **Characterization** — link mark is dropped:
    ```js
    // characterization: fixed in plan 003 (link marks currently render as plain text)
    test('link mark currently renders as plain text', () => {
      const md = descriptionToMd([para(text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]))]);
      assert.equal(md, 'site');
    });
    ```
15. **Characterization** — nested list is dropped: a `listItem` whose content is `[paragraph, bulletList]` renders only the paragraph text (`// characterization: fixed in plan 006`).

**Verify**: `node --test test/adf.test.js` → `# fail 0`, `# pass` ≥ 15.

### Step 4: Write `test/layout.test.js`

Imports: `sanitizeFilename`, `sanitizeDir`, `generatePath`, `generateIssueFiles`,
`generateIssueMd` from `../export-issues.js`; plus `fs`, `os`, `path`.

Fixture: a small issue tree, as plain objects shaped like Jira responses:

```js
const issue = (key, typeName, summary, parentKey) => ({
  key,
  fields: {
    summary,
    issuetype: { name: typeName },
    status: { name: 'To Do' },
    priority: { name: 'Medium' },
    assignee: { displayName: 'Ada' },
    created: '2026-01-02T03:04:05.000+0000',
    updated: '2026-01-03T03:04:05.000+0000',
    description: null,
    issuelinks: [],
    comment: { comments: [] },
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  },
});
const epic = issue('PRJ-1', 'Epic', 'Big Epic!');
const story = issue('PRJ-2', 'Story', 'A story', 'PRJ-1');
const sub = issue('PRJ-3', 'Sub-task', 'Do thing', 'PRJ-2');
const map = { 'PRJ-1': epic, 'PRJ-2': story, 'PRJ-3': sub };
```

Tests:

1. `sanitizeDir('  Hello, World! ')` → `hello-world`; `sanitizeDir('---x---')` → `x`; `sanitizeDir('Ünïcode ñ')` → `n-code` (non-ASCII letters are stripped by `[^a-z0-9]+`; compute the exact expected value by reasoning through the regex: `'ünïcode ñ'` → `-n-code-` → `n-code`). If your computed value disagrees with the runtime, assert the runtime value and add a comment — this is characterization, not a spec.
2. `sanitizeFilename('PRJ-3', 'Do thing')` → `PRJ-3-do-thing`.
3. `generatePath(sub, map)` → `path` has 3 entries with keys `PRJ-1, PRJ-2, PRJ-3` in that order and `isFile === true`; `generatePath(story, map)` → 2 entries, `isFile === false`.
4. **Characterization** (`// characterization: fixed in plan 004`): an issue with `issuetype: { name: 'Subtask', subtask: true }` currently yields `isFile === false`.
5. `generateIssueFiles(epic, generatePath(epic, map), tmpDir, map)` where `tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'))` produces exactly these paths (use `fs.existsSync`):
   - `PRJ-1-big-epic/_epic.md`
   - `PRJ-1-big-epic/PRJ-2-a-story/_story.md`
   - `PRJ-1-big-epic/PRJ-2-a-story/PRJ-3-do-thing.md`
   Clean up with `fs.rmSync(tmpDir, { recursive: true, force: true })` in a `finally`.
6. `generateIssueMd(sub)`:
   - first line is `# PRJ-3 - Do thing`
   - contains `**Type:** Sub-task | **Status:** To Do | **Priority:** Medium`
   - contains `**Created:** 2026-01-02`
   - contains `No description`
   - **Characterization** (`// characterization: fixed in plan 005`): contains `**Parent:** [PRJ-2](../PRJ-2)` (this link is broken — folders are named `PRJ-2-a-story`).
7. `generateIssueMd` with one comment `{ author: { displayName: 'Bob' }, created: '2026-02-01T00:00:00.000+0000', body: { content: [para(text('hi'))] } }` → output contains `### Comment 1`, `**Author:** Bob | **Date:** 2026-02-01`, and `hi`.

Do NOT call `generateMarkdown` in tests: it writes to `OUTPUT_DIR` resolved from
the environment (`./exported-issues` by default) and would pollute the repo.

**Verify**: `node --test test/layout.test.js` → `# fail 0`.

### Step 5: Write `test/fetch.test.js`

Test `fetchAllParentIssues` with a fake `page`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllParentIssues } = require('../export-issues.js');

function fakePage(byKey) {
  const calls = [];
  return {
    calls,
    request: {
      async get(url) {
        calls.push(url);
        const key = url.match(/\/issue\/([^?]+)/)[1];
        const found = byKey[key];
        return {
          ok: () => Boolean(found),
          status: () => (found ? 200 : 404),
          json: async () => found,
        };
      },
    },
  };
}
```

Tests:

1. Leaf `PRJ-3` (parent `PRJ-2`) with `byKey = { 'PRJ-2': {key:'PRJ-2', fields:{parent:{key:'PRJ-1'}}}, 'PRJ-1': {key:'PRJ-1', fields:{}} }` → returns 3 issues; `calls` length 2; each URL starts with `https://x.test/rest/api/3/issue/` and contains `?fields=summary,parent` (pass `'summary,parent'` as `fieldsString`).
2. Two leaves sharing a parent → parent fetched exactly once.
3. Parent returns 404 → function resolves (does not throw), returns only the leaf; the failure is logged with `[-]` (you may leave console output unasserted).

**Verify**: `node --test test/fetch.test.js` → `# fail 0`.

### Step 6: Full run and commit

**Verify**: `npm test` → `# fail 0`, `# pass` ≥ 25.
**Verify**: `git status --porcelain` lists only `export-issues.js`, `package.json`, `test/`, `plans/README.md`.

## Test plan

Covered by steps 3–5. There is no existing test to model after; the structure
above (`node:test`, `node:assert/strict`, tiny fixture builders) is the pattern
later plans should copy. Characterization tests are tagged with a
`// characterization: fixed in plan NNN` comment so the plan that fixes the bug
knows exactly which assertion to flip.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `node -e "require('./export-issues.js')"` exits 0 promptly and opens no browser
- [ ] `npm test` exits 0; `test/adf.test.js`, `test/layout.test.js`, `test/fetch.test.js` exist, ≥ 25 tests pass, 0 fail
- [ ] `grep -n "characterization: fixed in plan" test/*.test.js` shows at least plans 003, 004, 005, 006 referenced
- [ ] `git diff dff4ba2 -- export-issues.js` touches only the trailing lines (exports + `require.main` guard); no function bodies changed
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `node --version` is below v18 — `node:test` is unavailable; report and let the operator choose a runner.
- The trailing lines of `export-issues.js` are not `// Run the export` / `exportJiraIssues();` (drift).
- `require('./export-issues.js')` opens a browser or hangs after Step 1 (the guard is wrong or there is a second call site).
- Any test you are about to write would need a live Jira instance, network access, or a browser — such a test is out of scope; leave it out and note it.
- A characterization test's runtime output differs from the value this plan predicts AND the difference implies a behaviour this plan didn't anticipate (not just a regex detail) — report the actual output.

## Maintenance notes

- Plans 002–006 each flip specific characterization tests; when they land, the
  `// characterization` comment must be removed and the assertion updated to
  the fixed behaviour — reviewers should reject a fix PR that leaves a
  characterization test asserting the bug.
- If `export-issues.js` is ever split into modules, keep `module.exports`
  stable or update the three test files' imports in the same commit.
- Deferred: coverage for `exportJiraIssues` and `waitForUserInput` (need a
  browser and stdin respectively); `generateMarkdown` (needs `OUTPUT_DIR`
  injection — a future refactor could accept the dir as a parameter, making it
  testable; plan 008 (exit code / clean output dir) is the natural place).

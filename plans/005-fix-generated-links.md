# Plan 005: Make every generated index and parent link resolve to a real file

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/`
> Plans 001 and 004 are expected to have changed these files. Compare the
> "Current state" excerpts against the live code before proceeding; if the
> *logic* shown differs (not just line numbers or additions from 001/004),
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md, plans/004-detect-subtasks-by-flag.md
- **Category**: bug
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

The export produces an `index.md` and per-issue Markdown files containing
relative links, and **every one of those links is currently dead**. The
index links omit the `KEY-` prefix that the real folder names carry, and the
`**Parent:**` link points at `../KEY`, a path that never exists (folders are
`KEY-summary/` and the parent's content lives in `_<type>.md` inside them).
Users opening the export in any Markdown viewer (VS Code, Obsidian, GitHub)
get "file not found" on every click. `CLAUDE.md` already documents bug (a)
as a known issue with the intended fix; this plan applies it and fixes the
parent link with it, then locks both in with a test that resolves every link
against the real filesystem.

## Current state

Files:

- `export-issues.js` — the whole tool. Relevant functions: `generateMarkdown`
  (writes `index.md`), `generatePath`, `generateIssueFiles` (creates folders
  and files), `generateIssueMd` (renders one issue's Markdown), `sanitizeDir`,
  `sanitizeFilename`.
- `test/layout.test.js` — created by plan 001; contains layout tests using
  `fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'))` as `baseDir`.
- `CLAUDE.md` — documents the index-link bug (read-only for this plan).

### How the output tree is laid out (facts you must rely on)

`generateIssueFiles` at `export-issues.js:141-185` (line numbers as of
`dff4ba2`; 001/004 may shift them slightly):

```js
function generateIssueFiles(issue, pathInfo, baseDir, allIssuesMap) {
  const { path: pathChain, isFile } = pathInfo;
  let currentDir = baseDir;
  const folderCount = isFile ? pathChain.length - 1 : pathChain.length;

  for (let i = 0; i < folderCount; i++) {
    const pathItem = pathChain[i];
    const folderName = `${pathItem.key}-${sanitizeDir(pathItem.summary)}`;   // :152
    currentDir = path.join(currentDir, folderName);
    if (!fs.existsSync(currentDir)) {
      fs.mkdirSync(currentDir, { recursive: true });
    }
    if (i === folderCount - 1 || (isFile && i === pathChain.length - 2)) {
      const issueData = allIssuesMap[pathItem.key];
      if (issueData) {
        const typePrefix = pathItem.type.toLowerCase().replace('-', '');
        const infoFilename = `_${typePrefix}.md`;                              // :164
        fs.writeFileSync(path.join(currentDir, infoFilename), generateIssueMd(issueData)); // :165
      }
    }
  }

  if (isFile) {
    const filename = sanitizeFilename(issue.key, issue.fields.summary) + '.md';
    fs.writeFileSync(path.join(currentDir, filename), generateIssueMd(issue)); // :173
  }
  ...
}
```

So for an Epic `EP-1 "Big epic"` → Story `ST-2 "A story"` → Sub-task
`SUB-3 "Do thing"`, the tree is:

```
<OUTPUT_DIR>/
  index.md
  EP-1-big-epic/
    _epic.md                 ← EP-1's content (a folder issue)
    ST-2-a-story/
      _story.md              ← ST-2's content (a folder issue)
      SUB-3-do-thing.md      ← SUB-3's content (a leaf file, INSIDE its parent's folder)
```

Consequences for relative links:

- A **leaf file** (`SUB-3-do-thing.md`) sits in the same directory as its
  parent's info file. Correct parent link: `./_story.md` (write it as
  `_story.md`).
- A **folder issue's** info file (`ST-2-a-story/_story.md`) sits one level
  below its parent's info file. Correct parent link: `../_epic.md`.
- From `index.md` (at `OUTPUT_DIR` root), a root folder issue's info file is
  `EP-1-big-epic/_epic.md`; a root leaf file (a sub-task with no parent in the
  map) is `SUB-9-summary.md`.

### Bug (a): index links — `export-issues.js:109-115`

```js
${rootIssues.map(issue => {
  const type = issue.fields.issuetype?.name || 'Unknown';
  const pathInfo = generatePath(issue, allIssuesMap);
  const isFile = pathInfo.isFile;
  const filename = isFile ? `${sanitizeFilename(issue.key, issue.fields.summary)}.md` : `${sanitizeDir(issue.fields.summary)}/_${type.toLowerCase().replace('-', '')}.md`;  // :113
  return `- [${type}: ${issue.key} - ${issue.fields.summary}](${filename})`;
}).join('\n')}
```

The folder branch uses `sanitizeDir(summary)` alone; the real folder is
`${key}-${sanitizeDir(summary)}` (compare `:152`).

### Bug (b): parent link — `export-issues.js:202-223`

```js
function generateIssueMd(issue) {
  const { key, fields } = issue;
  const { summary, description, status, priority, assignee, created, updated,
    issuelinks = [], comment = {}, parent } = fields;

  const issueType = fields.issuetype?.name || 'N/A';
  const parentInfo = parent ? `\n**Parent:** [${parent.key}](../${parent.key})` : '';   // :218
```

`../${parent.key}` is never a real path. `generateIssueMd` receives only the
issue, so it cannot know the parent's type (needed for `_<type>.md`) or
whether the current issue is a leaf.

### Conventions

- CommonJS, 2-space indent, single quotes, template literals for Markdown.
- Console prefixes: `[*]` progress, `[+]` success, `[-]` failure.
- Tests: `node:test` + `node:assert/strict`, in `test/*.test.js`; model new
  tests on the existing ones in `test/layout.test.js` from plan 001.
- Plan 004 changed the leaf decision to `issuetype.subtask === true`; fixtures
  must set `subtask: true` on sub-task issues and `subtask: false` on others.
- Plan 001 exports the functions via `module.exports`; tests `require('../export-issues.js')`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `npm install`                    | exit 0              |
| Syntax    | `node --check export-issues.js`  | exit 0, no output   |
| Tests     | `npm test`                       | exit 0, all pass    |

Do NOT run `npm run export` — it opens a browser and needs a live Jira login.

## Scope

**In scope** (the only files you should modify):
- `export-issues.js`
- `test/layout.test.js`
- `CLAUDE.md` — only to delete the bullet describing the broken index links
  (the "Conventions and gotchas" section); it becomes false once this lands.
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `descriptionToMd` / `processNode` and any ADF rendering — plan 006.
- Folder/file naming scheme (`sanitizeDir`, `sanitizeFilename`, `:152`,
  `:164`) — links must adapt to the existing names, not the other way round.
- `README.md` output-structure diagram (it already shows the correct tree).

## Git workflow

- Branch: `advisor/005-fix-generated-links`
- One commit per step; message style: short imperative, e.g.
  `Fix index and parent links in generated Markdown`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the index links

In `generateMarkdown`, replace the folder branch at `:113` so both branches
use the key-prefixed name:

```js
const filename = isFile
  ? `${sanitizeFilename(issue.key, issue.fields.summary)}.md`
  : `${issue.key}-${sanitizeDir(issue.fields.summary)}/_${type.toLowerCase().replace('-', '')}.md`;
```

**Verify**: `node --check export-issues.js` → exit 0.

### Step 2: Give `generateIssueMd` enough context to build the parent link

Change the signature to `generateIssueMd(issue, parentIssue, isFile)`:

- `parentIssue` — the parent's full issue object from `allIssuesMap`, or
  `undefined` if the parent is not in the map.
- `isFile` — boolean, `true` when `issue` is rendered as a leaf `.md` file.

Replace `:218` with:

```js
let parentInfo = '';
if (parent) {
  if (parentIssue) {
    const parentType = (parentIssue.fields.issuetype?.name || 'unknown').toLowerCase().replace('-', '');
    const parentFile = `_${parentType}.md`;
    const parentHref = isFile ? parentFile : `../${parentFile}`;
    parentInfo = `\n**Parent:** [${parent.key} - ${parentIssue.fields.summary}](${parentHref})`;
  } else {
    parentInfo = `\n**Parent:** ${parent.key}`;   // parent not exported; no link
  }
}
```

The `typeName.toLowerCase().replace('-', '')` expression must be *identical*
to the one at `:163` so the href matches the file actually written.

Update the two call sites in `generateIssueFiles`:

- `:165` (folder info file): `generateIssueMd(issueData, allIssuesMap[issueData.fields.parent?.key], false)`
- `:173` (leaf file): `generateIssueMd(issue, allIssuesMap[issue.fields.parent?.key], true)`

Any other caller of `generateIssueMd` (grep for it) must still work with the
extra args omitted — the `parent not exported` branch handles `undefined`.

**Verify**: `node --check export-issues.js` → exit 0.
`grep -n "generateIssueMd(" export-issues.js` → exactly the definition plus
the two updated call sites (plus any test usages).

### Step 3: Update existing tests, add exact-string assertions

In `test/layout.test.js`:

- Any characterization test from plan 001 marked `// characterization: fixed
  in plan 005` must now assert the corrected strings. Remove the comment.
- Add a test `generateIssueMd renders parent link for a leaf file` using an
  Epic→Story→Sub-task fixture: assert the sub-task's output contains
  `**Parent:** [ST-2 - A story](_story.md)`.
- Add `generateIssueMd renders parent link for a folder issue`: story output
  contains `**Parent:** [EP-1 - Big epic](../_epic.md)`.
- Add `generateIssueMd omits link when parent is not exported`: call with
  `parentIssue` undefined, assert output contains `**Parent:** EP-1` and does
  NOT contain `](`.

**Verify**: `npm test` → exit 0, all pass.

### Step 4: Add the end-to-end link-resolution test

Add a test `all generated relative links resolve to existing files`:

1. Build fixtures: `EP-1` (Epic, `subtask: false`, no parent), `ST-2` (Story,
   parent `EP-1`), `SUB-3` (Sub-task, `subtask: true`, parent `ST-2`), and a
   parentless root sub-task `SUB-9` (`subtask: true`). Use `allIssuesMap` as a
   plain object keyed by issue key.
2. `baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'))`.
3. For each root (`EP-1`, `SUB-9`): `generateIssueFiles(root, generatePath(root, map), baseDir, map)`.
4. Write `index.md` into `baseDir` by reproducing the `rootIssues.map(...)`
   block from `generateMarkdown` — OR, if plan 001 refactored index rendering
   into an exported helper, call that. Do not call `generateMarkdown` itself
   (it writes to `OUTPUT_DIR` from the environment).
5. Walk `baseDir` recursively (`fs.readdirSync(dir, { withFileTypes: true })`).
   For every `.md` file, extract links with `/\]\(([^)]+)\)/g`, skip any
   matching `/^[a-z]+:/` (absolute URLs), resolve each against the file's
   directory, and `assert.ok(fs.existsSync(resolved), \`${file} -> ${href}\`)`.
6. Also assert at least 3 links were checked (guards against a regex that
   matches nothing).

**Verify**: `npm test` → exit 0; the new test reports the link count > 0.

### Step 5: Remove the stale gotcha from CLAUDE.md

Delete the bullet in `CLAUDE.md` that begins "`index.md` links to root folders
as `sanitized-summary/...`". Leave everything else.

**Verify**: `grep -n "sanitized-summary" CLAUDE.md` → no output.

## Test plan

- `test/layout.test.js`:
  - index link for a root folder issue is `EP-1-big-epic/_epic.md`
  - index link for a root leaf issue is `SUB-9-<sanitized>.md`
  - parent link from leaf → `_story.md`; from folder → `../_epic.md`
  - parent missing from map → plain key, no link
  - end-to-end: every relative link in the generated tree resolves
- Pattern: the existing `generateIssueFiles` temp-dir test in
  `test/layout.test.js` from plan 001.
- Verification: `npm test` → all pass, including the ≥5 new/updated tests.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0; end-to-end link test exists and passes
- [ ] `grep -n '\.\./\${parent.key}' export-issues.js` returns no matches
- [ ] `grep -n "sanitizeDir(issue.fields.summary)}/_" export-issues.js` returns no matches
- [ ] `grep -n "sanitized-summary" CLAUDE.md` returns no matches
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 001 or 004 has not landed (`npm test` is still the `exit 1` stub, or
  `generatePath` still compares `issuetype.name` to `'sub-task'`).
- The folder-naming expression at `:152` or the info-file expression at
  `:163-164` differs from the excerpts — the link scheme in Step 2 is derived
  from them.
- The end-to-end test finds a dead link that is not one of the two bugs
  described here (report the href; it may be a naming collision worth its own
  plan).
- Fixing the parent link appears to require changing folder or file names.

## Maintenance notes

- The href expressions in Step 2 duplicate the naming at `:152`/`:164`. A
  reviewer should check they are literally identical; the end-to-end test in
  Step 4 is what catches drift if someone later renames files.
- Plan 006 (ADF coverage) is unaffected. Plan 012 (attachments) will add
  image links; extend the Step 4 walker to check those too when it lands.
- Deferred: a "Children" section listing child links from a folder's info
  file — easy once `generateIssueMd` has map access, but not requested.
- If output is ever switched to Obsidian wikilinks (`[[KEY]]`), delete the
  relative-path logic here rather than layering on it.

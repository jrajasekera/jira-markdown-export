# Plan 004: Detect sub-tasks by the `issuetype.subtask` flag instead of the type name

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/layout.test.js`
> Plan 001 is expected to have changed these files. Beyond that, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md
- **Category**: bug
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

The export layout puts every non-leaf issue in a folder with an
`_<type>.md` info file, and writes only sub-tasks as plain `.md` leaf files.
Whether an issue is a sub-task is decided by comparing the issue type's
display name to the string `sub-task`. Jira Cloud sites created in recent
years name the built-in type `Subtask` (no hyphen), and admins can create
custom sub-task types with any name. On those sites nothing matches, so every
issue becomes a folder containing `_subtask.md` and the export has zero leaf
files. Jira sends a boolean `fields.issuetype.subtask` on every issue payload;
using it makes the layout correct regardless of naming.

## Current state

- `export-issues.js:121-139` — `generatePath`; line 136 is the bug:

```js
  // Check if the last item (current issue) is a subtask
  const isFile = issue.fields.issuetype?.name?.toLowerCase() === 'sub-task';

  return { path, isFile };
```

- `export-issues.js:159-167` — `generateIssueFiles` derives the info
  filename from the type name. This is fine and stays as is:

```js
    // Write info file (_epic.md, _story.md, _task.md)
    if (i === folderCount - 1 || (isFile && i === pathChain.length - 2)) {
      const issueData = allIssuesMap[pathItem.key];
      if (issueData) {
        const typePrefix = pathItem.type.toLowerCase().replace('-', '');
        const infoFilename = `_${typePrefix}.md`;
        fs.writeFileSync(path.join(currentDir, infoFilename), generateIssueMd(issueData));
      }
    }
```

- `export-issues.js:28-43` — the `fields` list requested from Jira includes
  `issuetype`; the returned object looks like
  `{ "id": "10003", "name": "Subtask", "subtask": true, ... }`. The
  `subtask` boolean is part of the standard issue-type shape for both search
  and single-issue responses.

Conventions: CommonJS, 2-space indent, single quotes. No linter.

After plan 001, `generatePath` and `generateIssueFiles` are exported via
`module.exports`, and `test/layout.test.js` contains characterization tests
(`node:test` + `node:assert/strict`) including one marked
`// characterization: fixed in plan 004` that asserts the name-based
behaviour.

## Commands you will need

| Purpose      | Command                          | Expected on success |
|--------------|----------------------------------|---------------------|
| Syntax check | `node --check export-issues.js`  | exit 0, no output   |
| Tests        | `npm test`                       | all tests pass, exit 0 |

Do NOT run `npm run export` — it is interactive and needs a live Jira login.

## Scope

**In scope** (the only files you should modify):
- `export-issues.js` — only `generatePath`
- `test/layout.test.js`

**Out of scope** (do NOT touch, even though they look related):
- The info-filename derivation in `generateIssueFiles` (`_${typePrefix}.md`)
  — it is name-based on purpose so folders read as `_epic.md`, `_story.md`.
- `index.md` generation in `generateMarkdown` — plan 005 fixes its links.
- `README.md` output-structure diagram.

## Git workflow

- Branch: `advisor/004-detect-subtasks-by-flag`
- Commit per step; message style is short imperative, e.g.
  `Add CLAUDE.md with project commands and architecture notes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an `isSubtask` helper and use it in `generatePath`

Directly above `function generatePath(` in `export-issues.js`, add:

```js
function isSubtask(issue) {
  const issuetype = issue.fields.issuetype;
  if (typeof issuetype?.subtask === 'boolean') {
    return issuetype.subtask;
  }
  // Fallback for payloads that omit the flag
  return issuetype?.name?.toLowerCase() === 'sub-task';
}
```

Replace line 136 with:

```js
  const isFile = isSubtask(issue);
```

Add `isSubtask` to the `module.exports` object at the bottom of the file.

**Verify**: `node --check export-issues.js` → exit 0. `grep -n "=== 'sub-task'" export-issues.js` → exactly one match, inside `isSubtask`.

### Step 2: Update tests

In `test/layout.test.js`:

1. Every issue fixture used with `generatePath` / `generateIssueFiles` must
   carry `issuetype: { name: ..., subtask: true|false }`. If plan 001's
   fixtures lack the `subtask` key, add it (`false` for Epic/Story/Task,
   `true` for Sub-task).
2. Find the characterization test marked `fixed in plan 004`, flip its
   assertion, remove the comment.
3. Add `isSubtask` cases:
   - `{ name: 'Sub-task', subtask: true }` → `true`
   - `{ name: 'Subtask', subtask: true }` → `true`
   - `{ name: 'Bug fix subtask', subtask: true }` → `true`
   - `{ name: 'Task', subtask: false }` → `false`
   - `{ name: 'Sub-task' }` (no flag) → `true` (fallback)
   - `{ name: 'Subtask' }` (no flag) → `false` (fallback cannot know)
   - `issue.fields.issuetype` undefined → `false`
4. Add one `generateIssueFiles` case in a `fs.mkdtempSync` temp dir with a
   parent Task (`subtask: false`) and a child whose type is
   `{ name: 'Subtask', subtask: true }`; assert the child is written as
   `<TASK-folder>/<CHILD-KEY>-<slug>.md` and that no folder named
   `<CHILD-KEY>-*` exists.

**Verify**: `npm test` → all pass, including the new cases; `grep -rn "fixed in plan 004" test/` → nothing.

## Test plan

- `test/layout.test.js`: 7 `isSubtask` unit cases plus 1 layout case, modelled
  on the existing `generatePath` and temp-dir `generateIssueFiles` tests from
  plan 001.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0; `isSubtask` tests exist and pass
- [ ] `grep -n "isSubtask" export-issues.js` shows the definition, the use in `generatePath`, and the `module.exports` entry
- [ ] `grep -c "=== 'sub-task'" export-issues.js` prints `1`
- [ ] `grep -rn "fixed in plan 004" test/` returns nothing
- [ ] `git status` shows only `export-issues.js`, `test/layout.test.js`, and `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `module.exports` or `test/layout.test.js` does not exist — plan 001 has not landed.
- Line 136 (or its shifted equivalent) no longer reads
  `issue.fields.issuetype?.name?.toLowerCase() === 'sub-task'`.
- Plan 001's fixtures are shaped so differently that adding `issuetype.subtask`
  requires restructuring the test file — add the key only; if that is not
  enough, stop.
- `npm test` fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 005 (index/parent links) and plan 012 (attachments) also touch layout
  code; they should call `isSubtask` rather than re-deriving leaf-ness.
- Reviewer should confirm the fallback branch is only reached when
  `subtask` is not a boolean, so real payloads never hit the name check.
- Deferred: the `_${typePrefix}.md` naming still strips only the first
  hyphen from the type name (`'-'` not `/-/g`); harmless for built-in types.

# Plan 007: Exit non-zero on failure and start each export from an empty output tree

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/`
> Other plans may have touched `export-issues.js`. Compare the "Current
> state" excerpts against the live code before proceeding; if the two code
> regions below differ in logic, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (Step 2 deletes a directory; the guard is what keeps it LOW)
- **Depends on**: none (plan 001 is optional — see "Verification honesty")
- **Category**: bug / dx
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

Two silent-failure behaviours:

1. `exportJiraIssues` wraps everything in `try/catch`, logs the error, and
   lets the process exit 0. A wrapper script or CI job cannot tell a failed
   export from a successful one. A malformed search response
   (`searchData.issues` undefined) throws a `TypeError` that is likewise
   swallowed.
2. `generateMarkdown` only creates `OUTPUT_DIR`; it never clears it. Files
   from earlier runs stay. When an issue is renamed, moved to a different
   parent, or unassigned, its old folder remains next to the new one, and the
   user sees two copies with no way to tell which is current.

After this plan: any error sets exit code 1, and the output directory is
recreated from scratch on every run — with a guard that refuses to delete
anything that isn't clearly an export directory.

## Current state

File: `export-issues.js` — the whole tool. `OUTPUT_DIR` comes from `.env`
(`OUTPUT_DIR=./exported-issues` in `.env.example`) with the same default at
`:8`.

### Error handling — `export-issues.js:7-8` and `:54-74`

```js
const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
...
    if (!searchResponse.ok()) {
      throw new Error(`API error: ${searchResponse.status()}`);
    }

    const searchData = await searchResponse.json();
    console.log(`[+] Found ${searchData.issues.length} assigned issues`);   // :59 — TypeError if issues missing
    ...
  } catch (error) {
    console.error('[-] Error:', error);                                    // :71 — exit code stays 0
  } finally {
    await browser.close();
  }
}
```

### Output directory — `export-issues.js:77-81`

```js
async function generateMarkdown(issues) {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
```

### Conventions

- CommonJS, 2-space, single quotes. Console prefixes `[*]` progress, `[+]`
  success, `[-]` failure.
- If plan 001 has landed: `module.exports = { ... }` exists at the bottom of
  `export-issues.js`, `npm test` runs `node --test`, tests live in
  `test/*.test.js` using `node:test` + `node:assert/strict`.
- `AGENTS.md` and `CLAUDE.md` both say: never run `npm run export` as an
  unattended check.

### Verification honesty

Without plan 001 the only static check is `node --check`, and the guard in
Step 2 cannot be exercised without launching the browser. Therefore:

- If plan 001 **has** landed: Steps 3 and 4 add real tests. Required.
- If plan 001 **has not** landed: do Steps 1–2, verify with `node --check`
  only, and write `DONE (guard untested — plan 001 pending)` in the status
  row. Do not claim the guard is tested.

Check which applies: `grep -n "module.exports" export-issues.js` → a match
means 001 has landed.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `npm install`                    | exit 0              |
| Syntax    | `node --check export-issues.js`  | exit 0              |
| Tests     | `npm test` (only after plan 001) | exit 0, all pass    |

Do NOT run `npm run export`.

## Scope

**In scope**:
- `export-issues.js` — only `exportJiraIssues`'s catch block, the
  `searchData.issues` check, `generateMarkdown`'s directory setup, and one
  new helper `prepareOutputDir`.
- `test/output-dir.test.js` (create, only if plan 001 has landed)
- `CLAUDE.md` — update the one sentence saying errors are swallowed and the
  process exits 0.
- `plans/README.md` (status row)

**Out of scope**:
- The per-parent fetch failures at `:396-407` — those are intentionally
  logged-and-skipped; plan 002 handles the resulting orphans.
- Search pagination (plan 002), even though it touches `:45-59`.
- Any change to what files are written or how they are named.

## Git workflow

- Branch: `advisor/007-exit-code-and-clean-output`
- Two commits: `Exit non-zero when the export fails` and
  `Clear the output directory before each export`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Non-zero exit on failure

1. Replace the catch block at `:70-71` with:

   ```js
   } catch (error) {
     console.error('[-] Error:', error);
     process.exitCode = 1;
   }
   ```

   Use `process.exitCode`, not `process.exit(1)`, so the `finally` still
   closes the browser.

2. After `const searchData = await searchResponse.json();` (`:58`) add:

   ```js
   if (!Array.isArray(searchData.issues)) {
     throw new Error(`Unexpected search response: ${JSON.stringify(searchData).slice(0, 200)}`);
   }
   ```

   (If plan 002 has already extracted a `searchIssues` function, put the
   check inside it, once per page.)

**Verify**: `node --check export-issues.js` → exit 0.
`grep -n "process.exitCode = 1" export-issues.js` → one match.

### Step 2: Guarded clear of the output directory

Add a helper above `generateMarkdown`:

```js
function prepareOutputDir(dir) {
  const resolved = path.resolve(dir);
  const forbidden = [
    path.parse(resolved).root,          // filesystem root
    require('os').homedir(),
    process.cwd(),
    __dirname,                          // the repo checkout
  ].map(p => path.resolve(p));

  if (forbidden.includes(resolved)) {
    throw new Error(`Refusing to clear ${resolved}: it is not a dedicated export directory`);
  }
  if (!path.basename(resolved)) {
    throw new Error(`Refusing to clear ${resolved}`);
  }

  console.log(`[*] Clearing ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
```

Replace `:79-81` in `generateMarkdown` with `prepareOutputDir(OUTPUT_DIR);`.

Move `require('os')` to the top with the other requires if you prefer
(`const os = require('os');`) — either is acceptable, be consistent.

If plan 001 has landed, add `prepareOutputDir` to `module.exports`.

**Verify**: `node --check export-issues.js` → exit 0.
`grep -n "existsSync(OUTPUT_DIR)" export-issues.js` → no matches.

### Step 3 (only if plan 001 landed): Guard tests

Create `test/output-dir.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOutputDir } = require('../export-issues.js');

test('prepareOutputDir refuses dangerous targets', () => {
  for (const dir of [os.homedir(), process.cwd(), path.parse(process.cwd()).root]) {
    assert.throws(() => prepareOutputDir(dir), /Refusing to clear/);
  }
});

test('prepareOutputDir removes stale files and recreates the dir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  const target = path.join(base, 'out');
  fs.mkdirSync(path.join(target, 'OLD-1-stale'), { recursive: true });
  fs.writeFileSync(path.join(target, 'OLD-1-stale', '_task.md'), 'x');

  prepareOutputDir(target);

  assert.ok(fs.existsSync(target));
  assert.deepEqual(fs.readdirSync(target), []);
});

test('prepareOutputDir creates a missing dir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  const target = path.join(base, 'fresh');
  prepareOutputDir(target);
  assert.ok(fs.statSync(target).isDirectory());
});
```

Note the dangerous-target test must run the check **before** any deletion —
which the helper's ordering guarantees; if you reorder the helper, this test
is what would catch it. Never point this test at a real directory containing
data.

**Verify**: `npm test` → exit 0, 3 new tests pass.

### Step 4: Document the behaviour

In `CLAUDE.md`, replace the sentence "Errors in `exportJiraIssues` are
caught, logged, and swallowed — the process still exits 0." with "Errors in
`exportJiraIssues` are caught and logged and the process exits 1. The output
directory is cleared and recreated on every run (`prepareOutputDir`, which
refuses `/`, `$HOME`, cwd, and the repo root)." Keep the following sentence
about per-parent fetch failures.

**Verify**: `grep -n "exits 0" CLAUDE.md` → no output.

## Test plan

- `test/output-dir.test.js` (if 001 landed): refuses home/cwd/root; clears
  stale content; creates a missing dir.
- Exit code: not unit-testable without a browser; reviewer verifies by
  reading the catch block. Deferred to a live run by the operator.
- Verification: `npm test` → all pass.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `grep -n "process.exitCode = 1" export-issues.js` → one match
- [ ] `grep -n "existsSync(OUTPUT_DIR)" export-issues.js` → no match
- [ ] `grep -n "Refusing to clear" export-issues.js` → ≥1 match
- [ ] If plan 001 landed: `npm test` exits 0 and `test/output-dir.test.js` exists
- [ ] `grep -n "exits 0" CLAUDE.md` → no match
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated (with the "guard untested" note if 001 is pending)

## STOP conditions

- The catch block or directory setup does not match the excerpts above.
- `OUTPUT_DIR` is used anywhere other than `:8`, `:68`, `:79-81`, `:97`,
  `:118` (`grep -n OUTPUT_DIR export-issues.js`) — another plan may have
  changed how the output path is chosen (plan 011 adds config flags).
- You are tempted to skip the forbidden-path guard "because the default is
  `./exported-issues`". Do not: `.env` is user-controlled and `OUTPUT_DIR=.`
  would delete the checkout.
- Tests in Step 3 fail twice after a fix attempt.

## Maintenance notes

- Plan 011 (configurable JQL/output via flags) must route its output path
  through `prepareOutputDir`; reviewers of 011 should check that.
- If per-query output subfolders are added later (one dir per JQL), the
  forbidden-list check still applies to the *leaf* directory being cleared —
  keep clearing only the leaf.
- Consider a `--keep` / `--no-clean` flag if users start diffing exports
  across runs; deliberately not added here.
- Reviewer focus: guard ordering (check before `rmSync`) and that
  `process.exitCode` — not `process.exit()` — is used.

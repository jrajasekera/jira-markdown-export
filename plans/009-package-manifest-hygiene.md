# Plan 009: Correct package.json metadata and commit the lockfile

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- package.json .gitignore`
> If plan 001 has landed, `package.json`'s `test` script will differ from the
> excerpt below — that is expected; leave the `test` script as you find it.
> Any other difference: compare against "Current state" and STOP on mismatch.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

`package.json` still carries `npm init` defaults: `main` points at a file that
does not exist, the license field contradicts the `LICENSE` file, and there is
no `private` flag or `engines` range. Separately, `.gitignore` excludes
`package-lock.json`, so every clone resolves `playwright`/`dotenv` afresh and
two people can run different versions of Playwright with no record of which
one worked. Fixing these is a few lines and removes onboarding confusion and
an irreproducibility hazard.

## Current state

`package.json` at commit dff4ba2 (full file):

```json
{
  "name": "jira-markdown-export",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "export": "node export-issues.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "dotenv": "^17.2.3",
    "playwright": "^1.56.1"
  }
}
```

Problems:
- `main: "index.js"` — no such file; the entry point is `export-issues.js`.
- `license: "ISC"` — `LICENSE` in the repo root is the MIT License
  (`Copyright (c) 2025 Zoltan Toma`).
- No `"private": true` — nothing prevents an accidental `npm publish`.
- No `engines` — the tests (plan 001) use `node:test`, stable from Node 20.
- Empty `description`; empty `author` (leave `author` empty — the operator
  decides attribution; do not invent one).

`.gitignore:1-6` at dff4ba2:

```
# Dependencies
node_modules/
npm-debug.log
package-lock.json
yarn.lock
```

Lines 5–6 ignore the lockfiles. `node_modules/` must stay ignored.

There is no committed `package-lock.json` and (at recon time) no
`node_modules/` in the working tree.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Validate manifest | `node -e "const p=require('./package.json'); if(p.main!=='export-issues.js'\|\|p.private!==true\|\|p.license!=='MIT') process.exit(1)"` | exit 0 |
| Lockfile not ignored | `git check-ignore package-lock.json` | exit 1 (prints nothing) |
| Install | `npm install` | exit 0, creates `package-lock.json` |
| Playwright present | `npx playwright --version` | prints `Version 1.x.y` |
| Syntax check | `node --check export-issues.js` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `.gitignore`
- `package-lock.json` (created by `npm install`; commit it)

**Out of scope** (do NOT touch):
- The `scripts.test` value — plan 001 owns it. If it still reads
  `echo "Error: no test specified" && exit 1`, leave it.
- `export-issues.js`, any docs, `.env.example`.
- Do NOT run `npx playwright install` — downloading browsers is not needed to
  verify this plan and writes outside the repo.

## Git workflow

- Branch: `advisor/009-package-manifest-hygiene`
- Two commits: one for the manifest edits, one adding the lockfile. Message
  style: short imperative, e.g. `Fix package.json metadata and license field`,
  `Commit package-lock.json for reproducible installs`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix `package.json` fields

Edit `package.json` so that, keeping key order sensible, it contains:

```json
{
  "name": "jira-markdown-export",
  "version": "1.0.0",
  "private": true,
  "description": "Export Jira Cloud issues to a hierarchical Markdown tree via an authenticated Playwright session",
  "main": "export-issues.js",
  "scripts": {
    "export": "node export-issues.js",
    "test": "<leave exactly as found>"
  },
  "keywords": ["jira", "markdown", "export", "playwright"],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "dotenv": "^17.2.3",
    "playwright": "^1.56.1"
  }
}
```

Do not change the dependency ranges.

**Verify**: the "Validate manifest" command above → exit 0.
`node -e "require('./package.json')"` → exit 0 (valid JSON).

### Step 2: Stop ignoring lockfiles

Delete the two lines `package-lock.json` and `yarn.lock` from `.gitignore`.
Leave `node_modules/` and `npm-debug.log` in place.

**Verify**: `git check-ignore package-lock.json` → exit 1;
`git check-ignore node_modules/x` → exit 0 (still ignored).

### Step 3: Generate and commit the lockfile

Run `npm install`. This creates `node_modules/` (ignored) and
`package-lock.json` (now tracked). Commit `package-lock.json`.

**Verify**: `test -f package-lock.json && echo ok` → `ok`;
`npx playwright --version` → prints a version;
`node --check export-issues.js` → exit 0;
`git status --porcelain` → shows nothing untracked except changes you intend to commit.

## Test plan

No code behaviour changes; verification is the command table above. If plan
001 has landed, also run `npm test` → pass (confirms the `test` script was not
disturbed).

## Done criteria

- [ ] Validate-manifest command exits 0
- [ ] `git check-ignore package-lock.json` exits 1
- [ ] `package-lock.json` is tracked: `git ls-files package-lock.json` prints the path
- [ ] `git ls-files node_modules | head -1` prints nothing (node_modules not committed)
- [ ] `node --check export-issues.js` exits 0
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `LICENSE` is not the MIT License text (re-check before changing the field).
- `npm install` fails or wants to change dependency versions in `package.json`.
- A `yarn.lock` or `pnpm-lock.yaml` already exists in the tree (someone chose
  a different package manager — don't add a competing lockfile).
- `git ls-files node_modules` prints anything (node_modules got staged).

## Maintenance notes

- With the lockfile committed, dependency bumps are now visible in review;
  `npm ci` becomes the reproducible install and is what any future CI should use.
- Reviewer: confirm the lockfile's `playwright` version matches the `^1.56.1`
  range and that `node_modules/` is absent from the diff.
- Deferred: `author` field left empty on purpose; `README.md` still says
  `npm install` (fine — `npm ci` mention is optional).

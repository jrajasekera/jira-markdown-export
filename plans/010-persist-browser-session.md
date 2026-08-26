# Plan 010: Reuse a saved browser session so repeat exports skip the login prompt

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js .gitignore .env.example README.md test/`
> Plans 001, 002, 007 and 008 are expected to have changed `export-issues.js`
> since `dff4ba2`. Compare the "Current state" excerpts against the live code;
> if the *shape* differs (function names gone, login flow restructured),
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M (coarse — this is a spike; the minimal version is ~40 lines, but live verification against a real SSO tenant is required)
- **Risk**: MED — writes a session credential to disk; a mistake in the fallback path could make the tool unusable when the saved session expires
- **Depends on**: plans/007-exit-code-and-clean-output.md (failure must set a non-zero exit code before we add a second code path that can fail)
- **Category**: direction
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

Every run of `npm run export` opens a headed Chromium, makes the user complete
Jira SSO, and blocks on ENTER in the terminal. For a tool whose natural use is
"re-export my issues every morning", that is the single biggest source of
friction and the reason it cannot be scripted. Playwright can serialise the
authenticated browser context (cookies + localStorage) to a JSON file and
rehydrate it on the next launch. With that, a second run can probe Jira, see
that the session is still valid, and go straight to fetching — headless, with
no prompt. Default behaviour (first run, or expired session) stays exactly as
today.

## Current state

- `export-issues.js` — the whole tool. Relevant parts:
  - `exportJiraIssues` (top of file) launches the browser and blocks on login.
  - `waitForUserInput` (near the bottom) is the ENTER prompt.
- `.gitignore` — ignores `.env`, `exported-issues/`, editor files. Does **not**
  yet ignore any session file.
- `.env.example` — two lines, `JIRA_URL` and `OUTPUT_DIR`.
- `README.md` — "Usage" section describes the login-then-ENTER flow.

Browser launch and login prompt as written at `dff4ba2` (`export-issues.js:10-23`):

```js
async function exportJiraIssues() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[*] Connecting to Jira...');

    // 1. Open Jira (uses existing SSO session)
    await page.goto(JIRA_URL);

    // Wait for login to complete - interactive mode
    console.log('[!] Browser window opened. Log in to Jira, then press ENTER here...');
    await waitForUserInput();
```

The prompt helper (`export-issues.js:414-426`):

```js
function waitForUserInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}
```

Config constants at the top (`export-issues.js:7-8`):

```js
const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
```

Conventions to match:
- CommonJS `require`, 2-space indent, single quotes.
- Log prefixes: `[*]` progress, `[+]` success, `[-]` failure, `[!]` needs user action.
- Configuration comes from env vars via `dotenv` (`require('dotenv').config()` on line 5). No CLI arg parsing. No new dependencies.
- After plan 001, all functions are exported at the bottom of the file via `module.exports = { ... }` and the entry call is guarded by `if (require.main === module)`. Tests live in `test/*.test.js` and use `node:test` + `node:assert/strict`. Fake Playwright pages in tests are plain objects: `{ request: { get: async (url) => ({ ok: () => true, status: () => 200, json: async () => ({...}) }) } }` — model your test after `test/layout.test.js`'s `fetchAllParentIssues` test.

Playwright API facts the executor needs (Playwright ≥1.56 is installed):
- `await context.storageState({ path })` writes cookies + localStorage to a JSON file.
- `browser.newContext({ storageState: path })` restores it. Throws if the file is malformed.
- `GET /rest/api/3/myself` returns `200` with `{ accountId, displayName, ... }` when the session is valid, `401`/`403` otherwise.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Syntax    | `node --check export-issues.js`  | exit 0, no output   |
| Tests     | `npm test`                       | all pass            |
| Live run  | `npm run export`                 | interactive — only run with the operator's approval, twice (see Step 6) |

## Scope

**In scope** (the only files you should modify):
- `export-issues.js`
- `test/session.test.js` (create)
- `.gitignore`
- `.env.example`
- `README.md` (Usage section only)

**Out of scope** (do NOT touch):
- `generateMarkdown`, `generateIssueFiles`, the ADF converter — unrelated.
- Any change to headed-mode behaviour on the *first* run. The interactive flow must remain byte-for-byte the user experience it is today when no state file exists.
- Encrypting the state file. Out of scope for the spike; record as an open question.

## Git workflow

- Branch: `advisor/010-persist-browser-session`
- Commit per step; short imperative messages, e.g. `Add hasValidSession probe`, `Reuse saved storage state on launch`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the config constant and gitignore entry

In `export-issues.js`, directly after the `OUTPUT_DIR` constant, add:

```js
// Path to Playwright storageState JSON. Set JIRA_STATE_FILE= (empty) to disable.
const STATE_FILE = process.env.JIRA_STATE_FILE === undefined
  ? '.jira-session.json'
  : process.env.JIRA_STATE_FILE;
```

(Empty string means "disabled"; `undefined` means "use the default".)

Append to `.gitignore` under the `# Environment variables` block:

```
# Saved browser session (credential — never commit)
.jira-session.json
```

Append to `.env.example`:

```
# Saved browser session file. Leave unset for the default (.jira-session.json);
# set to an empty value to always log in interactively.
# JIRA_STATE_FILE=.jira-session.json
```

**Verify**: `node --check export-issues.js` → exit 0; `git check-ignore .jira-session.json` → prints the path, exit 0.

### Step 2: Add `hasValidSession(page, jiraUrl)`

Add this function next to `fetchAllParentIssues` and add it to `module.exports`:

```js
async function hasValidSession(page, jiraUrl) {
  try {
    const res = await page.request.get(`${jiraUrl}/rest/api/3/myself`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok()) return null;
    const me = await res.json();
    return me && me.accountId ? me : null;
  } catch (error) {
    return null;
  }
}
```

Returns the `myself` payload when the session is valid, otherwise `null`.
It must never throw — an expired session is the normal fallback path, not an error.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 3: Write tests for the probe

Create `test/session.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasValidSession } = require('../export-issues.js');

function fakePage(status, body) {
  return {
    request: {
      get: async () => ({
        ok: () => status >= 200 && status < 300,
        status: () => status,
        json: async () => body,
      }),
    },
  };
}

test('hasValidSession returns the user on 200 with accountId', async () => {
  const me = await hasValidSession(fakePage(200, { accountId: 'abc', displayName: 'Ada' }), 'https://x.atlassian.net');
  assert.equal(me.displayName, 'Ada');
});

test('hasValidSession returns null on 401', async () => {
  assert.equal(await hasValidSession(fakePage(401, {}), 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null when the request throws', async () => {
  const page = { request: { get: async () => { throw new Error('net'); } } };
  assert.equal(await hasValidSession(page, 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null on 200 without accountId (login page as JSON-less HTML)', async () => {
  assert.equal(await hasValidSession(fakePage(200, {}), 'https://x.atlassian.net'), null);
});
```

**Verify**: `npm test` → all pass, including 4 tests in `test/session.test.js`.

### Step 4: Restructure the launch/login section

Replace the block shown in "Current state" (`chromium.launch` through `await waitForUserInput();`) with:

```js
  const canReuse = STATE_FILE && fs.existsSync(STATE_FILE);
  let browser = await chromium.launch({ headless: Boolean(canReuse) });
  let context = await browser.newContext(canReuse ? { storageState: STATE_FILE } : {});
  let page = await context.newPage();

  try {
    console.log('[*] Connecting to Jira...');

    let me = canReuse ? await hasValidSession(page, JIRA_URL) : null;
    if (me) {
      console.log(`[+] Reusing saved session for ${me.displayName}`);
    } else {
      if (canReuse) {
        console.log('[-] Saved session is no longer valid; logging in interactively');
        await browser.close();
        browser = await chromium.launch({ headless: false });
        context = await browser.newContext();
        page = await context.newPage();
      }

      // 1. Open Jira (uses existing SSO session)
      await page.goto(JIRA_URL);

      // Wait for login to complete - interactive mode
      console.log('[!] Browser window opened. Log in to Jira, then press ENTER here...');
      await waitForUserInput();

      if (STATE_FILE) {
        await context.storageState({ path: STATE_FILE });
        console.log(`[+] Saved session to ${STATE_FILE}`);
      }
    }
```

Notes:
- `browser`, `context`, `page` change from `const` to `let` because the fallback relaunches them. Make sure the `finally { await browser.close(); }` at the end of `exportJiraIssues` still refers to the live `browser` variable (it will, since it's the same binding).
- `fs` is already required at the top of the file.
- If `browser.newContext({ storageState })` throws because the file is corrupt, let it propagate — the `catch` in `exportJiraIssues` logs it and (after plan 007) sets a non-zero exit code. The README tells the user to delete the file.

**Verify**: `node --check export-issues.js` → exit 0; `npm test` → all pass (no existing test exercises this section).

### Step 5: Document it

In `README.md` "Usage", after the existing numbered steps, add:

```markdown
### Reusing your login

After a successful login the tool saves the browser session to
`.jira-session.json` (gitignored). On later runs it checks that session first;
if it is still valid the export runs headless with no prompt. If it has
expired you are asked to log in again and the file is refreshed.

- This file is a credential — treat it like a password and never commit it.
- To always log in interactively, set `JIRA_STATE_FILE=` (empty) in `.env`.
- If the tool errors while loading the file, delete it and rerun.
```

**Verify**: `grep -n "jira-session" README.md .gitignore .env.example export-issues.js` → one or more hits in each file.

### Step 6: Live verification (needs the operator)

Only with the operator's approval, against their own Jira:

1. Delete `.jira-session.json` if present. `npm run export` → the headed browser opens, you log in, press ENTER, the log shows `[+] Saved session to .jira-session.json`, export completes.
2. `npm run export` again → no browser window, log shows `[+] Reusing saved session for <name>`, export completes with the same issue count.
3. Corrupt the file's cookies (edit `expires` values to `1`) and rerun → log shows `[-] Saved session is no longer valid; logging in interactively` and the headed flow appears.

If the operator is not available, mark this step "not run" in the status row; do not claim the plan is done.

## Test plan

- `test/session.test.js` (Step 3): valid session, 401, thrown request, 200 without `accountId`.
- Existing tests remain green; no test should launch a real browser.
- Live checks in Step 6 are the only verification of the Playwright `storageState` round-trip.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0 and includes 4 passing tests from `test/session.test.js`
- [ ] `git check-ignore .jira-session.json` exits 0
- [ ] `grep -c "hasValidSession" export-issues.js` ≥ 3 (definition, call, export)
- [ ] Only in-scope files modified (`git status`)
- [ ] Step 6 outcome recorded (ran / not run) in `plans/README.md` status row

## STOP conditions

- The login section of `exportJiraIssues` no longer matches the excerpt (e.g. another plan already restructured it).
- `context.storageState({ path })` or `browser.newContext({ storageState })` is missing from the installed Playwright (`npx playwright --version` < 1.20).
- On the live run, `/rest/api/3/myself` returns 200 but the subsequent search returns 401 — the probe is not a valid signal on this tenant; report rather than adding heuristics.
- Any step would require adding a dependency.

## Maintenance notes

- Plan 011 (configurable query) and any future "run on a schedule" work assume this plan: headless + no prompt is what makes scheduling possible.
- Reviewer should check: the state file is never logged, the interactive path is unchanged when the file is absent, and the fallback closes the first browser before launching the second (otherwise two Chromium processes leak).
- Open questions deliberately left for the maintainer:
  - Session lifetime under SSO — Atlassian cloud sessions typically last days to weeks; some IdPs force re-auth sooner. Observe over a week before relying on it.
  - Some tenants may restrict `/rest/api/3/myself`; if so, probe with the search endpoint (`maxResults=1`) instead.
  - Encrypting the state file at rest (OS keychain) was not attempted; the gitignore + README warning is the spike-level mitigation.

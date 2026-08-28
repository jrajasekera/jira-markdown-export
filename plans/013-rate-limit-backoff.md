# Plan 013: Handle Jira rate limiting with backoff and adaptive throttling

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED — touches every outbound request, but adds no delay to a
  healthy run and changes no output format
- **Depends on**: the `src/` module split (post-`e388f2e`)
- **Category**: direction
- **Planned at**: 2026-08-28, beads issue `jira-markdown-export-co5`
- **Status**: DONE

## Why this matters

The exporter was already polite about *load*: every Jira call is serialized, so
there is never more than one request in flight. Adding a fixed delay on top of
that would slow exports without reducing pressure on Jira.

What it had no answer for was being throttled. Nothing in `src/` mentioned
`429`, `Retry-After`, or a retry. The consequences ranked from bad to worse:

- `searchIssues` threw `API error: 429` and the export died mid-run.
- `downloadAttachments` counted it as a failed download.
- `hasValidSession` read it as an expired session and launched a headed browser
  for a login the user did not need.
- `fetchAllParentIssues` swallowed it exactly like a 403/404 and re-rooted the
  child at the top level — **a transient throttle silently produced a wrong
  hierarchy that looked completely normal.**

## What was built

`src/http.js` — `createJiraClient(page, opts)` returns `{ get }`, the single
door every Jira request now passes through. Two concerns live there:

1. **Retry.** `429`/`503` are retried, honouring `Retry-After` in both its
   delta-seconds and HTTP-date forms, otherwise exponential backoff with half
   jitter. `JIRA_MAX_RETRIES` (default 4 retries = 5 attempts, range 0–10)
   bounds it. A `Retry-After` over 120s is refused rather than stalling.
2. **Adaptive pacing.** A throttle sets a pre-request delay
   (`min(5000, max(1000, pace * 2))`) that every later request pays once, up
   front. Clean calls decay it (`round(pace * 0.75)`, snapping to 0 under
   250ms), so recovery takes five calls, not one. The retry that recovers its
   own call deliberately does *not* decay — otherwise the first success would
   undo the slowdown before it protected anything.

**The seam.** Rather than adding a parameter everywhere, the client replaces
`page` at each call site. Arity is unchanged; `page.request.get(...)` becomes
`client.get(...)`. Pacing state is per-run and injectable rather than a module
global, and `sleep`/`random`/`now` injection keeps the suite instant.

**Failure semantics.** `RateLimitError` carries `rateLimited: true`, and the
three callers that previously conflated it with a refusal now separate them:
`fetchAllParentIssues` rethrows (aborting with exit 1 rather than shipping a
wrong tree), `hasValidSession` rethrows, and the new
`describeIssueFetchError` in `src/cli.js` passes it through instead of advising
the user to check an issue key that is fine. Attachments stay best-effort — the
Markdown is already written and the placeholder falls back to a working Jira
URL — but rate-limited ones are counted in a new `rateLimited` stat.

## Decisions worth remembering

- **Only 429 and 503 are retried.** A 502/504 gateway blip is not rate
  limiting, and conflating them would paper over real breakage.
- **Thrown network errors are not retried.** That is a separate feature;
  `downloadAttachments` already handles throws.
- **A malformed `Retry-After` never yields a delay.** Blank, negative,
  unparseable, or already-past values fall back to backoff — returning 0 would
  turn the retry loop into a spin.
- **Only the retry count is configurable.** Base delay, caps, pacing curve, and
  ceiling are constants; six knobs for a behaviour most users never see is not
  worth the surface area.

## Verification

`npm test` (142 tests), `node --check` on every source file, `git diff --check`.
New coverage: `test/http.test.js` (16 tests — Retry-After forms, malformed
values, backoff schedule, ceiling refusal, exhaustion, pace schedule and log
lines, retry-count arithmetic) and `test/config.test.js` (`intFromEnv`
validation). Existing suites gained the abort-not-orphan, session-propagation,
error-passthrough, and attachment-counter cases.

The one change that ships untested is rebuilding the client when the page is
re-created on stale-session fallback: `exportJiraIssues` cannot be exercised
without launching Chromium. It is mitigated structurally — page and client are
created together in a single `openPage` helper used at both sites, so the two
cannot drift apart.

Live Jira verification was not run: reproducing a real 429 on demand is not
practical, and the stubs cover the response shapes the client depends on.

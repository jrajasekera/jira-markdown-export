# Plan 012: Download issue attachments and link them from the exported Markdown

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan has a mandatory **report-back
> checkpoint at Step 2** before any rewriting logic is built. When done,
> update the status row for this plan in `plans/README.md` — unless a
> reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js .env.example README.md test/`
> Plans 001–008 are expected to have changed `export-issues.js`. Confirm the
> post-006 behaviour described in "Current state" (media nodes render an
> `attachment:<id>` placeholder); if not, STOP.

## Status

- **Priority**: P3
- **Effort**: M (coarse; includes a live investigation step whose answer decides the design)
- **Risk**: MED — writes binary files to disk and makes many extra authenticated requests; an unbounded loop could download gigabytes
- **Depends on**: plans/006-extend-adf-coverage.md (emits the placeholder this plan rewrites), plans/002-paginate-search-and-report-orphans.md (`searchIssues`)
- **Category**: direction
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

Jira descriptions are full of screenshots. Today an ADF `mediaSingle` node
renders as nothing (before plan 006) or as `![attachment](attachment:<uuid>)`
(after it) — a dangling reference. The browser context is already
authenticated, and each issue's `attachment` field carries a direct `content`
URL on the same host, so downloading is one `page.request.get` per file. The
hard part is not the download; it is joining the ADF media id to the REST
attachment record, which is *not* the same identifier. That join is verified
first, on one real issue, before any rewrite logic is written.

## Current state

- `export-issues.js` — the whole tool.
- After plan 006, `processNode`/`descriptionToMd` emit `![attachment](attachment:<attrs.id>)` for `media` nodes, where `attrs.id` is the Atlassian *media services* UUID (e.g. `6a1b2c3d-…`), and `attrs.collection` is typically `jira-<issueId>`.
- The REST `attachment` field (not currently requested — see `export-issues.js:28-43` in plan 011's excerpt) returns entries shaped like:

```json
{
  "id": "10042",
  "filename": "screenshot.png",
  "mimeType": "image/png",
  "size": 48213,
  "content": "https://your-instance.atlassian.net/rest/api/3/attachment/content/10042",
  "created": "2026-01-01T00:00:00.000+0000"
}
```

Note `id` here is a numeric REST id, not the media UUID. Whether any field in
this payload (or in `/rest/api/3/attachment/{id}` metadata) exposes the media
UUID is what Step 2 establishes.

Where issue folders/files are written — `generateIssueFiles` at `dff4ba2`
(`export-issues.js:141-185`), the two write sites:

```js
        fs.writeFileSync(path.join(currentDir, infoFilename), generateIssueMd(issueData));
```
```js
    fs.writeFileSync(path.join(currentDir, filename), generateIssueMd(issue));
```

`generateIssueFiles` is synchronous. Downloads are async, so this plan must
not make it async inline; instead, collect attachment work into a list during
layout and perform downloads afterwards (Step 4).

Sanitisation helper available (`export-issues.js:195-200`):

```js
function sanitizeDir(summary) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

Conventions: CommonJS, 2-space, single quotes, `[*]`/`[+]`/`[-]` log prefixes,
env config via `dotenv`, no new dependencies, tests in `test/` with `node:test`.
Fake pages in tests are plain objects with `request.get`; for binary responses
Playwright's `APIResponse` has `body()` returning a `Buffer` — the fake should
provide `body: async () => Buffer.from(...)`.

## Commands you will need

| Purpose  | Command                         | Expected on success |
|----------|---------------------------------|---------------------|
| Syntax   | `node --check export-issues.js` | exit 0              |
| Tests    | `npm test`                      | all pass            |
| Live run | `npm run export`                | interactive — operator approval required |

## Scope

**In scope**:
- `export-issues.js`
- `test/attachments.test.js` (create)
- `.env.example`, `README.md` (document `JIRA_DOWNLOAD_ATTACHMENTS`, `JIRA_MAX_ATTACHMENT_MB`)

**Out of scope**:
- Changing the ADF converter beyond reading the placeholder it already emits.
- Attachments referenced only from comments' bodies — same mechanism, but leave for follow-up to keep the spike small; note it.
- Inline rendering of non-image attachments (PDF previews etc.) — link only.

## Git workflow

- Branch: `advisor/012-download-attachments`
- Short imperative commits. Do NOT push.

## Steps

### Step 1: Add config and request the field

Top of file:

```js
const DOWNLOAD_ATTACHMENTS = process.env.JIRA_DOWNLOAD_ATTACHMENTS === '1';
const MAX_ATTACHMENT_MB = Number(process.env.JIRA_MAX_ATTACHMENT_MB || 25);
```

Default is **off**, so existing behaviour is unchanged. Add `'attachment'` to
the `fields` array.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 2: Establish the join key (report-back checkpoint)

Temporarily (not committed) add, after `searchIssues` returns in
`exportJiraIssues`, a debug block guarded by `process.env.JIRA_DEBUG_ATTACHMENTS`:

- For the first issue that has `fields.attachment.length > 0` **and** a
  `media` node in `fields.description`, log:
  - each `fields.attachment[]` entry's `id`, `filename`, and the full object keys,
  - each `media` node's `attrs` (`id`, `collection`, `type`),
  - the JSON of `GET /rest/api/3/attachment/{id}` for the first attachment.

With the operator's approval, run `JIRA_DEBUG_ATTACHMENTS=1 npm run export`
once and capture that log. Then remove the debug block.

**STOP and report the findings here.** Include the log (redact nothing except
the hostname if the operator asks — there are no secrets in these payloads).
The expected outcomes, in order of likelihood:

1. The attachment metadata contains a media UUID (a field such as `mediaApiFileId` or similar) that equals `media.attrs.id` → join on that field; proceed to Step 3 using it.
2. No UUID is exposed, but the `media` node's containing `mediaSingle` has a sibling `attrs.alt` or the description references the filename → join on `filename` as a best-effort fallback; proceed to Step 3 with `filename` as the key and log a `[-] Ambiguous attachment mapping` warning when two attachments share a filename.
3. Neither → do **not** build the placeholder rewrite. Downgrade this plan to "download all attachments into `attachments/` and append a `## Attachments` list of links to each issue file"; that is still useful and needs no join. Record the downgrade in the status row.

Do not proceed past this step without the operator's go-ahead on which branch applies.

### Step 3: Pure helpers

Add and export:

```js
function attachmentFilename(att) {
  const base = att.filename || 'file';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return `${att.id}-${sanitizeDir(stem)}${ext ? '.' + ext : ''}`;
}

// Replace attachment:<key> placeholders using a Map<key, relativePath>.
function rewriteAttachmentLinks(markdown, mapping) {
  return markdown.replace(/\(attachment:([^)]+)\)/g, (m, key) =>
    mapping.has(key) ? `(${mapping.get(key)})` : m);
}
```

`key` is whatever Step 2 decided (media UUID or filename). Unresolved
placeholders are left as-is so nothing is silently lost.

**Verify**: `node --check export-issues.js` → exit 0.

### Step 4: Collect, download, rewrite

Because `generateIssueFiles` is sync, add an optional accumulator:

- Give `generateIssueFiles` a fifth parameter `writes = null`. At both
  `fs.writeFileSync(...)` sites, if `writes` is an array, push
  `{ issue: <the issue object>, filePath, dir: currentDir }` instead of
  changing what is written. (The file is still written immediately with
  placeholders intact.)
- In `generateMarkdown`, after the root loop, if `DOWNLOAD_ATTACHMENTS`, pass
  the collected `writes` to a new `async function downloadAttachments(writes, page, maxMb)`
  which, per entry with `issue.fields.attachment?.length`:
  1. `fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true })`
  2. for each attachment: skip with `[-] Skipping <filename> (<size> MB > limit)` if `size > maxMb * 1024 * 1024`; else `const res = await page.request.get(att.content)`; on `!res.ok()` log `[-]` and continue; else write `await res.body()` to `attachments/<attachmentFilename(att)>` and log `[+] Downloaded <filename>`.
  3. build `mapping` (key per Step 2 → `attachments/<name>`), read the issue file back, `rewriteAttachmentLinks`, write it again.
- `generateMarkdown` is currently sync and called with `await` (`export-issues.js:66`); make it `async` and thread `page` through: `generateMarkdown(allIssues, page)`. Tests that call `generateMarkdown` must `await` it (check `test/layout.test.js`).

Guard against one large issue set: log a summary line at the end,
`[+] Attachments: N downloaded, M skipped, K failed`.

**Verify**: `node --check export-issues.js` → exit 0; `npm test` → all pass.

### Step 5: Tests

Create `test/attachments.test.js`:

- `attachmentFilename({ id: '10042', filename: 'My Shot (1).PNG' })` → `'10042-my-shot-1.png'`.
- `rewriteAttachmentLinks('![a](attachment:x) ![b](attachment:y)', new Map([['x', 'attachments/1.png']]))` → `'![a](attachments/1.png) ![b](attachment:y)'`.
- `downloadAttachments` with a temp dir (`fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'))`), one write entry whose issue has two attachments — one 1 KB (fake page returns `ok: () => true, body: async () => Buffer.from('png')`), one with `size` over the limit — asserts the small file exists on disk, the large one does not, and the issue file's placeholder was rewritten for the small one only.

**Verify**: `npm test` → all pass including 3 new tests.

### Step 6: Document

`.env.example`:

```
# Download attachments referenced by issues into <issue>/attachments/ (1 = on).
# JIRA_DOWNLOAD_ATTACHMENTS=0
# Skip attachments larger than this many MB.
# JIRA_MAX_ATTACHMENT_MB=25
```

`README.md` — a short "Attachments" subsection under Configuration describing
the two variables, the folder layout, and that unresolved placeholders are
left as `attachment:<id>`.

**Verify**: `grep -c JIRA_DOWNLOAD_ATTACHMENTS .env.example README.md` → ≥1 each.

## Test plan

- Unit: helpers and the download loop with a fake page (Step 5).
- Live, with operator approval: `JIRA_DOWNLOAD_ATTACHMENTS=1 npm run export` on the issue used in Step 2; open the issue's `.md` and confirm the image renders in a Markdown viewer.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0, including `test/attachments.test.js`
- [ ] With `JIRA_DOWNLOAD_ATTACHMENTS` unset, `grep -rn "attachments/" <export dir>` on a test export finds nothing (behaviour unchanged by default)
- [ ] Step 2 findings and the chosen branch (1/2/3) recorded in `plans/README.md` status row
- [ ] Only in-scope files modified

## STOP conditions

- The `attachment:<id>` placeholder from plan 006 is not present in the converter output.
- Step 2 (always — it is a report-back checkpoint).
- `page.request.get(att.content)` returns a redirect to a different host that fails auth — report; do not add credential forwarding.
- Any step would make `generateIssueFiles` itself async or restructure the layout walk.

## Maintenance notes

- Comment bodies also contain `media` nodes; the same `writes` accumulator can cover them once the join key is known.
- If plan 007's output-dir clearing is in place, attachments are re-downloaded every run; a size/etag cache is a reasonable follow-up.
- Reviewer should check the size guard is applied *before* the request (use `att.size` from metadata) and that failures never abort the whole export.

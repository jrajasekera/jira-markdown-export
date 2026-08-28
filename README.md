# Jira Markdown Export

Export Jira Cloud issues to a folder tree of Markdown files, using your own
browser login instead of an API token.

You run one command, log in to Jira in the browser window that opens, and get a
directory that mirrors your issue hierarchy:

```
exported-issues/
├── index.md
└── PROJ-1-checkout-rewrite/
    ├── _epic.md
    └── PROJ-8-guest-checkout/
        ├── _story.md
        └── PROJ-12-add-address-form.md
```

Each file holds the issue's description, metadata, linked issues, and comments,
converted from Atlassian Document Format to Markdown. Inline images are
downloaded so nothing links back to a Jira URL you need to be logged in to read.

- [Getting started](#getting-started) — first export, start to finish
- [How-to guides](#how-to-guides) — specific tasks
- [Reference](#reference) — settings, output format, CLI
- [How it works](#how-it-works) — the pipeline and its design choices

## Getting started

You need Node.js 20+ and a Jira Cloud account you can log into in a browser.

**1. Install.**

```bash
git clone https://github.com/LeeShan87/jira-markdown-export.git
cd jira-markdown-export
npm install
npx playwright install
```

**2. Point it at your Jira.**

```bash
cp .env.example .env
```

Edit `.env` and set your instance URL:

```env
JIRA_URL=https://your-instance.atlassian.net
OUTPUT_DIR=./exported-issues
```

**3. Run the export.**

```bash
npm run export
```

A Chromium window opens on your Jira instance. Log in — SSO, OAuth, whatever
your organisation uses — then return to the terminal and press **Enter**.

**4. Watch it work.** The terminal reports each stage:

```
[*] Connecting to Jira...
[*] Fetching issues...
[+] Found 23 assigned issues
[+] Total issues with parents: 31
[*] Processing 4 root issues...
[+] Exported to: ./exported-issues
```

**5. Read the results.** Open `exported-issues/index.md`. It lists every
top-level issue with a relative link into the tree, so the whole export is
browsable in any Markdown editor.

By default this exports the issues assigned to you. From here, see the how-to
guides for exporting something else.

## How-to guides

### Export a single issue

Pass an issue key or a Jira URL to export just that card and its parent chain,
skipping the JQL search:

```bash
npm run export -- ABC-123
npm run export -- "https://your-instance.atlassian.net/browse/ABC-123"
```

Board and backlog URLs work too, as long as the key is in a `selectedIssue` or
`issueKey` query parameter. The `--` is what makes npm pass the argument
through; `node export-issues.js ABC-123` needs no such separator.

Only the named card and its ancestors are fetched — its sub-tasks and other
children are not.

### Change which issues are exported

Set `JIRA_JQL` in `.env`. It defaults to `assignee = currentUser()`.

```bash
JIRA_JQL=reporter = currentUser()                      # issues you created
JIRA_JQL=assignee = currentUser() AND status != Done   # active work only
JIRA_JQL=project = MYPROJECT                           # a whole project
```

Parents of matched issues are always fetched as well, even when the JQL itself
does not select them, so the hierarchy is never broken.

The JQL is ignored when you name a single issue on the command line.

### Download all attachments, not just images

Images embedded in descriptions and comments are always downloaded. To also get
every other file attached to an issue, set in `.env`:

```bash
JIRA_DOWNLOAD_ATTACHMENTS=1
JIRA_MAX_ATTACHMENT_MB=25   # skip anything larger
```

Files land next to the issue's Markdown, and the Markdown gains an
`## Attachments` section linking each one:

```
PROJ-1-my-epic/
├── _epic.md
└── attachments/
    └── 10042-screenshot.png
```

### Add a Jira field to the export

Two edits, both required — the first fetches the field, the second renders it.

1. Add the field ID to `ISSUE_FIELDS` in `src/config.js`:

   ```javascript
   const ISSUE_FIELDS = [
     'summary',
     'description',
     // ...
     'customfield_10000',
   ].join(',');
   ```

2. Add it to the output in `generateIssueMd` in `src/render.js`.

### Log in again, or stop saving the session

After a successful login the browser session is saved to `.jira-session.json`
(gitignored). Later runs reuse it and run headless with no prompt; when it
expires you are asked to log in again and the file is refreshed.

- To force an interactive login every time, set `JIRA_STATE_FILE=` (empty) in `.env`.
- If a run errors while loading the file, delete it and rerun.
- Treat the file as a credential. It grants access to your Jira account — never
  commit it or share it.

### Run the tests

```bash
npm test
```

The suite uses Node's built-in test runner and makes no network calls, so it is
safe to run at any time. There is no build or lint step.

## Reference

### Requirements

- Node.js 20 or newer
- A Jira Cloud instance with REST API access
- Browser-based authentication (OAuth/SSO or password) for that instance

### Commands

| Command | Effect |
|---|---|
| `npm run export` | Export every issue matching `JIRA_JQL`, plus their ancestors |
| `npm run export -- <KEY\|URL>` | Export one issue and its ancestors |
| `npm test` | Run the test suite |

An export **replaces the entire contents of `OUTPUT_DIR`**. A bad issue key,
invalid CLI input, or a failed login stops the run before anything is deleted.
Errors set exit code 1.

### Environment variables

Set in `.env`. Only `JIRA_URL` really needs a value.

| Variable | Default | Meaning |
|---|---|---|
| `JIRA_URL` | `https://your-instance.atlassian.net` | Base URL of the Jira Cloud instance |
| `OUTPUT_DIR` | `./exported-issues` | Directory the export is written to; cleared on each run |
| `JIRA_JQL` | `assignee = currentUser()` | Query selecting the seed issues |
| `JIRA_STATE_FILE` | `.jira-session.json` | Playwright storage-state path; empty value disables session reuse |
| `JIRA_DOWNLOAD_ATTACHMENTS` | `0` | `1` downloads every attachment; any other value, inline media only |
| `JIRA_MAX_ATTACHMENT_MB` | `25` | Attachments larger than this are skipped |

`OUTPUT_DIR` is refused if it resolves to the filesystem root, your home
directory, the current working directory, or the repository checkout.

### Accepted issue references

- A bare key: `ABC-123` (case-insensitive)
- `https://<instance>/browse/ABC-123`
- Any URL with `?selectedIssue=ABC-123` or `?issueKey=ABC-123`

### Output structure

```
exported-issues/
├── index.md                          # export date, issue count, root issue links
├── EPIC-1-name/
│   ├── _epic.md                      # the epic itself
│   ├── STORY-1-name/
│   │   ├── _story.md
│   │   └── TASK-1-name/
│   │       ├── _task.md
│   │       ├── SUBTASK-1-name.md     # sub-tasks are files, not folders
│   │       └── SUBTASK-2-name.md
│   └── TASK-2-name/                  # task directly under the epic
│       └── _task.md
└── TASK-3-name/                      # root-level task (no parent)
    └── _task.md
```

Every issue except a sub-task becomes a directory named
`<KEY>-<sanitized summary>`, holding an info file named after the issue type
(`_epic.md`, `_story.md`, `_task.md`). Sub-tasks are single files. Whether an
issue is a leaf is decided by Jira's `issuetype.subtask` flag; the type name is
only a fallback.

### Generated issue file

Each Markdown file contains, in order:

| Section | Contents |
|---|---|
| Heading | `# KEY - summary` |
| Metadata line | type, status, priority, assignee, created date |
| `**Parent:**` | link to the parent's file, or the bare key if the parent was not exported |
| `## Description` | the ADF description as Markdown, or `No description` |
| `## Metadata` | updated date |
| `## Related Issues` | issue links, each with its direction ("blocks", "relates to", …), the target's key and summary, and a relative link when that issue is in the export |
| `## Comments` | each comment with author, date, and converted body |
| `## Attachments` | only when `JIRA_DOWNLOAD_ATTACHMENTS=1` |

### Supported ADF nodes

Converted: paragraphs, headings, bullet and ordered lists, task lists, tables,
code blocks, block quotes, panels, expands, rules, hard breaks, inline cards,
mentions, dates, emoji, status lozenges, media, and the text marks for bold,
italic, code, strikethrough, underline, super/subscript, text colour, and links.

An unrecognised block-level node leaves a visible marker in the output; an
unrecognised inline node renders as nothing.

## How it works

### Why a browser instead of an API token

Most Jira Cloud instances sit behind corporate SSO, where issuing a personal API
token is either awkward or disallowed. Playwright sidesteps that: it opens a
real browser, you authenticate however your organisation expects, and the REST
calls are then made through `page.request.get()` on that authenticated context.
The tool never sees a password, and there is no credential to configure beyond
the instance URL.

The cost is that the first run is interactive. Saving Playwright's storage state
to `.jira-session.json` buys back the unattended case: while the session is
valid, later runs launch headless and never prompt.

### The pipeline

1. **Authentication** — reuse the saved session if it is still valid, otherwise
   launch a headed browser and wait for you.
2. **Issue discovery** — page through `/rest/api/3/search/jql` with `JIRA_JQL`,
   or fetch a single issue when one was named on the command line.
3. **Hierarchy completion** — walk `fields.parent` breadth-first and fetch any
   ancestor that the search did not return.
4. **Layout** — decide each issue's path from its full parent chain, then write
   `index.md` and the issue tree.
5. **Attachments** — scan the generated Markdown for attachment placeholders and
   download what it references, rewriting the links to the local copies.
6. **ADF conversion** — happens during step 4, recursively converting Atlassian
   Document Format blocks, inline nodes, and marks.

### Why the folder tree mirrors the hierarchy

Path is the cheapest way to express parentage in plain files: an epic's story is
literally inside the epic. That makes the export navigable in a file browser, an
editor, or a note-taking app that follows relative links, with no index to keep
in sync. Cross-issue links — parent links and issue links alike — are written as
relative paths for the same reason, and resolve to nothing (plain text) when the
target was not part of the export.

An issue whose parent could not be fetched is not dropped. It is exported as its
own top-level subtree, and the run logs which parent was missing.

### Why attachment matching is fuzzy

Jira's ADF references an embedded image by an Atlassian *media services* UUID,
which is not the REST attachment id — the two live in different systems and
there is no reliable mapping in the issue payload. So a placeholder is matched
against several candidates: the attachment's REST id, its filename, the image's
alt text, and any UUID-shaped field on the attachment record.

Matching is therefore best-effort, and it degrades rather than fails. A
placeholder whose attachment was skipped for size or failed to download falls
back to the original Jira URL, which still resolves for a logged-in reader. One
that matches no attachment at all stays visible as `attachment:<id>` instead of
disappearing.

## License

MIT — see the LICENSE file.

## Contributing

Use it :) I'm not gonna update it.

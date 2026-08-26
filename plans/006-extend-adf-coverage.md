# Plan 006: Render the ADF node types that currently vanish from the export

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/adf.test.js`
> Plans 001 and 003 are expected to have changed these files. Compare the
> "Current state" excerpts against the live code; if the converter's
> structure differs beyond the additions those plans describe, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline.md, plans/003-render-link-marks.md
- **Category**: bug
- **Planned at**: commit `dff4ba2`, 2026-08-26

## Why this matters

The ADF → Markdown converter has `default: return ''` in both its block and
inline switches, so any node type it doesn't know is **silently deleted**.
Tables, nested bullet lists, task lists, info panels, horizontal rules,
expand sections, and embedded images are all common in Jira descriptions —
and every one of them currently produces an empty string with no warning.
Users get a Markdown file that reads as if the ticket said nothing, when the
original had a full acceptance-criteria table. After this plan each of these
renders to reasonable GitHub-flavoured Markdown, and unknown nodes leave a
visible marker instead of nothing.

## Current state

Files:

- `export-issues.js` — `descriptionToMd` (block-level), `processListItem`,
  `processContent`, `processParagraph`, `processNode` (inline + marks).
- `test/adf.test.js` — created by plan 001; uses `node:test` and
  `require('../export-issues.js')`.

### Block converter — `export-issues.js:249-289` (as of `dff4ba2`)

```js
function descriptionToMd(content) {
  if (!content) return 'No description';

  return content
    .map(block => {
      switch (block.type) {
        case 'paragraph':
          return processParagraph(block.content);
        case 'heading':
          const level = block.attrs?.level || 1;
          const headingText = processContent(block.content);
          return `${'#'.repeat(level)} ${headingText}`;
        case 'bulletList':
          return block.content?.map(item => `- ${processListItem(item)}`).join('\n') || '';
        case 'orderedList':
          return block.content?.map((item, i) => `${i + 1}. ${processListItem(item)}`).join('\n') || '';
        case 'codeBlock':
          const lang = block.attrs?.language || '';
          const code = block.content?.map(c => c.text || '').join('') || '';
          return `\`\`\`${lang}\n${code}\n\`\`\``;
        case 'blockquote':
          const quoteText = block.content?.map(b => processParagraph(b.content)).join('\n\n') || '';
          return quoteText.split('\n').map(line => `> ${line}`).join('\n');
        default:
          return '';                                   // :284 — silent drop
      }
    })
    .filter(line => line)
    .join('\n\n');
}
```

Note `descriptionToMd(content)` takes the **array** of block nodes (the
`.content` of the ADF `doc`), and returns the string `'No description'` for a
falsy input. Both callers (`generateIssueMd` `:226` and comments `:238`)
depend on that signature; do not change it.

### List items — `export-issues.js:291-303`

```js
function processListItem(item) {
  if (item.type === 'listItem' && item.content) {
    return item.content
      .map(block => {
        if (block.type === 'paragraph') {
          return processContent(block.content);
        }
        return '';                                     // :298 — nested lists / code dropped
      })
      .join('\n');
  }
  return '';
}
```

### Inline converter — `export-issues.js:317-363`

```js
function processNode(node) {
  if (!node) return '';
  switch (node.type) {
    case 'text':
      let text = node.text || '';
      if (node.marks && node.marks.length > 0) {
        node.marks.forEach(mark => {
          switch (mark.type) {
            case 'strong': text = `**${text}**`; break;
            case 'em':     text = `*${text}*`;   break;
            case 'code':   text = `\`${text}\``; break;
            case 'strike': text = `~~${text}~~`; break;
            // plan 003 adds: case 'link'
          }
        });
      }
      return text;
    case 'hardBreak': return '\n';
    case 'inlineCard': ...
    case 'mention': ...
    case 'emoji': ...
    default:
      return '';                                       // :361 — silent drop
  }
}
```

### Conventions

- CommonJS, 2-space indent, single quotes. Keep the `switch` style; add one
  `case` per node type. Declare `const`s inside a `case` with braces
  `case 'x': { ... }` when adding new locals (the existing code declares
  `const` directly under `case`, which works but leaks scope — use braces
  for new cases).
- Tests: one `test('renders <nodeType>', ...)` per node type in
  `test/adf.test.js`, modelled on the existing ones from plan 001. Assert
  with `assert.equal(descriptionToMd(fixture), expected)`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `npm install`                    | exit 0              |
| Syntax    | `node --check export-issues.js`  | exit 0              |
| Tests     | `npm test`                       | exit 0, all pass    |
| One file  | `node --test test/adf.test.js`   | exit 0              |

Do NOT run `npm run export`.

## Scope

**In scope**:
- `export-issues.js` — only `descriptionToMd`, `processListItem`,
  `processNode`, and one new helper `indentBlock` (below).
- `test/adf.test.js`
- `plans/README.md` (status row)

**Out of scope**:
- `generateIssueMd`, file layout, links — plans 005/012.
- Downloading attachments — plan 012. This plan only emits a placeholder.
- Changing the signature of `descriptionToMd` or `processNode`.
- Anything in `test/layout.test.js`.

## Git workflow

- Branch: `advisor/006-extend-adf-coverage`
- Commit after each step (one node family per commit is ideal), messages
  like `Render ADF tables as GFM tables`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a shared indent helper and make list items recursive

Add above `processListItem`:

```js
function indentBlock(text, prefix = '  ') {
  return text.split('\n').map(line => (line ? prefix + line : line)).join('\n');
}
```

Rewrite `processListItem` so the first paragraph stays inline after the
bullet and every other block is rendered through `descriptionToMd` and
indented by two spaces:

```js
function processListItem(item) {
  if (item.type !== 'listItem' || !item.content) return '';
  const [first, ...rest] = item.content;
  const head = first?.type === 'paragraph' ? processContent(first.content) : descriptionToMd([first]);
  if (rest.length === 0) return head;
  return `${head}\n${indentBlock(descriptionToMd(rest))}`;
}
```

Because `descriptionToMd` joins blocks with `\n\n` and returns
`'No description'` for falsy input, always pass it a non-empty array here.

Fixture for the test (nested bullet list):

```json
[{ "type": "bulletList", "content": [
  { "type": "listItem", "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "outer" }] },
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "inner" }] } ] } ] } ] } ] }]
```

Expected: `"- outer\n  - inner"`.

Also test `codeBlock` inside a list item → `"- step\n  ```\n  echo hi\n  ```"`.

**Verify**: `node --test test/adf.test.js` → both new tests pass, all
existing pass.

### Step 2: Block nodes — `rule`, `panel`, `taskList`, `expand`

Add these cases to `descriptionToMd`'s switch, before `default`:

- `rule` → `'---'`.
- `panel` → render children with `descriptionToMd(block.content)`, prefix
  every line with `> `, and prepend a first line `> **Info:**` / `> **Note:**`
  / `> **Warning:**` / `> **Error:**` / `> **Success:**` chosen by
  `block.attrs?.panelType` (`info|note|warning|error|success`; unknown →
  `**Note:**`).
  Fixture: `[{ "type": "panel", "attrs": { "panelType": "warning" }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "careful" }] }] }]`
  → `"> **Warning:**\n> careful"`.
- `taskList` → map each `taskItem`: `attrs.state === 'DONE'` → `- [x] `,
  otherwise `- [ ] `, followed by `processContent(taskItem.content)`. Join
  with `\n`.
  Fixture: `[{ "type": "taskList", "attrs": { "localId": "a" }, "content": [
  { "type": "taskItem", "attrs": { "localId": "b", "state": "TODO" }, "content": [{ "type": "text", "text": "write" }] },
  { "type": "taskItem", "attrs": { "localId": "c", "state": "DONE" }, "content": [{ "type": "text", "text": "test" }] } ] }]`
  → `"- [ ] write\n- [x] test"`.
- `expand` and `nestedExpand` → `<details>\n<summary>${attrs.title || 'Details'}</summary>\n\n${descriptionToMd(block.content)}\n\n</details>`.
  Fixture: `[{ "type": "expand", "attrs": { "title": "More" }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "hidden" }] }] }]`
  → `"<details>\n<summary>More</summary>\n\nhidden\n\n</details>"`.

**Verify**: `node --test test/adf.test.js` → four new tests pass.

### Step 3: Tables

Add `case 'table'`:

1. `rows = block.content.filter(r => r.type === 'tableRow')`.
2. For each row, cells = `row.content` (`tableHeader` or `tableCell`). Cell
   text = `descriptionToMd(cell.content)` with `\n` replaced by `<br>` and
   `|` replaced by `\|`. (Cells contain paragraphs, hence `descriptionToMd`.)
3. First row is the header. If the first row contains no `tableHeader`
   cells, still use it as the header row (GFM requires one).
4. Output: `| a | b |\n| --- | --- |\n| c | d |`. Column count = max cells
   in any row; pad short rows with empty cells.

Fixture:

```json
[{ "type": "table", "attrs": { "isNumberColumnEnabled": false, "layout": "default" }, "content": [
  { "type": "tableRow", "content": [
    { "type": "tableHeader", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Name" }] }] },
    { "type": "tableHeader", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Value" }] }] } ] },
  { "type": "tableRow", "content": [
    { "type": "tableCell", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "a|b" }] }] },
    { "type": "tableCell", "attrs": {}, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "2" }] }] } ] } ] }]
```

Expected: `"| Name | Value |\n| --- | --- |\n| a\\|b | 2 |"` (that is, the
cell text `a\|b` with a literal backslash).

**Verify**: `node --test test/adf.test.js` → table test passes.

### Step 4: Media placeholders

Add `case 'mediaSingle'` and `case 'mediaGroup'`: map children of type
`media` to `![${attrs.alt || 'attachment'}](attachment:${attrs.id})` joined
with `\n`. External media (`attrs.type === 'external'`) → `![image](${attrs.url})`.

Fixture: `[{ "type": "mediaSingle", "attrs": { "layout": "center" }, "content": [{ "type": "media", "attrs": { "id": "abc-123", "type": "file", "collection": "x" } }] }]`
→ `"![attachment](attachment:abc-123)"`.

This placeholder is the contract plan 012 will rewrite into a real relative
path; do not change the `attachment:` scheme.

**Verify**: `node --test test/adf.test.js` → passes.

### Step 5: Inline nodes and marks

In `processNode`:

- `case 'date'` → `new Date(Number(node.attrs.timestamp)).toISOString().split('T')[0]`.
  Fixture: `{ "type": "date", "attrs": { "timestamp": "1700000000000" } }` → `"2023-11-14"`.
- `case 'inlineExtension'`, `case 'placeholder'`, `case 'status'` →
  `status` renders `[${attrs.text}]`; the others `''`.
- Marks: `underline` → `<u>${text}</u>`; `subsup` → `attrs.type === 'sup'`
  ? `<sup>${text}</sup>` : `<sub>${text}</sub>`; `textColor` → leave text
  unchanged (explicit case, no-op). Keep the `link` mark from plan 003
  applied last (outermost) — read how 003 ordered marks and preserve it.

**Verify**: `node --test test/adf.test.js` → passes.

### Step 6: Make unknown nodes visible

Replace `default: return '';` in `descriptionToMd` with:

```js
default:
  return `<!-- unsupported ADF block: ${block.type} -->`;
```

Leave `processNode`'s inline default as `''` (inline markers would corrupt
sentences). Add a test that an unknown block type `foo` renders the comment.
Update the plan-001 test that asserted unknown block → `''` if one exists.

**Verify**: `npm test` → exit 0.

## Test plan

- `test/adf.test.js`, one test per: nested bulletList, codeBlock in listItem,
  rule, panel (warning), taskList, expand, table (with `|` escaping), media
  placeholder, external media, date, underline, subsup, unknown block marker.
- Pattern: existing tests in `test/adf.test.js` (plan 001).
- Verification: `npm test` → all pass, ≥13 new tests.

## Done criteria

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0 with the ≥13 new tests
- [ ] `grep -c "case '" export-issues.js` is at least 12 higher than before this plan
- [ ] `grep -n "unsupported ADF block" export-issues.js` → one match
- [ ] `descriptionToMd` and `processNode` signatures unchanged (`grep -n "^function descriptionToMd(content)" export-issues.js` → one match)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 001 or 003 not landed (`npm test` is the stub, or `processNode` has no
  `link` mark case).
- Any step appears to require changing `descriptionToMd(content)`'s
  signature or its `'No description'` fallback.
- Real Jira payloads for a node type differ from the fixture shape above
  (e.g. `taskItem` content not inline nodes) — report the shape rather than
  guessing.
- A step's tests fail twice after a fix attempt.

## Maintenance notes

- Every new ADF node type Atlassian adds will now show as an HTML comment in
  the output; grep exports for `unsupported ADF block` to find the next
  gap.
- Reviewer: check that mark ordering from plan 003 (link outermost) is
  preserved, and that `indentBlock` doesn't indent blank lines (would create
  trailing whitespace inside code fences).
- Plan 012 depends on the `attachment:<id>` placeholder from Step 4.
- Deferred: `layoutSection`/`layoutColumn` (multi-column layouts) —
  rendering columns sequentially is the obvious fallback; add when seen.

# Plan 003: Render ADF link marks and inline cards as Markdown links

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dff4ba2..HEAD -- export-issues.js test/adf.test.js`
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

Jira stores hyperlinks in Atlassian Document Format (ADF) as a `link` *mark*
on a `text` node. The converter handles `strong`, `em`, `code`, and `strike`
marks but has no case for `link`, so every hyperlink in every description and
comment is exported as bare text with its URL thrown away. `README.md` and
`CLAUDE.md` both claim link support, so the gap is also a documentation lie.
Separately, pasted URLs (`inlineCard` nodes) render as the literal text
`[Link](url)`, hiding the destination in reading views. After this plan, both
become real Markdown links.

## Current state

- `export-issues.js:317-363` — `processNode`, the inline-node converter.
  The mark switch (lines 326-341) is the site of the bug:

```js
    case 'text':
      let text = node.text || '';

      // Apply marks (bold, italic, code, etc)
      if (node.marks && node.marks.length > 0) {
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
      }

      return text;
```

  A linked text node in ADF looks like:

```json
{ "type": "text", "text": "docs", "marks": [ { "type": "link", "attrs": { "href": "https://example.com/docs" } } ] }
```

  Marks can be combined, e.g. `[{type:'strong'}, {type:'link', attrs:{href}}]`
  in either order. Jira does not guarantee mark order.

- `export-issues.js:349-351` — inline card rendering:

```js
    case 'inlineCard':
      const url = node.attrs?.url || '';
      return `[Link](${url})`;
```

Conventions: CommonJS, 2-space indent, single quotes, `switch`/`case` style
as above. No linter.

After plan 001, `processNode` and `descriptionToMd` are exported via
`module.exports`, and `test/adf.test.js` contains characterization tests
using `node:test` + `node:assert/strict`. One of them asserts the *current*
buggy behaviour (link mark renders as plain text) and is marked with a
comment like `// characterization: fixed in plan 003`. This plan flips it.

## Commands you will need

| Purpose      | Command                          | Expected on success |
|--------------|----------------------------------|---------------------|
| Syntax check | `node --check export-issues.js`  | exit 0, no output   |
| Tests        | `npm test`                       | all tests pass, exit 0 |

Do NOT run `npm run export` — it is interactive and needs a live Jira login.

## Scope

**In scope** (the only files you should modify):
- `export-issues.js` — only the `processNode` function
- `test/adf.test.js`

**Out of scope** (do NOT touch, even though they look related):
- Block-level ADF node types (`table`, nested lists, `panel`, `mediaSingle`,
  …) — plan 006 covers those.
- `README.md` / `CLAUDE.md` wording — they already claim link support; once
  this lands they are correct.
- Any other `case` in the mark switch.

## Git workflow

- Branch: `advisor/003-render-link-marks`
- Commit per step; message style is short imperative, e.g.
  `Add CLAUDE.md with project commands and architecture notes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Apply the `link` mark, outermost

Rewrite the mark loop in `processNode` so that the `link` mark is applied
*after* all other marks, producing `[**bold**](url)` rather than
`**[bold](url)**`. Target shape:

```js
    case 'text':
      let text = node.text || '';

      // Apply marks (bold, italic, code, etc). Link is applied last so the
      // link wraps the formatted text: [**bold**](url).
      const marks = node.marks || [];
      const linkMark = marks.find(mark => mark.type === 'link');

      marks.forEach(mark => {
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

      if (linkMark) {
        text = `[${text}](${linkMark.attrs?.href || ''})`;
      }

      return text;
```

**Verify**: `node --check export-issues.js` → exit 0.

### Step 2: Render inline cards with the URL as the visible text

Replace the `inlineCard` case with:

```js
    case 'inlineCard':
      const url = node.attrs?.url || '';
      return `[${url}](${url})`;
```

**Verify**: `node --check export-issues.js` → exit 0. `grep -n "\[Link\]" export-issues.js` → no output.

### Step 3: Update tests

In `test/adf.test.js`:

1. Find the characterization test marked `fixed in plan 003` and change its
   assertion to the correct output; remove the comment.
2. Add cases for `processNode`:
   - `{type:'text', text:'docs', marks:[{type:'link', attrs:{href:'https://e.com'}}]}`
     → `[docs](https://e.com)`
   - marks `[{type:'strong'}, {type:'link', attrs:{href:'https://e.com'}}]`
     → `[**docs**](https://e.com)`
   - marks `[{type:'link', attrs:{href:'https://e.com'}}, {type:'strong'}]`
     (reversed order) → `[**docs**](https://e.com)`
   - link mark with no `attrs` → `[docs]()`
   - `{type:'inlineCard', attrs:{url:'https://e.com/x'}}`
     → `[https://e.com/x](https://e.com/x)`
3. Add one `descriptionToMd` case: a paragraph containing plain text followed
   by a linked text node renders as `see [docs](https://e.com)`.

**Verify**: `npm test` → all pass, including the 6 new cases; no test still
contains the string `fixed in plan 003`.

## Test plan

- `test/adf.test.js`: the 6 cases in Step 3, modelled on the existing
  `processNode` mark tests from plan 001.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --check export-issues.js` exits 0
- [ ] `npm test` exits 0; link-mark and inlineCard tests exist and pass
- [ ] `grep -n "linkMark" export-issues.js` returns matches inside `processNode`
- [ ] `grep -n "\[Link\]" export-issues.js` returns nothing
- [ ] `grep -rn "fixed in plan 003" test/` returns nothing
- [ ] `git status` shows only `export-issues.js`, `test/adf.test.js`, and `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `module.exports` or `test/adf.test.js` does not exist — plan 001 has not landed.
- The mark switch at `export-issues.js:326-341` (line numbers may have shifted
  slightly) already contains a `case 'link'` — someone fixed it independently;
  report and mark the plan REJECTED.
- `npm test` fails twice after a reasonable fix attempt.

## Maintenance notes

- If a future change adds more marks (`underline`, `subsup`, `textColor`),
  they belong in the same switch; keep `link` as the outermost wrapper.
- Reviewer should check that the mark loop still works with `node.marks`
  undefined (the `|| []` fallback).
- Deferred: link `title` attributes and `link` marks on non-text nodes (rare
  in Jira output).

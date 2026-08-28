const { test } = require('node:test');
const assert = require('node:assert/strict');
const { descriptionToMd, processNode } = require('../src/adf.js');

// ADF helper builders keep fixtures short
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', content });
const listItem = (...content) => ({ type: 'listItem', content });

test('paragraph with marks', () => {
  const md = descriptionToMd([
    para(text('a', [{ type: 'strong' }]), text(' '), text('b', [{ type: 'em' }]),
         text(' '), text('c', [{ type: 'code' }]), text(' '), text('d', [{ type: 'strike' }])),
  ]);
  assert.equal(md, '**a** *b* `c` ~~d~~');
});

test('heading uses attrs.level', () => {
  assert.equal(
    descriptionToMd([{ type: 'heading', attrs: { level: 2 }, content: [text('Title')] }]),
    '## Title'
  );
});

test('heading without attrs.level defaults to level 1', () => {
  assert.equal(
    descriptionToMd([{ type: 'heading', content: [text('Title')] }]),
    '# Title'
  );
});

test('bulletList renders dash items', () => {
  const md = descriptionToMd([{
    type: 'bulletList',
    content: [listItem(para(text('one'))), listItem(para(text('two')))],
  }]);
  assert.equal(md, '- one\n- two');
});

test('orderedList renders numbered items', () => {
  const md = descriptionToMd([{
    type: 'orderedList',
    content: [listItem(para(text('one'))), listItem(para(text('two')))],
  }]);
  assert.equal(md, '1. one\n2. two');
});

test('codeBlock with language', () => {
  const md = descriptionToMd([{
    type: 'codeBlock',
    attrs: { language: 'js' },
    content: [text('code')],
  }]);
  assert.equal(md, '```js\ncode\n```');
});

test('codeBlock without language', () => {
  const md = descriptionToMd([{ type: 'codeBlock', content: [text('code')] }]);
  assert.equal(md, '```\ncode\n```');
});

test('blockquote prefixes every line', () => {
  const md = descriptionToMd([{
    type: 'blockquote',
    content: [para(text('first')), para(text('second'))],
  }]);
  assert.equal(md, '> first\n> \n> second');
});

test('hardBreak becomes a newline', () => {
  const md = descriptionToMd([para(text('a'), { type: 'hardBreak' }, text('b'))]);
  assert.equal(md, 'a\nb');
});

test('mention prefixes the display text with @', () => {
  assert.equal(processNode({ type: 'mention', attrs: { text: 'Jane' } }), '@Jane');
});

test('inlineCard renders the URL as its own label', () => {
  assert.equal(
    processNode({ type: 'inlineCard', attrs: { url: 'https://example.com' } }),
    '[https://example.com](https://example.com)'
  );
});

test('emoji renders its shortName', () => {
  assert.equal(processNode({ type: 'emoji', attrs: { shortName: ':smile:' } }), ':smile:');
});

test('blocks are joined with a blank line and empty blocks are dropped', () => {
  const md = descriptionToMd([para(text('x')), { type: 'bulletList' }, para(text('y'))]);
  assert.equal(md, 'x\n\ny');
});

test('unknown inline node renders as empty string', () => {
  assert.equal(processNode({ type: 'somethingNew' }), '');
});

test('null description renders the placeholder', () => {
  assert.equal(descriptionToMd(null), 'No description');
});

test('link mark renders as a Markdown link', () => {
  const md = descriptionToMd([para(text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]))]);
  assert.equal(md, '[site](https://example.com)');
});

test('link mark on a text node renders as a Markdown link', () => {
  const node = text('docs', [{ type: 'link', attrs: { href: 'https://e.com' } }]);
  assert.equal(processNode(node), '[docs](https://e.com)');
});

test('link wraps bold text when strong comes first', () => {
  const node = text('docs', [
    { type: 'strong' },
    { type: 'link', attrs: { href: 'https://e.com' } },
  ]);
  assert.equal(processNode(node), '[**docs**](https://e.com)');
});

test('link wraps bold text when link comes first', () => {
  const node = text('docs', [
    { type: 'link', attrs: { href: 'https://e.com' } },
    { type: 'strong' },
  ]);
  assert.equal(processNode(node), '[**docs**](https://e.com)');
});

test('link mark without attrs renders an empty target', () => {
  assert.equal(processNode(text('docs', [{ type: 'link' }])), '[docs]()');
});

test('inlineCard renders the URL as the link text', () => {
  const node = { type: 'inlineCard', attrs: { url: 'https://e.com/x' } };
  assert.equal(processNode(node), '[https://e.com/x](https://e.com/x)');
});

test('paragraph mixes plain text and a linked text node', () => {
  const md = descriptionToMd([para(
    text('see '),
    text('docs', [{ type: 'link', attrs: { href: 'https://e.com' } }])
  )]);
  assert.equal(md, 'see [docs](https://e.com)');
});

test('nested bulletList inside a list item is indented', () => {
  const md = descriptionToMd([{
    type: 'bulletList',
    content: [
      listItem(
        para(text('outer')),
        { type: 'bulletList', content: [listItem(para(text('inner')))] }
      ),
    ],
  }]);
  assert.equal(md, '- outer\n  - inner');
});

test('codeBlock inside a list item is indented', () => {
  const md = descriptionToMd([{
    type: 'bulletList',
    content: [
      listItem(
        para(text('step')),
        { type: 'codeBlock', content: [text('echo hi')] }
      ),
    ],
  }]);
  assert.equal(md, '- step\n  ```\n  echo hi\n  ```');
});

test('nested content in an ordered list item matches the marker width', () => {
  const item = () => listItem(
    para(text('outer')),
    { type: 'bulletList', content: [listItem(para(text('inner')))] }
  );
  const md = descriptionToMd([{ type: 'orderedList', content: [item()] }]);
  // `1. ` is three columns wide, so two spaces would break the item.
  assert.equal(md, '1. outer\n   - inner');

  const wide = descriptionToMd([{
    type: 'orderedList',
    content: Array.from({ length: 10 }, item),
  }]);
  assert.equal(wide.split('\n').slice(-2).join('\n'), '10. outer\n    - inner');
});

test('a list item starting with a code block keeps the fence inside the item', () => {
  const md = descriptionToMd([{
    type: 'bulletList',
    content: [listItem({ type: 'codeBlock', content: [text('echo hi')] })],
  }]);
  assert.equal(md, '- ```\n  echo hi\n  ```');
});

test('rule renders a horizontal rule', () => {
  assert.equal(descriptionToMd([{ type: 'rule' }]), '---');
});

test('panel renders a labelled blockquote', () => {
  const md = descriptionToMd([{
    type: 'panel',
    attrs: { panelType: 'warning' },
    content: [para(text('careful'))],
  }]);
  assert.equal(md, '> **Warning:**\n> careful');
});

test('panel with an unknown panelType falls back to Note', () => {
  const md = descriptionToMd([{
    type: 'panel',
    attrs: { panelType: 'mystery' },
    content: [para(text('hmm'))],
  }]);
  assert.equal(md, '> **Note:**\n> hmm');
});

test('taskList renders GFM checkboxes', () => {
  const md = descriptionToMd([{
    type: 'taskList',
    attrs: { localId: 'a' },
    content: [
      { type: 'taskItem', attrs: { localId: 'b', state: 'TODO' }, content: [text('write')] },
      { type: 'taskItem', attrs: { localId: 'c', state: 'DONE' }, content: [text('test')] },
    ],
  }]);
  assert.equal(md, '- [ ] write\n- [x] test');
});

test('expand renders a details block', () => {
  const md = descriptionToMd([{
    type: 'expand',
    attrs: { title: 'More' },
    content: [para(text('hidden'))],
  }]);
  assert.equal(md, '<details>\n<summary>More</summary>\n\nhidden\n\n</details>');
});

test('nestedExpand without a title uses the default summary', () => {
  const md = descriptionToMd([{
    type: 'nestedExpand',
    content: [para(text('hidden'))],
  }]);
  assert.equal(md, '<details>\n<summary>Details</summary>\n\nhidden\n\n</details>');
});

test('table renders a GFM table and escapes pipes', () => {
  const header = t => ({ type: 'tableHeader', attrs: {}, content: [para(text(t))] });
  const cell = t => ({ type: 'tableCell', attrs: {}, content: [para(text(t))] });
  const md = descriptionToMd([{
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [
      { type: 'tableRow', content: [header('Name'), header('Value')] },
      { type: 'tableRow', content: [cell('a|b'), cell('2')] },
    ],
  }]);
  assert.equal(md, '| Name | Value |\n| --- | --- |\n| a\\|b | 2 |');
});

test('table pads short rows to the widest row', () => {
  const cell = t => ({ type: 'tableCell', attrs: {}, content: [para(text(t))] });
  const md = descriptionToMd([{
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('a')] },
      { type: 'tableRow', content: [cell('b'), cell('c')] },
    ],
  }]);
  assert.equal(md, '| a |  |\n| --- | --- |\n| b | c |');
});

test('mediaSingle renders an attachment placeholder', () => {
  const md = descriptionToMd([{
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [{ type: 'media', attrs: { id: 'abc-123', type: 'file', collection: 'x' } }],
  }]);
  assert.equal(md, '![attachment](attachment:abc-123)');
});

test('media with an empty alt falls back to the default label', () => {
  const md = descriptionToMd([{
    type: 'mediaSingle',
    content: [{ type: 'media', attrs: { id: 'abc-123', alt: '', type: 'file' } }],
  }]);
  assert.equal(md, '![attachment](attachment:abc-123)');
});

test('external media renders its URL', () => {
  const md = descriptionToMd([{
    type: 'mediaGroup',
    content: [{ type: 'media', attrs: { type: 'external', url: 'https://e.com/i.png' } }],
  }]);
  assert.equal(md, '![image](https://e.com/i.png)');
});

test('date renders an ISO day', () => {
  assert.equal(processNode({ type: 'date', attrs: { timestamp: '1700000000000' } }), '2023-11-14');
});

test('status renders its text in brackets', () => {
  assert.equal(processNode({ type: 'status', attrs: { text: 'In Progress' } }), '[In Progress]');
});

test('underline mark renders an HTML tag', () => {
  assert.equal(processNode(text('u', [{ type: 'underline' }])), '<u>u</u>');
});

test('subsup mark renders sup and sub', () => {
  assert.equal(processNode(text('2', [{ type: 'subsup', attrs: { type: 'sup' } }])), '<sup>2</sup>');
  assert.equal(processNode(text('2', [{ type: 'subsup', attrs: { type: 'sub' } }])), '<sub>2</sub>');
});

test('textColor mark leaves the text unchanged', () => {
  assert.equal(processNode(text('x', [{ type: 'textColor', attrs: { color: '#ff0000' } }])), 'x');
});

test('unknown block type renders a visible marker', () => {
  assert.equal(descriptionToMd([{ type: 'foo' }]), '<!-- unsupported ADF block: foo -->');
});

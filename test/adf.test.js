const { test } = require('node:test');
const assert = require('node:assert/strict');
const { descriptionToMd, processNode } = require('../export-issues.js');

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
  const md = descriptionToMd([para(text('x')), { type: 'rule' }, para(text('y'))]);
  assert.equal(md, 'x\n\ny');
});

test('unknown block type renders as empty string', () => {
  assert.equal(descriptionToMd([{ type: 'table' }]), '');
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

// characterization: fixed in plan 006 (nested lists inside a listItem are dropped)
test('nested list inside a list item is currently dropped', () => {
  const md = descriptionToMd([{
    type: 'bulletList',
    content: [
      listItem(
        para(text('outer')),
        { type: 'bulletList', content: [listItem(para(text('inner')))] }
      ),
    ],
  }]);
  assert.equal(md, '- outer\n');
});

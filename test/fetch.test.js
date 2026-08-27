const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllParentIssues } = require('../export-issues.js');

const JIRA = 'https://x.test';
const FIELDS = 'summary,parent';

function fakePage(byKey) {
  const calls = [];
  return {
    calls,
    request: {
      async get(url) {
        calls.push(url);
        const key = url.match(/\/issue\/([^?]+)/)[1];
        const found = byKey[key];
        return {
          ok: () => Boolean(found),
          status: () => (found ? 200 : 404),
          json: async () => found,
        };
      },
    },
  };
}

test('walks the parent chain to the root', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const page = fakePage({
    'PRJ-2': { key: 'PRJ-2', fields: { parent: { key: 'PRJ-1' } } },
    'PRJ-1': { key: 'PRJ-1', fields: {} },
  });

  const result = await fetchAllParentIssues([leaf], page, JIRA, FIELDS);

  assert.equal(result.length, 3);
  assert.deepEqual(result.map(i => i.key).sort(), ['PRJ-1', 'PRJ-2', 'PRJ-3']);
  assert.equal(page.calls.length, 2);
  for (const url of page.calls) {
    assert.ok(url.startsWith(`${JIRA}/rest/api/3/issue/`), url);
    assert.ok(url.includes('?fields=summary%2Cparent'), url);
  }
});

test('the parent key and fields are URL-encoded in the request', async () => {
  const leaf = { key: 'ABC-13', fields: { parent: { key: 'ABC-12' } } };
  const page = fakePage({ 'ABC-12': { key: 'ABC-12', fields: {} } });

  await fetchAllParentIssues([leaf], page, JIRA, FIELDS);

  assert.equal(page.calls.length, 1);
  assert.ok(page.calls[0].includes('/rest/api/3/issue/ABC-12?fields='), page.calls[0]);
});

test('a shared parent is fetched only once', async () => {
  const leaves = [
    { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } },
    { key: 'PRJ-4', fields: { parent: { key: 'PRJ-2' } } },
  ];
  const page = fakePage({ 'PRJ-2': { key: 'PRJ-2', fields: {} } });

  const result = await fetchAllParentIssues(leaves, page, JIRA, FIELDS);

  assert.equal(result.length, 3);
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls.filter(u => u.includes('/issue/PRJ-2')).length, 1);
});

test('a failed parent fetch is skipped, not thrown', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const page = fakePage({}); // every lookup 404s

  const result = await fetchAllParentIssues([leaf], page, JIRA, FIELDS);

  assert.deepEqual(result.map(i => i.key), ['PRJ-3']);
  assert.equal(page.calls.length, 1);
});

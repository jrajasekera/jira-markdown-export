const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllParentIssues, fetchIssue } = require('../export-issues.js');

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

test('fetchIssue returns the issue body on success', async () => {
  const issue = { key: 'PRJ-1', fields: {} };
  const page = fakePage({ 'PRJ-1': issue });

  assert.deepEqual(await fetchIssue(page, JIRA, 'PRJ-1', FIELDS), issue);
  assert.equal(page.calls[0], `${JIRA}/rest/api/3/issue/PRJ-1?fields=summary%2Cparent`);
});

test('fetchIssue throws with the HTTP status attached', async () => {
  const page = fakePage({}); // every lookup 404s

  await assert.rejects(
    () => fetchIssue(page, JIRA, 'PRJ-1', FIELDS),
    (error) => {
      assert.equal(error.status, 404);
      assert.match(error.message, /Failed to fetch PRJ-1: 404/);
      return true;
    },
  );
});

test('a non-OK parent is logged as a failed fetch, not an error', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const page = fakePage({});
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await fetchAllParentIssues([leaf], page, JIRA, FIELDS);
  } finally {
    console.log = original;
  }

  assert.ok(lines.includes('[-] Failed to fetch PRJ-2: 404'), lines.join('\n'));
  assert.equal(lines.some(l => l.startsWith('[-] Error fetching')), false);
});

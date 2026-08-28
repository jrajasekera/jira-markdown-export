const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAllParentIssues, fetchIssue } = require('../src/jira-client.js');

const JIRA = 'https://x.test';
const FIELDS = 'summary,parent';

function fakeClient(byKey) {
  const calls = [];
  return {
    calls,
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
  };
}

test('walks the parent chain to the root', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const client = fakeClient({
    'PRJ-2': { key: 'PRJ-2', fields: { parent: { key: 'PRJ-1' } } },
    'PRJ-1': { key: 'PRJ-1', fields: {} },
  });

  const result = await fetchAllParentIssues([leaf], client, JIRA, FIELDS);

  assert.equal(result.length, 3);
  assert.deepEqual(result.map(i => i.key).sort(), ['PRJ-1', 'PRJ-2', 'PRJ-3']);
  assert.equal(client.calls.length, 2);
  for (const url of client.calls) {
    assert.ok(url.startsWith(`${JIRA}/rest/api/3/issue/`), url);
    assert.ok(url.includes('?fields=summary%2Cparent'), url);
  }
});

test('the parent key and fields are URL-encoded in the request', async () => {
  const leaf = { key: 'ABC-13', fields: { parent: { key: 'ABC-12' } } };
  const client = fakeClient({ 'ABC-12': { key: 'ABC-12', fields: {} } });

  await fetchAllParentIssues([leaf], client, JIRA, FIELDS);

  assert.equal(client.calls.length, 1);
  assert.ok(client.calls[0].includes('/rest/api/3/issue/ABC-12?fields='), client.calls[0]);
});

test('a shared parent is fetched only once', async () => {
  const leaves = [
    { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } },
    { key: 'PRJ-4', fields: { parent: { key: 'PRJ-2' } } },
  ];
  const client = fakeClient({ 'PRJ-2': { key: 'PRJ-2', fields: {} } });

  const result = await fetchAllParentIssues(leaves, client, JIRA, FIELDS);

  assert.equal(result.length, 3);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls.filter(u => u.includes('/issue/PRJ-2')).length, 1);
});

test('a failed parent fetch is skipped, not thrown', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const client = fakeClient({}); // every lookup 404s

  const result = await fetchAllParentIssues([leaf], client, JIRA, FIELDS);

  assert.deepEqual(result.map(i => i.key), ['PRJ-3']);
  assert.equal(client.calls.length, 1);
});

test('a rate-limited parent fetch aborts instead of orphaning the child', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const client = {
    get: async () => {
      const error = new Error('Jira rate-limited this export (HTTP 429)');
      error.status = 429;
      error.rateLimited = true;
      throw error;
    },
  };

  // Silently dropping the parent here would ship a wrong hierarchy that looks
  // exactly like a legitimate top-level issue.
  await assert.rejects(
    () => fetchAllParentIssues([leaf], client, JIRA, FIELDS),
    (error) => error.rateLimited === true
  );
});

test('fetchIssue returns the issue body on success', async () => {
  const issue = { key: 'PRJ-1', fields: {} };
  const client = fakeClient({ 'PRJ-1': issue });

  assert.deepEqual(await fetchIssue(client, JIRA, 'PRJ-1', FIELDS), issue);
  assert.equal(client.calls[0], `${JIRA}/rest/api/3/issue/PRJ-1?fields=summary%2Cparent`);
});

test('fetchIssue throws with the HTTP status attached', async () => {
  const client = fakeClient({}); // every lookup 404s

  await assert.rejects(
    () => fetchIssue(client, JIRA, 'PRJ-1', FIELDS),
    (error) => {
      assert.equal(error.status, 404);
      assert.match(error.message, /Failed to fetch PRJ-1: 404/);
      return true;
    },
  );
});

test('a non-OK parent is logged as a failed fetch, not an error', async () => {
  const leaf = { key: 'PRJ-3', fields: { parent: { key: 'PRJ-2' } } };
  const client = fakeClient({});
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await fetchAllParentIssues([leaf], client, JIRA, FIELDS);
  } finally {
    console.log = original;
  }

  assert.ok(lines.includes('[-] Failed to fetch PRJ-2: 404'), lines.join('\n'));
  assert.equal(lines.some(l => l.startsWith('[-] Error fetching')), false);
});

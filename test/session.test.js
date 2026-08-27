const test = require('node:test');
const assert = require('node:assert/strict');
const { hasValidSession } = require('../export-issues.js');

function fakePage(status, body) {
  return {
    request: {
      get: async () => ({
        ok: () => status >= 200 && status < 300,
        status: () => status,
        json: async () => body,
      }),
    },
  };
}

test('hasValidSession returns the user on 200 with accountId', async () => {
  const me = await hasValidSession(fakePage(200, { accountId: 'abc', displayName: 'Ada' }), 'https://x.atlassian.net');
  assert.equal(me.displayName, 'Ada');
});

test('hasValidSession returns null on 401', async () => {
  assert.equal(await hasValidSession(fakePage(401, {}), 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null when the request throws', async () => {
  const page = { request: { get: async () => { throw new Error('net'); } } };
  assert.equal(await hasValidSession(page, 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null on 200 without accountId (login page as JSON-less HTML)', async () => {
  assert.equal(await hasValidSession(fakePage(200, {}), 'https://x.atlassian.net'), null);
});

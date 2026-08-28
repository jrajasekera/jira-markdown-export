const test = require('node:test');
const assert = require('node:assert/strict');
const { hasValidSession } = require('../src/session.js');

function fakeClient(status, body) {
  return {
    get: async () => ({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => body,
    }),
  };
}

test('hasValidSession returns the user on 200 with accountId', async () => {
  const me = await hasValidSession(fakeClient(200, { accountId: 'abc', displayName: 'Ada' }), 'https://x.atlassian.net');
  assert.equal(me.displayName, 'Ada');
});

test('hasValidSession returns null on 401', async () => {
  assert.equal(await hasValidSession(fakeClient(401, {}), 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null when the request throws', async () => {
  const client = { get: async () => { throw new Error('net'); } };
  assert.equal(await hasValidSession(client, 'https://x.atlassian.net'), null);
});

test('hasValidSession returns null on 200 without accountId (login page as JSON-less HTML)', async () => {
  assert.equal(await hasValidSession(fakeClient(200, {}), 'https://x.atlassian.net'), null);
});

test('hasValidSession propagates a rate-limit error instead of reporting an expired session', async () => {
  const client = {
    get: async () => {
      const error = new Error('rate limited');
      error.rateLimited = true;
      throw error;
    },
  };

  // Reporting null here would send the user through an interactive login they
  // do not need; the session is probably fine, Jira just would not say.
  await assert.rejects(
    () => hasValidSession(client, 'https://x.atlassian.net'),
    (error) => error.rateLimited === true
  );
});

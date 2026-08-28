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

test('hasValidSession asks the client to return authentication failures for the login fallback', async () => {
  let options;
  const client = {
    get: async (_url, _init, actualOptions) => {
      options = actualOptions;
      return { ok: () => false, status: () => 401 };
    },
  };

  assert.equal(await hasValidSession(client, 'https://x.atlassian.net'), null);
  assert.deepEqual(options, { allowAuthFailure: true });
});

test('hasValidSession propagates a request failure instead of claiming the session expired', async () => {
  const error = new Error('net');
  const client = { get: async () => { throw error; } };
  await assert.rejects(() => hasValidSession(client, 'https://x.atlassian.net'), (actual) => actual === error);
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

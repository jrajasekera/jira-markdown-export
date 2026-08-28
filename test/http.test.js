const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createJiraClient,
  RateLimitError,
  SessionExpiredError,
  TransientRequestError,
  parseRetryAfter,
} = require('../src/http.js');

const URL = 'https://x.test/rest/api/3/myself';

// Responses are queued in order; each `get` shifts one off. `sleeps` records
// what the client *would* have waited, so the suite asserts the delay schedule
// without spending any of it.
function harness(responses, options = {}) {
  const sleeps = [];
  const urls = [];
  const page = {
    request: {
      get: async (url) => {
        urls.push(url);
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra request');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  const client = createJiraClient(page, {
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
    now: () => 0,
    ...options,
  });
  return { client, sleeps, urls };
}

const respond = (status, headers) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
  json: async () => ({ status }),
  ...(headers ? { headers: () => headers } : {}),
});

// Silence the client's progress logging for a block, returning what it printed.
async function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

test('a healthy response passes through without waiting', async () => {
  const { client, sleeps } = harness([respond(200)]);

  const res = await client.get(URL);

  assert.equal(res.status(), 200);
  assert.deepEqual(sleeps, []);
});

test('honours a delta-seconds Retry-After', async () => {
  const { client, sleeps, urls } = harness([
    respond(429, { 'retry-after': '2' }),
    respond(200),
  ]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(urls.length, 2);
});

test('honours an HTTP-date Retry-After', async () => {
  const { client, sleeps } = harness([
    respond(429, { 'retry-after': new Date(5000).toUTCString() }),
    respond(200),
  ]);

  await captureLog(() => client.get(URL));

  assert.deepEqual(sleeps, [5000]);
});

test('falls back to exponential backoff when Retry-After is absent', async () => {
  const { client, sleeps } = harness([
    respond(429, {}),
    respond(429, {}),
    respond(429, {}),
    respond(200),
  ]);

  await captureLog(() => client.get(URL));

  // base 1000 doubling, halved because random() is pinned to 0 (half jitter).
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test('retries a 503 the same way as a 429', async () => {
  const { client, sleeps } = harness([respond(503, {}), respond(200)]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
  assert.deepEqual(sleeps, [500]);
});

test('retries transient 5xx responses with bounded backoff', async () => {
  const { client, sleeps, urls } = harness([respond(502), respond(504), respond(200)]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
  assert.equal(urls.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('reports an exhausted transient 5xx response without calling it rate limiting', async () => {
  const { client } = harness([respond(500), respond(500)], { maxRetries: 1 });

  await captureLog(() => assert.rejects(
    () => client.get(URL),
    (error) => error instanceof TransientRequestError && error.status === 500 && !error.rateLimited
  ));
});

test('retries transient connection resets with bounded backoff', async () => {
  const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const { client, sleeps, urls } = harness([reset, respond(200)]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
  assert.equal(urls.length, 2);
  assert.deepEqual(sleeps, [500]);
});

test('reports an exhausted transient network error', async () => {
  const reset = Object.assign(new Error('net::ERR_CONNECTION_RESET'), { code: 'ECONNRESET' });
  const { client } = harness([reset], { maxRetries: 0 });

  await captureLog(() => assert.rejects(
    () => client.get(URL),
    (error) => error instanceof TransientRequestError && error.transient === true && error.cause === reset
  ));
});

test('fails immediately with session recovery guidance on 401 or 403', async () => {
  for (const status of [401, 403]) {
    const { client, sleeps, urls } = harness([respond(status)]);
    await assert.rejects(
      () => client.get(URL),
      (error) => error instanceof SessionExpiredError
        && error.sessionExpired === true
        && error.status === status
        && /Delete or refresh the saved session/.test(error.message)
    );
    assert.equal(urls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

test('fails immediately when a REST request lands on a login page', async () => {
  const login = { ...respond(200), url: () => 'https://sso.example.test/login?continue=example' };
  const { client } = harness([login]);

  await assert.rejects(() => client.get(URL), SessionExpiredError);
});

test('fails immediately when a REST request redirects to a non-API IdP path', async () => {
  const idp = { ...respond(200), url: () => 'https://idp.example.test/saml/consume' };
  const { client } = harness([idp]);

  await assert.rejects(() => client.get(URL), SessionExpiredError);
});

test('returns authentication failures unchanged for the initial session probe only', async () => {
  const { client } = harness([respond(401)]);

  const response = await client.get(URL, undefined, { allowAuthFailure: true });

  assert.equal(response.status(), 401);
});

test('throws a rate-limit error once retries are exhausted', async () => {
  const { client } = harness(
    [respond(429, {}), respond(429, {}), respond(429, {})],
    { maxRetries: 2 }
  );

  await captureLog(() => assert.rejects(
    () => client.get(URL),
    (error) => {
      assert.ok(error instanceof RateLimitError);
      assert.equal(error.rateLimited, true);
      assert.equal(error.status, 429);
      return true;
    }
  ));
});

test('refuses a Retry-After beyond the ceiling instead of stalling', async () => {
  const { client, sleeps, urls } = harness([respond(429, { 'retry-after': '600' })]);

  await captureLog(() => assert.rejects(() => client.get(URL), /rate-limited/));

  assert.deepEqual(sleeps, [], 'must not wait 10 minutes');
  assert.equal(urls.length, 1, 'must not retry');
});

test('treats a response without headers() as carrying no Retry-After', async () => {
  const { client, sleeps } = harness([respond(429), respond(200)]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
  assert.deepEqual(sleeps, [500]);
});

test('ignores a malformed Retry-After rather than waiting zero', async () => {
  for (const value of ['', '   ', 'soon', '-1', '0', 'not-a-date', new Date(-5000).toUTCString()]) {
    const { client, sleeps } = harness([
      respond(429, { 'retry-after': value }),
      respond(200),
    ]);

    await captureLog(() => client.get(URL));

    assert.deepEqual(sleeps, [500], `Retry-After: ${JSON.stringify(value)}`);
    assert.ok(sleeps.every(ms => ms > 0), 'no wait may be zero or negative');
  }
});

test('parseRetryAfter accepts a date exactly equal to now as no guidance', () => {
  assert.equal(parseRetryAfter(new Date(0).toUTCString(), () => 0), null);
  assert.equal(parseRetryAfter('2', () => 0), 2000);
});

test('paces later requests after a throttle and decays back to full speed', async () => {
  // One throttled call, then six clean ones. The recovering retry must not
  // decay the pace, or the slowdown would never reach the calls that follow.
  const { client, sleeps } = harness([
    respond(429, { 'retry-after': '1' }),
    respond(200),
    respond(200), respond(200), respond(200), respond(200), respond(200), respond(200),
  ]);

  await captureLog(async () => {
    for (let i = 0; i < 7; i++) await client.get(URL);
  });

  // [0] is the Retry-After wait; the rest are the pre-request pacing delays.
  assert.deepEqual(sleeps, [1000, 1000, 750, 563, 422, 317]);
});

test('announces pacing once when it engages and once when it clears', async () => {
  const { client } = harness([
    respond(429, { 'retry-after': '1' }),
    respond(200),
    respond(200), respond(200), respond(200), respond(200), respond(200), respond(200),
  ]);

  const { lines } = await captureLog(async () => {
    for (let i = 0; i < 7; i++) await client.get(URL);
  });

  assert.equal(lines.filter(l => l.includes('pacing requests')).length, 1);
  assert.equal(lines.filter(l => l.includes('back to full speed')).length, 1);
  assert.equal(lines.filter(l => l.includes('retry 1/')).length, 1);
});

test('pace doubles under repeated throttling up to the cap', async () => {
  const throttle = () => respond(429, { 'retry-after': '1' });
  const { client, sleeps } = harness([
    throttle(), throttle(), respond(200),   // pace 1000 -> 2000
    throttle(), throttle(), respond(200),   // pace 4000 -> 5000 (capped)
    respond(200),
  ]);

  await captureLog(async () => {
    for (let i = 0; i < 3; i++) await client.get(URL);
  });

  // The third call pays the capped pace up front rather than an eighth of a
  // minute: doubling stops at 5000ms however hard Jira pushes back.
  assert.equal(sleeps[sleeps.length - 1], 5000);
});

test('recovers across a mixed 429 then 503 sequence', async () => {
  const { client } = harness([respond(429, {}), respond(503, {}), respond(200)]);

  const { result } = await captureLog(() => client.get(URL));

  assert.equal(result.status(), 200);
});

test('a non-throttle error status is returned untouched and never retried', async () => {
  const { client, sleeps, urls } = harness([respond(404)]);

  const res = await client.get(URL);

  assert.equal(res.status(), 404);
  assert.equal(urls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('maxRetries counts retries after the first attempt', async () => {
  for (const [maxRetries, expectedRequests] of [[0, 1], [1, 2], [4, 5]]) {
    const responses = Array.from({ length: expectedRequests }, () => respond(429, {}));
    const { client, urls } = harness(responses, { maxRetries });

    await captureLog(() => assert.rejects(() => client.get(URL), /rate-limited/));

    assert.equal(urls.length, expectedRequests, `maxRetries=${maxRetries}`);
  }
});

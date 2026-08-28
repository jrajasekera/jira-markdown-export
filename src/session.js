const readline = require('readline');

// Probe whether the current browser context is still authenticated with Jira.
// Returns the `myself` payload when it is, otherwise null. An expired session is
// the normal fallback path rather than an error, so failures are swallowed —
// with one exception: a rate-limited probe says nothing about the session, and
// reporting it as expired would send the user through an interactive login they
// do not need.
async function hasValidSession(client, jiraUrl) {
  try {
    const res = await client.get(`${jiraUrl}/rest/api/3/myself`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok()) return null;
    const me = await res.json();
    return me && me.accountId ? me : null;
  } catch (error) {
    if (error.rateLimited) throw error;
    return null;
  }
}

function waitForUserInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

module.exports = {
  hasValidSession,
  waitForUserInput,
};

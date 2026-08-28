const readline = require('readline');
const { isLoginRedirect } = require('./http.js');

// Probe whether the current browser context is still authenticated with Jira.
// Returns the `myself` payload when it is, otherwise null. An authentication
// response is the normal interactive-login fallback. Transport and rate-limit
// failures say nothing about the session, so they propagate instead of making
// the user re-authenticate unnecessarily.
async function hasValidSession(client, jiraUrl) {
  try {
    const res = await client.get(`${jiraUrl}/rest/api/3/myself`, {
      headers: { 'Accept': 'application/json' },
    }, { allowAuthFailure: true });
    if (!res.ok()) return null;
    if (isLoginRedirect(`${jiraUrl}/rest/api/3/myself`, typeof res.url === 'function' ? res.url() : null)) return null;
    const me = await res.json();
    return me && me.accountId ? me : null;
  } catch (error) {
    throw error;
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

const readline = require('readline');

// Probe whether the current browser context is still authenticated with Jira.
// Returns the `myself` payload when it is, otherwise null. Never throws: an
// expired session is the normal fallback path, not an error.
async function hasValidSession(page, jiraUrl) {
  try {
    const res = await page.request.get(`${jiraUrl}/rest/api/3/myself`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok()) return null;
    const me = await res.json();
    return me && me.accountId ? me : null;
  } catch (error) {
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

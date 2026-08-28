const { chromium } = require('playwright');
const fs = require('fs');
const {
  JIRA_URL,
  OUTPUT_DIR,
  STATE_FILE,
  CUSTOM_FIELD_OVERRIDES,
  buildIssueFields,
} = require('./src/config.js');
const { hasValidSession, waitForUserInput } = require('./src/session.js');
const {
  searchIssues,
  fetchIssue,
  fetchAllParentIssues,
  resolveCustomFieldIds,
} = require('./src/jira-client.js');
const { generateMarkdown } = require('./src/pipeline.js');
const { parseExportArgs, describeIssueFetchError } = require('./src/cli.js');
const { createJiraClient } = require('./src/http.js');

async function exportJiraIssues({ issueKey, issueKeys, jql } = {}) {
  const requestedIssueKeys = [...new Set(issueKeys || (issueKey ? [issueKey] : []))];
  const canReuse = Boolean(STATE_FILE) && fs.existsSync(STATE_FILE);
  // Page and client are created together and never separately: every Jira
  // request goes through the client, so a page without its client would silently
  // bypass rate-limit handling.
  async function openPage(browser, contextOptions) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    return { context, page, client: createJiraClient(page) };
  }

  let browser = await chromium.launch({ headless: canReuse });
  let { context, page, client } = await openPage(browser, canReuse ? { storageState: STATE_FILE } : {});

  try {
    console.log('[*] Connecting to Jira...');

    const me = canReuse ? await hasValidSession(client, JIRA_URL) : null;
    if (me) {
      console.log(`[+] Reusing saved session for ${me.displayName}`);
    } else {
      if (canReuse) {
        console.log('[-] Saved session is no longer valid; log in interactively to refresh it');
        await browser.close();
        browser = await chromium.launch({ headless: false });
        ({ context, page, client } = await openPage(browser, {}));
      }

      // 1. Open Jira (uses existing SSO session)
      await page.goto(JIRA_URL);

      // Wait for login to complete - interactive mode
      console.log('[!] Browser window opened. Log in to Jira, then press ENTER here...');
      await waitForUserInput();

      if (STATE_FILE) {
        await context.storageState({ path: STATE_FILE });
        console.log(`[+] Saved session to ${STATE_FILE}`);
      }
    }

    console.log('[*] Fetching issues...');

    const customFields = await resolveCustomFieldIds(client, JIRA_URL, CUSTOM_FIELD_OVERRIDES, {
      issueKeys: requestedIssueKeys,
    });
    const issueFields = buildIssueFields(customFields);
    const missingFields = Object.entries(customFields)
      .filter(([, id]) => !id)
      .map(([name]) => name);
    if (missingFields.length > 0) {
      console.log(`[-] Custom Jira fields not found: ${missingFields.join(', ')}; omitting them from this export`);
    }

    // 2. REST API calls with the authenticated session
    let seedIssues;
    if (requestedIssueKeys.length > 0) {
      seedIssues = [];
      for (const requestedIssueKey of requestedIssueKeys) {
        console.log(`[*] Fetching ${requestedIssueKey}...`);
        try {
          seedIssues.push(await fetchIssue(client, JIRA_URL, requestedIssueKey, issueFields));
        } catch (error) {
          throw describeIssueFetchError(error, requestedIssueKey);
        }
      }
    } else {
      seedIssues = await searchIssues(client, JIRA_URL, issueFields, jql);
      console.log(`[+] Found ${seedIssues.length} assigned issues`);
    }

    // 3. Fetch all parent issues recursively
    const allIssues = await fetchAllParentIssues(seedIssues, client, JIRA_URL, issueFields);
    console.log(`[+] Total issues with parents: ${allIssues.length}`);

    // 4. Generate markdown
    await generateMarkdown(allIssues, client, { jiraUrl: JIRA_URL, customFields });

    console.log(`[+] Exported to: ${OUTPUT_DIR}`);

  } catch (error) {
    if (error.sessionExpired) {
      console.error('[-] Jira session expired during export. Delete or refresh the saved session, then run the export again.');
    } else {
      console.error('[-] Error:', error);
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

module.exports = {
  exportJiraIssues,
};

// Run the export only when invoked directly (`node export-issues.js`),
// not when required by tests.
if (require.main === module) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node export-issues.js [ISSUE-KEY | issue URL]... | --jql "JQL"';
  const parsedArgs = parseExportArgs(args);

  if (parsedArgs.error) {
    console.error(`[-] ${parsedArgs.error}\n${usage}`);
    process.exitCode = 1;
  } else {
    exportJiraIssues(parsedArgs);
  }
}

const { chromium } = require('playwright');
const fs = require('fs');
const { JIRA_URL, OUTPUT_DIR, STATE_FILE, ISSUE_FIELDS } = require('./src/config.js');
const { hasValidSession, waitForUserInput } = require('./src/session.js');
const { searchIssues, fetchIssue, fetchAllParentIssues } = require('./src/jira-client.js');
const { generateMarkdown } = require('./src/pipeline.js');
const { parseIssueRef } = require('./src/cli.js');

async function exportJiraIssues({ issueKey } = {}) {
  const canReuse = Boolean(STATE_FILE) && fs.existsSync(STATE_FILE);
  let browser = await chromium.launch({ headless: canReuse });
  let context = await browser.newContext(canReuse ? { storageState: STATE_FILE } : {});
  let page = await context.newPage();

  try {
    console.log('[*] Connecting to Jira...');

    const me = canReuse ? await hasValidSession(page, JIRA_URL) : null;
    if (me) {
      console.log(`[+] Reusing saved session for ${me.displayName}`);
    } else {
      if (canReuse) {
        console.log('[-] Saved session is no longer valid; logging in interactively');
        await browser.close();
        browser = await chromium.launch({ headless: false });
        context = await browser.newContext();
        page = await context.newPage();
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

    // 2. REST API calls with the authenticated session
    let seedIssues;
    if (issueKey) {
      console.log(`[*] Fetching ${issueKey}...`);
      try {
        seedIssues = [await fetchIssue(page, JIRA_URL, issueKey, ISSUE_FIELDS)];
      } catch (error) {
        const status = error.status ? ` (${error.status})` : '';
        throw new Error(`Could not fetch ${issueKey}${status} - check the key and that you have access`);
      }
    } else {
      seedIssues = await searchIssues(page, JIRA_URL, ISSUE_FIELDS);
      console.log(`[+] Found ${seedIssues.length} assigned issues`);
    }

    // 3. Fetch all parent issues recursively
    const allIssues = await fetchAllParentIssues(seedIssues, page, JIRA_URL, ISSUE_FIELDS);
    console.log(`[+] Total issues with parents: ${allIssues.length}`);

    // 4. Generate markdown
    await generateMarkdown(allIssues, page);

    console.log(`[+] Exported to: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('[-] Error:', error);
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
  const usage = 'Usage: node export-issues.js [ISSUE-KEY | issue URL]';

  if (args.length > 1) {
    console.error(`[-] Expected at most one issue key or URL.\n${usage}`);
    process.exitCode = 1;
  } else if (args.length === 1) {
    const issueKey = parseIssueRef(args[0]);
    if (issueKey) {
      exportJiraIssues({ issueKey });
    } else {
      console.error(`[-] Not a Jira issue key or URL: ${args[0]}\n${usage}`);
      process.exitCode = 1;
    }
  } else {
    exportJiraIssues();
  }
}

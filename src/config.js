require('dotenv').config();

const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
const JQL = process.env.JIRA_JQL || 'assignee = currentUser()';

// Download attachments referenced by issues into <issue dir>/attachments/.
const DOWNLOAD_ATTACHMENTS = process.env.JIRA_DOWNLOAD_ATTACHMENTS === '1';
const MAX_ATTACHMENT_MB = Number(process.env.JIRA_MAX_ATTACHMENT_MB || 25);

// Path to Playwright storageState JSON. Set JIRA_STATE_FILE= (empty) to disable.
const STATE_FILE = process.env.JIRA_STATE_FILE === undefined
  ? '.jira-session.json'
  : process.env.JIRA_STATE_FILE;

// The Jira fields every REST call requests. Adding one here is only half the
// job: `generateIssueMd` in src/render.js decides what reaches the Markdown,
// and `generatePath` / `downloadAttachments` depend on `issuetype`, `parent`
// and `attachment` being present.
const ISSUE_FIELDS = [
      'summary',
      'description',
      'status',
      'priority',
      'assignee',
      'created',
      'updated',
      'issuetype',
      'issuelinks',
      'components',
      'labels',
      'resolution',
      'comment',
      'parent',
      'attachment'
    ].join(',');

module.exports = {
  JIRA_URL,
  OUTPUT_DIR,
  JQL,
  DOWNLOAD_ATTACHMENTS,
  MAX_ATTACHMENT_MB,
  STATE_FILE,
  ISSUE_FIELDS,
};

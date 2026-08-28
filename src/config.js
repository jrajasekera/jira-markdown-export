require('dotenv').config();

const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
const JQL = process.env.JIRA_JQL || 'assignee = currentUser()';

// Download attachments referenced by issues into <issue dir>/attachments/.
const DOWNLOAD_ATTACHMENTS = process.env.JIRA_DOWNLOAD_ATTACHMENTS === '1';
const MAX_ATTACHMENT_MB = Number(process.env.JIRA_MAX_ATTACHMENT_MB || 25);

// Environment numbers arrive as strings and get mistyped. A bad JIRA_MAX_RETRIES
// must not reach the retry loop as NaN or a negative, so anything outside the
// allowed integer range falls back loudly to the default. Takes the raw value
// rather than reading process.env itself, which keeps it unit-testable.
function intFromEnv(name, raw, fallback, { min, max }) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.warn(`[-] Ignoring ${name}=${raw}: expected an integer ${min}-${max}; using ${fallback}`);
    return fallback;
  }
  return value;
}

// Retries attempted *after* the first request when Jira rate-limits us, so the
// default of 4 means up to 5 requests. 0 disables retrying entirely.
const MAX_RETRIES = intFromEnv('JIRA_MAX_RETRIES', process.env.JIRA_MAX_RETRIES, 4, { min: 0, max: 10 });

// Path to Playwright storageState JSON. Set JIRA_STATE_FILE= (empty) to disable.
const STATE_FILE = process.env.JIRA_STATE_FILE === undefined
  ? '.jira-session.json'
  : process.env.JIRA_STATE_FILE;

// Jira assigns custom-field IDs per instance. Overrides are useful when an
// administrator has renamed a field, or when more than one custom field has
// the same display name. Empty values opt into automatic discovery.
function customFieldOverride(name, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';
  const id = customFieldId(raw);
  if (!id) {
    console.warn(`[-] Ignoring ${name}=${raw}: expected customfield_<number>; using automatic discovery`);
    return '';
  }
  return id;
}

const CUSTOM_FIELD_OVERRIDES = Object.freeze({
  sprint: customFieldOverride('JIRA_SPRINT_FIELD_ID', process.env.JIRA_SPRINT_FIELD_ID),
  storyPoints: customFieldOverride('JIRA_STORY_POINTS_FIELD_ID', process.env.JIRA_STORY_POINTS_FIELD_ID),
  epicLink: customFieldOverride('JIRA_EPIC_LINK_FIELD_ID', process.env.JIRA_EPIC_LINK_FIELD_ID),
});

// The Jira fields every REST call requests. Adding one here is only half the
// job: `generateIssueMd` in src/render.js decides what reaches the Markdown,
// and `generatePath` / `downloadAttachments` depend on `issuetype`, `parent`
// and `attachment` being present.
const BASE_ISSUE_FIELDS = Object.freeze([
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
  'fixVersions',
  'resolution',
  'comment',
  'parent',
  'attachment',
]);

function customFieldId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^customfield_\d+$/.test(id) ? id : undefined;
}

// `fields` must be the same for JQL search and ancestor fetches. Build it
// after discovery so every issue has the custom values render needs.
function buildIssueFields(customFields = {}) {
  const fieldIds = Object.values(customFields).map(customFieldId).filter(Boolean);
  return [...new Set([...BASE_ISSUE_FIELDS, ...fieldIds])].join(',');
}

const ISSUE_FIELDS = buildIssueFields(CUSTOM_FIELD_OVERRIDES);

module.exports = {
  JIRA_URL,
  OUTPUT_DIR,
  JQL,
  DOWNLOAD_ATTACHMENTS,
  MAX_ATTACHMENT_MB,
  MAX_RETRIES,
  intFromEnv,
  STATE_FILE,
  CUSTOM_FIELD_OVERRIDES,
  BASE_ISSUE_FIELDS,
  customFieldId,
  customFieldOverride,
  buildIssueFields,
  ISSUE_FIELDS,
};

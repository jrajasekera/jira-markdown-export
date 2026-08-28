const { descriptionToMd } = require('./adf.js');
const { infoFilename } = require('./naming.js');

function linkText(text) {
  return String(text).replace(/[\\[\]]/g, '\\$&').replace(/\s*\n\s*/g, ' ');
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// JSON strings are valid YAML double-quoted scalars. This handles quotes,
// backslashes, newlines, control characters, and YAML-looking strings without
// requiring a serializer dependency just for this fixed metadata schema.
function yamlScalar(value) {
  if (value === undefined || value === null || value === '') return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function yamlArray(values) {
  if (!values.length) return '[]';
  return `\n${values.map(value => `  - ${yamlScalar(value)}`).join('\n')}`;
}

function displayName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return value.name || value.value || value.key || null;
  return value;
}

function displayNames(values) {
  return (Array.isArray(values) ? values : []).map(displayName).filter(Boolean);
}

function sprintName(value) {
  if (value && typeof value === 'object') return value.name || value.value || null;
  const raw = displayName(value);
  // Older Jira responses serialize sprint objects into a Java-esque string.
  const legacyName = raw?.match(/(?:^|,)name=([^,\]]+)/);
  return legacyName ? legacyName[1] : raw;
}

function fieldValues(fields, fieldId, formatter = displayName) {
  if (!fieldId || fields[fieldId] === undefined || fields[fieldId] === null) return [];
  const raw = Array.isArray(fields[fieldId]) ? fields[fieldId] : [fields[fieldId]];
  return raw.map(formatter).filter(value => value !== null && value !== undefined && value !== '');
}

function issueUrl(jiraUrl, key) {
  return jiraUrl ? `${jiraUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}` : null;
}

function issueFrontmatter(issue, jiraUrl, customFields = {}) {
  const { key, fields } = issue;
  const sprint = fieldValues(fields, customFields.sprint, sprintName);
  const storyPoints = fieldValues(fields, customFields.storyPoints)[0] ?? null;
  const epicLink = fieldValues(fields, customFields.epicLink)[0] ?? null;
  const fixVersions = displayNames(fields.fixVersions);
  const metadata = [
    ['key', key],
    ['type', fields.issuetype?.name],
    ['status', fields.status?.name],
    ['priority', fields.priority?.name],
    ['assignee', fields.assignee?.displayName],
    ['labels', displayNames(fields.labels)],
    ['components', displayNames(fields.components)],
    ['parent', fields.parent?.key],
    ['created', dateOnly(fields.created)],
    ['updated', dateOnly(fields.updated)],
    ['jira_url', issueUrl(jiraUrl, key)],
    ['sprint', sprint],
    ['epic_link', epicLink],
    ['story_points', storyPoints],
    ['fix_versions', fixVersions],
  ];

  return `---\n${metadata.map(([name, value]) =>
    Array.isArray(value) ? `${name}:${yamlArray(value)}` : `${name}: ${yamlScalar(value)}`
  ).join('\n')}\n---\n\n`;
}

function renderIssueLink(link, linkTo) {
  const target = link.outwardIssue || link.inwardIssue;
  if (!target?.key) return null;
  const verb = (link.outwardIssue ? link.type?.outward : link.type?.inward)
    || link.type?.name || 'relates to';
  const summary = target.fields?.summary;
  const label = linkText(summary ? `${target.key} – ${summary}` : target.key);
  const href = linkTo(target.key);
  return `- ${verb} ${href ? `[${label}](${href})` : label}`;
}

function renderCustomMetadata(fields, customFields) {
  const lines = [];
  const sprint = fieldValues(fields, customFields.sprint, sprintName);
  const epicLink = fieldValues(fields, customFields.epicLink)[0];
  const storyPoints = fieldValues(fields, customFields.storyPoints)[0];
  const fixVersions = displayNames(fields.fixVersions);

  if (sprint.length) lines.push(`- **Sprint:** ${sprint.join(', ')}`);
  if (epicLink !== undefined) lines.push(`- **Epic Link:** ${epicLink}`);
  if (storyPoints !== undefined) lines.push(`- **Story Points:** ${storyPoints}`);
  if (fixVersions.length) lines.push(`- **Fix Versions:** ${fixVersions.join(', ')}`);
  return lines;
}

function sortComments(comments) {
  return comments.map((comment, index) => ({ comment, index, time: new Date(comment.created).getTime() }))
    .sort((a, b) => {
      const aValid = !Number.isNaN(a.time);
      const bValid = !Number.isNaN(b.time);
      if (aValid && bValid && a.time !== b.time) return a.time - b.time;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ comment }) => comment);
}

function generateIssueMd(issue, parentIssue, isFile, linkTo = () => undefined, options = {}) {
  const { key, fields } = issue;
  const {
    summary,
    description,
    status,
    priority,
    assignee,
    created,
    updated,
    issuelinks = [],
    comment = {},
    parent,
  } = fields;
  const customFields = options.customFields || {};

  const issueType = fields.issuetype?.name || 'N/A';
  let parentInfo = '';
  if (parent && parentIssue) {
    const href = infoFilename(parentIssue.fields.issuetype?.name);
    parentInfo = `\n**Parent:** [${linkText(`${parent.key} - ${parentIssue.fields.summary}`)}](${isFile ? href : `../${href}`})`;
  } else if (parent) {
    parentInfo = `\n**Parent:** ${parent.key}`;
  }

  const relatedIssues = issuelinks.map(l => renderIssueLink(l, linkTo)).filter(Boolean);
  const customMetadata = renderCustomMetadata(fields, customFields);
  const createdDay = dateOnly(created) || 'N/A';
  const updatedDay = dateOnly(updated) || 'N/A';

  let content = `${issueFrontmatter(issue, options.jiraUrl, customFields)}# ${key} - ${summary}

**Type:** ${issueType} | **Status:** ${status?.name || 'N/A'} | **Priority:** ${priority?.name || 'N/A'}
**Assignee:** ${assignee?.displayName || 'Unassigned'} | **Created:** ${createdDay}${parentInfo}

## Description
${description?.content ? descriptionToMd(description.content) : 'No description'}

## Metadata
- **Updated:** ${updatedDay}${customMetadata.length ? `\n${customMetadata.join('\n')}` : ''}
${relatedIssues.length > 0 ? `\n## Related Issues\n${relatedIssues.join('\n')}` : ''}`;

  if (comment.comments && comment.comments.length > 0) {
    content += '\n\n## Comments\n\n';
    for (const c of sortComments(comment.comments)) {
      const author = linkText(c.author?.displayName || 'Unknown');
      const timestamp = dateOnly(c.created) || 'Unknown date';
      const body = c.body?.content ? descriptionToMd(c.body.content) : c.body || '';
      content += `### ${author} — ${timestamp}\n\n${body}\n\n`;
    }
  }

  return content;
}

module.exports = {
  dateOnly,
  issueFrontmatter,
  generateIssueMd,
};

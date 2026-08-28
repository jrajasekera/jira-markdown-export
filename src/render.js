const { descriptionToMd } = require('./adf.js');
const { infoFilename } = require('./naming.js');

// Jira summaries are free text; keep them from breaking link syntax.
function linkText(text) {
  return String(text).replace(/[\\[\]]/g, '\\$&').replace(/\s*\n\s*/g, ' ');
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

function generateIssueMd(issue, parentIssue, isFile, linkTo = () => undefined) {
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

  const issueType = fields.issuetype?.name || 'N/A';
  // A leaf file sits beside its parent's info file; a folder issue's info file
  // sits one level below it.
  let parentInfo = '';
  if (parent && parentIssue) {
    const href = infoFilename(parentIssue.fields.issuetype?.name);
    parentInfo = `\n**Parent:** [${linkText(`${parent.key} - ${parentIssue.fields.summary}`)}](${isFile ? href : `../${href}`})`;
  } else if (parent) {
    // Parent was not exported, so there is nothing to link to.
    parentInfo = `\n**Parent:** ${parent.key}`;
  }

  const relatedIssues = issuelinks.map(l => renderIssueLink(l, linkTo)).filter(Boolean);

  let content = `# ${key} - ${summary}

**Type:** ${issueType} | **Status:** ${status?.name || 'N/A'} | **Priority:** ${priority?.name || 'N/A'}
**Assignee:** ${assignee?.displayName || 'Unassigned'} | **Created:** ${new Date(created).toISOString().split('T')[0]}${parentInfo}

## Description
${description?.content ? descriptionToMd(description.content) : 'No description'}

## Metadata
- **Updated:** ${new Date(updated).toISOString().split('T')[0]}
${relatedIssues.length > 0 ? `\n## Related Issues\n${relatedIssues.join('\n')}` : ''}`;

  // Add comments if available
  if (comment.comments && comment.comments.length > 0) {
    content += '\n\n## Comments\n\n';
    comment.comments.forEach((c, index) => {
      const author = c.author?.displayName || 'Unknown';
      const timestamp = new Date(c.created).toISOString().split('T')[0];
      const body = c.body?.content ? descriptionToMd(c.body.content) : c.body || '';

      content += `### Comment ${index + 1}\n`;
      content += `**Author:** ${author} | **Date:** ${timestamp}\n\n`;
      content += `${body}\n\n`;
    });
  }

  return content;
}

module.exports = {
  generateIssueMd,
};

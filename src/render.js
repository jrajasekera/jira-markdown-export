const { descriptionToMd } = require('./adf.js');
const { infoFilename } = require('./naming.js');

function generateIssueMd(issue, parentIssue, isFile) {
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
    parentInfo = `\n**Parent:** [${parent.key} - ${parentIssue.fields.summary}](${isFile ? href : `../${href}`})`;
  } else if (parent) {
    // Parent was not exported, so there is nothing to link to.
    parentInfo = `\n**Parent:** ${parent.key}`;
  }

  let content = `# ${key} - ${summary}

**Type:** ${issueType} | **Status:** ${status?.name || 'N/A'} | **Priority:** ${priority?.name || 'N/A'}
**Assignee:** ${assignee?.displayName || 'Unassigned'} | **Created:** ${new Date(created).toISOString().split('T')[0]}${parentInfo}

## Description
${description?.content ? descriptionToMd(description.content) : 'No description'}

## Metadata
- **Updated:** ${new Date(updated).toISOString().split('T')[0]}
${issuelinks.length > 0 ? `\n## Related Issues\n${issuelinks.map(l => `- ${l.outwardIssue?.key || l.inwardIssue?.key}: ${l.type?.name}`).join('\n')}` : ''}`;

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

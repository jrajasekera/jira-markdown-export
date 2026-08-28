const fs = require('fs');
const path = require('path');
const { sanitizeDir, sanitizeFilename, infoFilename } = require('./naming.js');
const { generateIssueMd } = require('./render.js');

// Path of an issue's Markdown file, relative to the output root.
function indexHref(issue, allIssuesMap) {
  if (generatePath(issue, allIssuesMap).isFile) {
    return `${sanitizeFilename(issue.key, issue.fields.summary)}.md`;
  }
  const type = issue.fields.issuetype?.name || 'Unknown';
  return `${issue.key}-${sanitizeDir(issue.fields.summary)}/${infoFilename(type)}`;
}

function renderIndex(issues, rootIssues, allIssuesMap) {
  return `# Jira Issues Export

**Export date:** ${new Date().toISOString().split('T')[0]}

## Total issues: ${issues.length}

## Root Issues (without parent)

${rootIssues.map(issue => {
  const type = issue.fields.issuetype?.name || 'Unknown';
  return `- [${type}: ${issue.key} - ${issue.fields.summary}](${indexHref(issue, allIssuesMap)})`;
}).join('\n')}
`;
}

function isSubtask(issue) {
  const issuetype = issue.fields.issuetype;
  if (typeof issuetype?.subtask === 'boolean') {
    return issuetype.subtask;
  }
  // Fallback for payloads that omit the flag
  return issuetype?.name?.toLowerCase() === 'sub-task';
}

function generatePath(issue, allIssuesMap) {
  const path = [];
  let current = issue;

  // Build path from current issue to root
  while (current) {
    path.unshift({
      key: current.key,
      type: current.fields.issuetype?.name || 'Unknown',
      summary: current.fields.summary
    });
    current = allIssuesMap[current.fields.parent?.key];
  }

  // Check if the last item (current issue) is a subtask
  const isFile = isSubtask(issue);

  return { path, isFile };
}

function generateIssueFiles(issue, pathInfo, baseDir, allIssuesMap, writes = null) {
  const { path: pathChain, isFile } = pathInfo;

  // Build directory path
  let currentDir = baseDir;

  // Create folders for all but the last item (if last is a file)
  const folderCount = isFile ? pathChain.length - 1 : pathChain.length;

  for (let i = 0; i < folderCount; i++) {
    const pathItem = pathChain[i];
    const folderName = `${pathItem.key}-${sanitizeDir(pathItem.summary)}`;
    currentDir = path.join(currentDir, folderName);

    if (!fs.existsSync(currentDir)) {
      fs.mkdirSync(currentDir, { recursive: true });
    }

    // Write info file (_epic.md, _story.md, _task.md)
    if (i === folderCount - 1 || (isFile && i === pathChain.length - 2)) {
      const issueData = allIssuesMap[pathItem.key];
      if (issueData) {
        const parentIssue = allIssuesMap[issueData.fields.parent?.key];
        const filePath = path.join(currentDir, infoFilename(pathItem.type));
        fs.writeFileSync(filePath, generateIssueMd(issueData, parentIssue, false));
        recordWrite(writes, issueData, filePath, currentDir);
      }
    }
  }

  // If current issue is a file (subtask), write it
  if (isFile) {
    const filename = sanitizeFilename(issue.key, issue.fields.summary) + '.md';
    const parentIssue = allIssuesMap[issue.fields.parent?.key];
    const filePath = path.join(currentDir, filename);
    fs.writeFileSync(filePath, generateIssueMd(issue, parentIssue, true));
    recordWrite(writes, issue, filePath, currentDir);
  }

  // Find and generate child issues
  const children = Object.values(allIssuesMap).filter(
    child => child.fields.parent?.key === issue.key
  );

  children.forEach(child => {
    const childPathInfo = generatePath(child, allIssuesMap);
    generateIssueFiles(child, childPathInfo, baseDir, allIssuesMap, writes);
  });
}

// generateIssueFiles walks a chain, so the same folder issue is written once per
// descendant. Record each issue file only the first time it is written.
function recordWrite(writes, issue, filePath, dir) {
  if (!writes) return;
  if (writes.some(w => w.filePath === filePath)) return;
  writes.push({ issue, filePath, dir });
}

module.exports = {
  isSubtask,
  generatePath,
  generateIssueFiles,
  renderIndex,
};

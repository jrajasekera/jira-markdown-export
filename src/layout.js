const fs = require('fs');
const path = require('path');
const { sanitizeDir, sanitizeFilename, infoFilename } = require('./naming.js');
const { generateIssueMd } = require('./render.js');

// POSIX path of an issue's Markdown file, relative to the export root.
// Filesystem writes use the platform-native `path`; this is for links only.
function issueHref(issue, allIssuesMap) {
  const { path: chain, isFile } = generatePath(issue, allIssuesMap);
  const folders = (isFile ? chain.slice(0, -1) : chain)
    .map(item => `${item.key}-${sanitizeDir(item.summary)}`);
  const last = chain[chain.length - 1];
  const file = isFile
    ? `${sanitizeFilename(last.key, last.summary)}.md`
    : infoFilename(last.type);
  return [...folders, file].join('/');
}

// Resolves an issue key to a link relative to `fromIssue`'s file, or
// undefined when the target is not part of the export.
function linkResolver(fromIssue, allIssuesMap) {
  const fromDir = path.posix.dirname(issueHref(fromIssue, allIssuesMap));
  return key => {
    const target = allIssuesMap[key];
    if (!target) return undefined;
    return path.posix.relative(fromDir, issueHref(target, allIssuesMap));
  };
}

function renderIndex(issues, rootIssues, allIssuesMap) {
  return `# Jira Issues Export

**Export date:** ${new Date().toISOString().split('T')[0]}

## Total issues: ${issues.length}

## Root Issues (without parent)

${rootIssues.map(issue => {
  const type = issue.fields.issuetype?.name || 'Unknown';
  return `- [${type}: ${issue.key} - ${issue.fields.summary}](${issueHref(issue, allIssuesMap)})`;
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

function generateIssueFiles(issue, pathInfo, baseDir, allIssuesMap, writes = null, renderOptions = {}) {
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
        fs.writeFileSync(filePath, generateIssueMd(issueData, parentIssue, false, linkResolver(issueData, allIssuesMap), renderOptions));
        recordWrite(writes, issueData, filePath, currentDir);
      }
    }
  }

  // If current issue is a file (subtask), write it
  if (isFile) {
    const filename = sanitizeFilename(issue.key, issue.fields.summary) + '.md';
    const parentIssue = allIssuesMap[issue.fields.parent?.key];
    const filePath = path.join(currentDir, filename);
    fs.writeFileSync(filePath, generateIssueMd(issue, parentIssue, true, linkResolver(issue, allIssuesMap), renderOptions));
    recordWrite(writes, issue, filePath, currentDir);
  }

  // Find and generate child issues
  const children = Object.values(allIssuesMap).filter(
    child => child.fields.parent?.key === issue.key
  );

  children.forEach(child => {
    const childPathInfo = generatePath(child, allIssuesMap);
    generateIssueFiles(child, childPathInfo, baseDir, allIssuesMap, writes, renderOptions);
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
  issueHref,
  isSubtask,
  generatePath,
  generateIssueFiles,
  renderIndex,
};

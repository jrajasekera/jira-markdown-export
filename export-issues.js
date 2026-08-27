const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const JIRA_URL = process.env.JIRA_URL || 'https://your-instance.atlassian.net';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-issues';
const JQL = process.env.JIRA_JQL || 'assignee = currentUser()';

async function exportJiraIssues() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[*] Connecting to Jira...');

    // 1. Open Jira (uses existing SSO session)
    await page.goto(JIRA_URL);

    // Wait for login to complete - interactive mode
    console.log('[!] Browser window opened. Log in to Jira, then press ENTER here...');
    await waitForUserInput();

    console.log('[*] Fetching issues...');

    // 2. REST API call with authenticated session
    const fields = [
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
      'parent'
    ].join(',');

    const searchIssuesResult = await searchIssues(page, JIRA_URL, fields);
    console.log(`[+] Found ${searchIssuesResult.length} assigned issues`);

    // 3. Fetch all parent issues recursively
    const allIssues = await fetchAllParentIssues(searchIssuesResult, page, JIRA_URL, fields);
    console.log(`[+] Total issues with parents: ${allIssues.length}`);

    // 4. Generate markdown
    await generateMarkdown(allIssues);

    console.log(`[+] Exported to: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('[-] Error:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

function prepareOutputDir(dir) {
  const resolved = path.resolve(dir);
  const forbidden = [
    path.parse(resolved).root,          // filesystem root
    os.homedir(),
    process.cwd(),
    __dirname,                          // the repo checkout
  ].map(p => path.resolve(p));

  if (forbidden.includes(resolved)) {
    throw new Error(`Refusing to clear ${resolved}: it is not a dedicated export directory`);
  }

  console.log(`[*] Clearing ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

async function generateMarkdown(issues) {
  prepareOutputDir(OUTPUT_DIR);

  // Build issues map for quick lookup
  const allIssuesMap = {};
  issues.forEach(issue => {
    allIssuesMap[issue.key] = issue;
  });

  // Root issues: no parent, or a parent that could not be fetched
  const rootIssues = issues.filter(issue => {
    const parentKey = issue.fields.parent?.key;
    if (!parentKey) return true;
    if (allIssuesMap[parentKey]) return false;
    console.log(`[-] Parent ${parentKey} of ${issue.key} not available; exporting ${issue.key} at top level`);
    return true;
  });

  console.log(`[*] Processing ${rootIssues.length} root issues...`);

  // Generate files for each root issue and its children
  rootIssues.forEach(rootIssue => {
    const pathInfo = generatePath(rootIssue, allIssuesMap);
    generateIssueFiles(rootIssue, pathInfo, OUTPUT_DIR, allIssuesMap);
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.md'), renderIndex(issues, rootIssues, allIssuesMap));
}

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

function generateIssueFiles(issue, pathInfo, baseDir, allIssuesMap) {
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
        fs.writeFileSync(
          path.join(currentDir, infoFilename(pathItem.type)),
          generateIssueMd(issueData, parentIssue, false)
        );
      }
    }
  }

  // If current issue is a file (subtask), write it
  if (isFile) {
    const filename = sanitizeFilename(issue.key, issue.fields.summary) + '.md';
    const parentIssue = allIssuesMap[issue.fields.parent?.key];
    fs.writeFileSync(path.join(currentDir, filename), generateIssueMd(issue, parentIssue, true));
  }

  // Find and generate child issues
  const children = Object.values(allIssuesMap).filter(
    child => child.fields.parent?.key === issue.key
  );

  children.forEach(child => {
    const childPathInfo = generatePath(child, allIssuesMap);
    generateIssueFiles(child, childPathInfo, baseDir, allIssuesMap);
  });
}

function sanitizeFilename(key, summary) {
  const sanitized = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${key}-${sanitized}`;
}

// Info file written inside a folder issue's directory (_epic.md, _story.md, ...)
function infoFilename(typeName) {
  return `_${(typeName || 'unknown').toLowerCase().replace('-', '')}.md`;
}

function sanitizeDir(summary) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function descriptionToMd(content) {
  // Convert Jira ADF (Atlassian Document Format) to Markdown
  if (!content) return 'No description';

  return content
    .map(block => {
      switch (block.type) {
        case 'paragraph':
          return processParagraph(block.content);

        case 'heading':
          const level = block.attrs?.level || 1;
          const headingText = processContent(block.content);
          return `${'#'.repeat(level)} ${headingText}`;

        case 'bulletList':
          return block.content
            ?.map(item => `- ${processListItem(item)}`)
            .join('\n') || '';

        case 'orderedList':
          return block.content
            ?.map((item, i) => `${i + 1}. ${processListItem(item, ' '.repeat(String(i + 1).length + 2))}`)
            .join('\n') || '';

        case 'codeBlock':
          const lang = block.attrs?.language || '';
          const code = block.content?.map(c => c.text || '').join('') || '';
          return `\`\`\`${lang}\n${code}\n\`\`\``;

        case 'blockquote':
          const quoteText = block.content?.map(b => processParagraph(b.content)).join('\n\n') || '';
          return quoteText.split('\n').map(line => `> ${line}`).join('\n');

        case 'rule':
          return '---';

        case 'panel': {
          const panelLabels = {
            info: 'Info',
            note: 'Note',
            warning: 'Warning',
            error: 'Error',
            success: 'Success',
          };
          const label = panelLabels[block.attrs?.panelType] || 'Note';
          const body = descriptionToMd(block.content || []);
          const quoted = body ? body.split('\n').map(line => `> ${line}`).join('\n') : '';
          return quoted ? `> **${label}:**\n${quoted}` : `> **${label}:**`;
        }

        case 'taskList':
          return block.content
            ?.filter(item => item.type === 'taskItem')
            .map(item => `${item.attrs?.state === 'DONE' ? '- [x] ' : '- [ ] '}${processContent(item.content)}`)
            .join('\n') || '';

        case 'expand':
        case 'nestedExpand': {
          const title = block.attrs?.title || 'Details';
          const body = descriptionToMd(block.content || []);
          return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
        }

        case 'table':
          return processTable(block);

        case 'mediaSingle':
        case 'mediaGroup':
          return block.content
            ?.filter(child => child.type === 'media')
            .map(child => processMedia(child))
            .join('\n') || '';

        default:
          return `<!-- unsupported ADF block: ${block.type} -->`;
      }
    })
    .filter(line => line)
    .join('\n\n');
}

function processMedia(node) {
  const attrs = node.attrs || {};
  if (attrs.type === 'external') {
    return `![image](${attrs.url || ''})`;
  }
  return `![${attrs.alt || 'attachment'}](attachment:${attrs.id || ''})`;
}

function processTable(block) {
  const rows = (block.content || []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return '';

  const cellText = cell =>
    descriptionToMd(cell.content || [])
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|');

  const grid = rows.map(row => (row.content || []).map(cellText));
  const columns = grid.reduce((max, cells) => Math.max(max, cells.length), 0);
  if (columns === 0) return '';

  const line = cells => {
    const padded = [...cells];
    while (padded.length < columns) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };

  const [header, ...body] = grid;
  const separator = `| ${Array(columns).fill('---').join(' | ')} |`;
  return [line(header), separator, ...body.map(line)].join('\n');
}

function indentBlock(text, prefix = '  ') {
  return text.split('\n').map(line => (line ? prefix + line : line)).join('\n');
}

// `prefix` is the indent of the item's content column, which depends on the
// marker width: two spaces for `- `, more for `10. `.
function processListItem(item, prefix = '  ') {
  if (item.type !== 'listItem' || !item.content || item.content.length === 0) return '';

  const [first, ...rest] = item.content;
  const head = first?.type === 'paragraph'
    ? processContent(first.content)
    // A non-paragraph first block may be multi-line (a code fence, a table);
    // every line but the first needs the item indent to stay inside the item.
    : indentBlock(descriptionToMd([first]), prefix).trimStart();
  if (rest.length === 0) return head;
  return `${head}\n${indentBlock(descriptionToMd(rest), prefix)}`;
}

function processContent(content) {
  if (!content) return '';

  return content
    .map(node => processNode(node))
    .join('');
}

function processParagraph(content) {
  return processContent(content);
}

function processNode(node) {
  if (!node) return '';

  switch (node.type) {
    case 'text':
      let text = node.text || '';

      // Apply marks (bold, italic, code, etc). Link is applied last so the
      // link wraps the formatted text: [**bold**](url).
      const marks = node.marks || [];
      const linkMark = marks.find(mark => mark.type === 'link');

      marks.forEach(mark => {
        switch (mark.type) {
          case 'strong':
            text = `**${text}**`;
            break;
          case 'em':
            text = `*${text}*`;
            break;
          case 'code':
            text = `\`${text}\``;
            break;
          case 'strike':
            text = `~~${text}~~`;
            break;
          case 'underline':
            text = `<u>${text}</u>`;
            break;
          case 'subsup':
            text = mark.attrs?.type === 'sup' ? `<sup>${text}</sup>` : `<sub>${text}</sub>`;
            break;
          case 'textColor':
            // Markdown has no colour; render the text unchanged.
            break;
        }
      });

      if (linkMark) {
        text = `[${text}](${linkMark.attrs?.href || ''})`;
      }

      return text;

    case 'hardBreak':
      return '\n';

    case 'inlineCard':
      const url = node.attrs?.url || '';
      return `[${url}](${url})`;

    case 'mention':
      const name = node.attrs?.text || 'Unknown';
      return `@${name}`;

    case 'emoji':
      return node.attrs?.shortName || '';

    case 'date': {
      const timestamp = Number(node.attrs?.timestamp);
      if (!Number.isFinite(timestamp)) return '';
      return new Date(timestamp).toISOString().split('T')[0];
    }

    case 'status':
      return `[${node.attrs?.text || ''}]`;

    case 'inlineExtension':
    case 'placeholder':
      return '';

    default:
      return '';
  }
}

async function searchIssues(page, jiraUrl, fieldsString, jql = JQL) {
  const issues = [];
  let nextPageToken;

  do {
    const params = new URLSearchParams({
      jql,
      maxResults: String(100),
      fields: fieldsString,
    });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const url = `${jiraUrl}/rest/api/3/search/jql?${params.toString()}`;
    const response = await page.request.get(
      url,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!response.ok()) {
      throw new Error(`API error: ${response.status()}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.issues)) {
      throw new Error(`Unexpected search response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    issues.push(...data.issues);
    console.log(`[*] Fetched ${issues.length} issues so far`);

    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);

  return issues;
}

async function fetchAllParentIssues(issues, page, jiraUrl, fieldsString) {
  const processedKeys = new Set();
  const allIssuesMap = new Map();

  // Add initial assigned issues
  issues.forEach(issue => {
    processedKeys.add(issue.key);
    allIssuesMap.set(issue.key, issue);
  });

  // Queue for BFS traversal
  const queue = [...issues];

  while (queue.length > 0) {
    const currentIssue = queue.shift();
    const parentKey = currentIssue.fields.parent?.key;

    // If has parent and we haven't processed it yet
    if (parentKey && !processedKeys.has(parentKey)) {
      console.log(`[*] Fetching parent: ${parentKey}`);

      try {
        const parentParams = new URLSearchParams({ fields: fieldsString });
        const parentUrl = `${jiraUrl}/rest/api/3/issue/${encodeURIComponent(parentKey)}?${parentParams.toString()}`;
        const parentResponse = await page.request.get(
          parentUrl,
          {
            headers: {
              'Accept': 'application/json',
            }
          }
        );

        if (parentResponse.ok()) {
          const parentIssue = await parentResponse.json();
          processedKeys.add(parentKey);
          allIssuesMap.set(parentKey, parentIssue);
          queue.push(parentIssue);
          console.log(`[+] Fetched: ${parentKey}`);
        } else {
          console.log(`[-] Failed to fetch ${parentKey}: ${parentResponse.status()}`);
        }
      } catch (error) {
        console.log(`[-] Error fetching ${parentKey}: ${error.message}`);
      }
    }
  }

  return Array.from(allIssuesMap.values());
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
  prepareOutputDir,
  descriptionToMd,
  processNode,
  processContent,
  processListItem,
  sanitizeFilename,
  sanitizeDir,
  isSubtask,
  generatePath,
  generateIssueFiles,
  generateIssueMd,
  generateMarkdown,
  infoFilename,
  renderIndex,
  searchIssues,
  fetchAllParentIssues,
};

// Run the export only when invoked directly (`node export-issues.js`),
// not when required by tests.
if (require.main === module) {
  exportJiraIssues();
}

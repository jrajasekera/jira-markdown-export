const fs = require('fs');
const os = require('os');
const path = require('path');
const { OUTPUT_DIR, DOWNLOAD_ATTACHMENTS, MAX_ATTACHMENT_MB } = require('./config.js');
const { generatePath, generateIssueFiles, renderIndex } = require('./layout.js');
const { downloadAttachments } = require('./attachments.js');

function prepareOutputDir(dir) {
  const resolved = path.resolve(dir);
  const forbidden = [
    path.parse(resolved).root,          // filesystem root
    os.homedir(),
    process.cwd(),
    path.resolve(__dirname, '..'),      // the repo checkout
  ].map(p => path.resolve(p));

  if (forbidden.includes(resolved)) {
    throw new Error(`Refusing to clear ${resolved}: it is not a dedicated export directory`);
  }

  console.log(`[*] Clearing ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

async function generateMarkdown(issues, client) {
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

  // Generate files for each root issue and its children. Every write is
  // recorded so attachments can be resolved afterwards; generateIssueFiles
  // itself stays synchronous.
  const writes = [];
  rootIssues.forEach(rootIssue => {
    const pathInfo = generatePath(rootIssue, allIssuesMap);
    generateIssueFiles(rootIssue, pathInfo, OUTPUT_DIR, allIssuesMap, writes);
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.md'), renderIndex(issues, rootIssues, allIssuesMap));

  // Inline media is resolved either way: with DOWNLOAD_ATTACHMENTS off, only
  // the attachments a Markdown file actually references are fetched.
  if (client) {
    await downloadAttachments(writes, client, MAX_ATTACHMENT_MB, {
      downloadAll: DOWNLOAD_ATTACHMENTS,
    });
  }
}

module.exports = {
  prepareOutputDir,
  generateMarkdown,
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The module reads OUTPUT_DIR at load time, so it must be set before the
// require below. This file is kept separate so the override cannot leak into
// the other test files.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-outdir-'));
process.env.OUTPUT_DIR = outputDir;

const { generateMarkdown } = require('../export-issues.js');

const issue = (key, typeName, summary, parentKey) => ({
  key,
  fields: {
    summary,
    issuetype: { name: typeName },
    status: { name: 'To Do' },
    priority: { name: 'Medium' },
    assignee: { displayName: 'Ada' },
    created: '2026-01-02T03:04:05.000+0000',
    updated: '2026-01-03T03:04:05.000+0000',
    description: null,
    issuelinks: [],
    comment: { comments: [] },
    ...(parentKey ? { parent: { key: parentKey } } : {}),
  },
});

test('generateMarkdown exports issues whose parent could not be fetched', async (t) => {
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const orphan = issue('ORPH-2', 'Task', 'Orphan task', 'GONE-1');
  const child = issue('ORPH-3', 'Sub-task', 'Orphan child', 'ORPH-2');

  await generateMarkdown([orphan, child]);

  assert.ok(fs.existsSync(path.join(outputDir, 'ORPH-2-orphan-task/_task.md')));
  assert.ok(fs.existsSync(path.join(outputDir, 'ORPH-2-orphan-task/ORPH-3-orphan-child.md')));

  const index = fs.readFileSync(path.join(outputDir, 'index.md'), 'utf8');
  assert.ok(index.includes('ORPH-2'));
  assert.ok(!index.includes('GONE-1'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeFilename,
  sanitizeDir,
  generatePath,
  generateIssueFiles,
  generateIssueMd,
} = require('../export-issues.js');

const text = (t) => ({ type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', content });

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

const epic = issue('PRJ-1', 'Epic', 'Big Epic!');
const story = issue('PRJ-2', 'Story', 'A story', 'PRJ-1');
const sub = issue('PRJ-3', 'Sub-task', 'Do thing', 'PRJ-2');
const map = { 'PRJ-1': epic, 'PRJ-2': story, 'PRJ-3': sub };

test('sanitizeDir slugifies summaries', () => {
  assert.equal(sanitizeDir('  Hello, World! '), 'hello-world');
  assert.equal(sanitizeDir('---x---'), 'x');
  // non-ASCII letters are stripped by [^a-z0-9]+
  assert.equal(sanitizeDir('Ünïcode ñ'), 'n-code');
});

test('sanitizeFilename prefixes the issue key', () => {
  assert.equal(sanitizeFilename('PRJ-3', 'Do thing'), 'PRJ-3-do-thing');
});

test('generatePath walks the parent chain root-first', () => {
  const subPath = generatePath(sub, map);
  assert.deepEqual(subPath.path.map(p => p.key), ['PRJ-1', 'PRJ-2', 'PRJ-3']);
  assert.equal(subPath.isFile, true);

  const storyPath = generatePath(story, map);
  assert.deepEqual(storyPath.path.map(p => p.key), ['PRJ-1', 'PRJ-2']);
  assert.equal(storyPath.isFile, false);
});

// characterization: fixed in plan 004 (subtask detection uses the name, not issuetype.subtask)
test('issuetype named "Subtask" with subtask:true is currently not treated as a file', () => {
  const odd = {
    key: 'PRJ-9',
    fields: { summary: 'Odd', issuetype: { name: 'Subtask', subtask: true } },
  };
  assert.equal(generatePath(odd, { 'PRJ-9': odd }).isFile, false);
});

test('generateIssueFiles lays out folders, info files and subtask files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  try {
    generateIssueFiles(epic, generatePath(epic, map), tmpDir, map);

    const expected = [
      'PRJ-1-big-epic/_epic.md',
      'PRJ-1-big-epic/PRJ-2-a-story/_story.md',
      'PRJ-1-big-epic/PRJ-2-a-story/PRJ-3-do-thing.md',
    ];
    for (const rel of expected) {
      assert.ok(fs.existsSync(path.join(tmpDir, rel)), `missing ${rel}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateIssueMd renders the issue header and metadata', () => {
  const md = generateIssueMd(sub);
  assert.equal(md.split('\n')[0], '# PRJ-3 - Do thing');
  assert.ok(md.includes('**Type:** Sub-task | **Status:** To Do | **Priority:** Medium'));
  assert.ok(md.includes('**Created:** 2026-01-02'));
  assert.ok(md.includes('No description'));
  // characterization: fixed in plan 005 (parent link points at ../PRJ-2, but the
  // folder is actually named PRJ-2-a-story)
  assert.ok(md.includes('**Parent:** [PRJ-2](../PRJ-2)'));
});

test('generateIssueMd renders comments', () => {
  const withComment = issue('PRJ-4', 'Task', 'Has comment');
  withComment.fields.comment = {
    comments: [{
      author: { displayName: 'Bob' },
      created: '2026-02-01T00:00:00.000+0000',
      body: { content: [para(text('hi'))] },
    }],
  };
  const md = generateIssueMd(withComment);
  assert.ok(md.includes('### Comment 1'));
  assert.ok(md.includes('**Author:** Bob | **Date:** 2026-02-01'));
  assert.ok(md.includes('hi'));
});

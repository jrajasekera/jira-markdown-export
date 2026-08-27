const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeFilename,
  sanitizeDir,
  isSubtask,
  generatePath,
  generateIssueFiles,
  generateIssueMd,
  searchIssues,
} = require('../export-issues.js');

const text = (t) => ({ type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', content });

const issue = (key, typeName, summary, parentKey) => ({
  key,
  fields: {
    summary,
    issuetype: { name: typeName, subtask: typeName.toLowerCase() === 'sub-task' },
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

test('issuetype named "Subtask" with subtask:true is treated as a file', () => {
  const odd = {
    key: 'PRJ-9',
    fields: { summary: 'Odd', issuetype: { name: 'Subtask', subtask: true } },
  };
  assert.equal(generatePath(odd, { 'PRJ-9': odd }).isFile, true);
});

test('isSubtask prefers the issuetype.subtask flag over the type name', () => {
  const withType = (issuetype) => ({ key: 'PRJ-9', fields: { summary: 'x', issuetype } });

  assert.equal(isSubtask(withType({ name: 'Sub-task', subtask: true })), true);
  assert.equal(isSubtask(withType({ name: 'Subtask', subtask: true })), true);
  assert.equal(isSubtask(withType({ name: 'Bug fix subtask', subtask: true })), true);
  assert.equal(isSubtask(withType({ name: 'Task', subtask: false })), false);
  // fallback when the flag is absent
  assert.equal(isSubtask(withType({ name: 'Sub-task' })), true);
  assert.equal(isSubtask(withType({ name: 'Subtask' })), false);
  assert.equal(isSubtask(withType(undefined)), false);
});

test('generateIssueFiles writes a flag-only subtask as a leaf file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  try {
    const parent = issue('PRJ-10', 'Task', 'Parent task');
    const child = {
      key: 'PRJ-11',
      fields: {
        ...issue('PRJ-11', 'Task', 'Child bit', 'PRJ-10').fields,
        issuetype: { name: 'Subtask', subtask: true },
      },
    };
    const flagMap = { 'PRJ-10': parent, 'PRJ-11': child };

    generateIssueFiles(parent, generatePath(parent, flagMap), tmpDir, flagMap);

    assert.ok(fs.existsSync(path.join(tmpDir, 'PRJ-10-parent-task/PRJ-11-child-bit.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'PRJ-10-parent-task/PRJ-11-child-bit')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

// --- searchIssues pagination ---

const fakeSearchPage = (responder) => {
  const urls = [];
  return {
    urls,
    request: {
      get: async (url) => {
        urls.push(url);
        return responder(url);
      },
    },
  };
};

const ok = (payload) => ({
  ok: () => true,
  status: () => 200,
  json: async () => payload,
});

test('searchIssues follows nextPageToken across pages', async () => {
  const a = { key: 'A-1', fields: { summary: 'a' } };
  const b = { key: 'B-1', fields: { summary: 'b' } };
  const page = fakeSearchPage((url) =>
    url.includes('nextPageToken=')
      ? ok({ issues: [b], isLast: true })
      : ok({ issues: [a], isLast: false, nextPageToken: 'tok1' })
  );

  const issues = await searchIssues(page, 'https://x.atlassian.net', 'summary');

  assert.deepEqual(issues.map(i => i.key), ['A-1', 'B-1']);
  assert.equal(page.urls.length, 2);
  assert.ok(page.urls[1].includes('nextPageToken=tok1'));
});

test('searchIssues stops after a single last page', async () => {
  const page = fakeSearchPage(() => ok({ issues: [{ key: 'A-1', fields: { summary: 'a' } }], isLast: true }));

  const issues = await searchIssues(page, 'https://x.atlassian.net', 'summary');

  assert.equal(issues.length, 1);
  assert.equal(page.urls.length, 1);
  assert.ok(!page.urls[0].includes('nextPageToken='));
});

test('searchIssues throws on a non-OK response', async () => {
  const page = fakeSearchPage(() => ({
    ok: () => false,
    status: () => 401,
    json: async () => ({}),
  }));

  await assert.rejects(
    () => searchIssues(page, 'https://x.atlassian.net', 'summary'),
    /401/
  );
});

test('searchIssues throws when the response has no issues array', async () => {
  const page = fakeSearchPage(() => ok({ errorMessages: ['bad jql'] }));

  await assert.rejects(
    () => searchIssues(page, 'https://x.atlassian.net', 'summary'),
    /Unexpected search response/
  );
});

// --- orphaned issues (parent could not be fetched) ---

test('generateIssueFiles exports an orphan subtree without its missing parent', () => {
  const orphan = issue('ORPH-2', 'Task', 'Orphan task', 'GONE-1');
  const child = issue('ORPH-3', 'Sub-task', 'Orphan child', 'ORPH-2');
  const orphanMap = { 'ORPH-2': orphan, 'ORPH-3': child };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-orphan-'));
  try {
    generateIssueFiles(orphan, generatePath(orphan, orphanMap), tmpDir, orphanMap);

    assert.ok(fs.existsSync(path.join(tmpDir, 'ORPH-2-orphan-task/_task.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'ORPH-2-orphan-task/ORPH-3-orphan-child.md')));
    assert.ok(!fs.readdirSync(tmpDir).some(name => name.startsWith('GONE-1')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

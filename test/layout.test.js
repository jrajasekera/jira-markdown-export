const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeFilename, sanitizeDir } = require('../src/naming.js');
const {
  issueHref,
  isSubtask,
  generatePath,
  generateIssueFiles,
  renderIndex,
} = require('../src/layout.js');
const { generateIssueMd } = require('../src/render.js');
const { searchIssues } = require('../src/jira-client.js');

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

test('issues with colliding sanitized summaries get deterministic key-prefixed paths', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-collisions-'));
  try {
    const root = issue('PRJ-20', 'Epic', 'Collision root');
    const first = issue('PRJ-21', 'Story', 'Same summary!', 'PRJ-20');
    const second = issue('PRJ-22', 'Story', 'Same summary?', 'PRJ-20');
    const firstLeaf = issue('PRJ-23', 'Sub-task', 'Same leaf!', 'PRJ-21');
    const secondLeaf = issue('PRJ-24', 'Sub-task', 'Same leaf?', 'PRJ-21');
    const collisionMap = Object.fromEntries(
      [root, first, second, firstLeaf, secondLeaf].map(item => [item.key, item])
    );

    generateIssueFiles(root, generatePath(root, collisionMap), tmpDir, collisionMap);

    const rootDir = path.join(tmpDir, 'PRJ-20-collision-root');
    assert.ok(fs.existsSync(path.join(rootDir, 'PRJ-21-same-summary/_story.md')));
    assert.ok(fs.existsSync(path.join(rootDir, 'PRJ-22-same-summary/_story.md')));
    assert.ok(fs.existsSync(path.join(rootDir, 'PRJ-21-same-summary/PRJ-23-same-leaf.md')));
    assert.ok(fs.existsSync(path.join(rootDir, 'PRJ-21-same-summary/PRJ-24-same-leaf.md')));

    assert.notEqual(issueHref(first, collisionMap), issueHref(second, collisionMap));
    assert.notEqual(issueHref(firstLeaf, collisionMap), issueHref(secondLeaf, collisionMap));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateIssueMd renders the issue header and metadata', () => {
  const md = generateIssueMd(sub, story, true);
  assert.ok(md.startsWith('---\nkey: "PRJ-3"'));
  assert.ok(md.includes('# PRJ-3 - Do thing'));
  assert.ok(md.includes('**Type:** Sub-task | **Status:** To Do | **Priority:** Medium'));
  assert.ok(md.includes('**Created:** 2026-01-02'));
  assert.ok(md.includes('No description'));
  assert.ok(md.includes('**Parent:** [PRJ-2 - A story](_story.md)'));
});

test('generateIssueMd renders parent link for a leaf file', () => {
  const md = generateIssueMd(sub, story, true);
  assert.ok(md.includes('**Parent:** [PRJ-2 - A story](_story.md)'));
});

test('generateIssueMd renders parent link for a folder issue', () => {
  const md = generateIssueMd(story, epic, false);
  assert.ok(md.includes('**Parent:** [PRJ-1 - Big Epic!](../_epic.md)'));
});

test('generateIssueMd omits link when parent is not exported', () => {
  const md = generateIssueMd(story, undefined, false);
  assert.ok(md.includes('**Parent:** PRJ-1'));
  assert.ok(!md.includes(']('));
});

test('renderIndex links root issues by their real folder and file names', () => {
  const rootSub = issue('PRJ-9', 'Sub-task', 'Loose end');
  const indexMap = { ...map, 'PRJ-9': rootSub };
  const md = renderIndex(Object.values(indexMap), [epic, rootSub], indexMap);

  assert.ok(md.includes('- [Epic: PRJ-1 - Big Epic!](PRJ-1-big-epic/_epic.md)'));
  assert.ok(md.includes('- [Sub-task: PRJ-9 - Loose end](PRJ-9-loose-end.md)'));
});

const mdFilesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return mdFilesIn(full);
  return entry.name.endsWith('.md') ? [full] : [];
});

test('all generated relative links resolve to existing files', () => {
  const rootSub = issue('PRJ-9', 'Sub-task', 'Loose end');
  const blocks = { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' } };
  const linkedStory = { ...story, fields: { ...story.fields, issuelinks: [
    { ...blocks, outwardIssue: { key: 'PRJ-9', fields: { summary: 'Loose end' } } },
  ] } };
  const linkedSub = { ...sub, fields: { ...sub.fields, issuelinks: [
    { ...blocks, inwardIssue: { key: 'PRJ-1', fields: { summary: 'Big Epic!' } } },
  ] } };
  const linkedRootSub = { ...rootSub, fields: { ...rootSub.fields, issuelinks: [
    { ...blocks, inwardIssue: { key: 'PRJ-3', fields: { summary: 'Do thing' } } },
  ] } };
  const linkMap = { ...map, 'PRJ-2': linkedStory, 'PRJ-3': linkedSub, 'PRJ-9': linkedRootSub };
  const roots = [epic, linkedRootSub];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-links-'));
  try {
    roots.forEach(root => generateIssueFiles(root, generatePath(root, linkMap), tmpDir, linkMap));
    fs.writeFileSync(
      path.join(tmpDir, 'index.md'),
      renderIndex(Object.values(linkMap), roots, linkMap)
    );

    let checked = 0;
    for (const file of mdFilesIn(tmpDir)) {
      for (const [, href] of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:/.test(href)) continue;
        const resolved = path.resolve(path.dirname(file), href);
        assert.ok(fs.existsSync(resolved), `${file} -> ${href}`);
        checked++;
      }
    }
    assert.ok(checked >= 6, `expected at least 6 links, checked ${checked}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  const md = generateIssueMd(withComment, undefined, false);
  assert.ok(md.includes('### Bob — 2026-02-01'));
  assert.ok(!md.includes('Comment 1'));
  assert.ok(md.includes('hi'));
});

test('generateIssueMd emits escaped frontmatter and custom Jira fields', () => {
  const detailed = issue('PRJ-4', 'Story', 'Detail');
  detailed.fields.labels = ['needs: review', 'line\nbreak', '"quoted"'];
  detailed.fields.components = [{ name: 'Core: API' }];
  detailed.fields.fixVersions = [{ name: 'v1.0' }, { name: 'v2 "beta"' }];
  detailed.fields.customfield_1 = ['com.atlassian.greenhopper.service.sprint.Sprint@1[id=1,name=June Sprint,state=ACTIVE]'];
  detailed.fields.customfield_2 = 3;
  detailed.fields.customfield_3 = 'PRJ-1';

  const md = generateIssueMd(detailed, undefined, false, undefined, {
    jiraUrl: 'https://example.atlassian.net/',
    customFields: { sprint: 'customfield_1', storyPoints: 'customfield_2', epicLink: 'customfield_3' },
  });
  assert.match(md, /^---\nkey: "PRJ-4"/);
  assert.match(md, /labels:\n  - "needs: review"\n  - "line\\nbreak"\n  - "\\"quoted\\""/);
  assert.match(md, /components:\n  - "Core: API"/);
  assert.match(md, /jira_url: "https:\/\/example.atlassian.net\/browse\/PRJ-4"/);
  assert.match(md, /sprint:\n  - "June Sprint"/);
  assert.match(md, /epic_link: "PRJ-1"/);
  assert.match(md, /story_points: 3/);
  assert.match(md, /fix_versions:\n  - "v1.0"\n  - "v2 \\"beta\\""/);
  assert.match(md, /- \*\*Sprint:\*\* June Sprint/);
  assert.match(md, /- \*\*Epic Link:\*\* PRJ-1/);
  assert.match(md, /- \*\*Story Points:\*\* 3/);
  assert.match(md, /- \*\*Fix Versions:\*\* v1.0, v2 "beta"/);
});

test('generateIssueMd sorts comments chronologically before rendering headings', () => {
  const threaded = issue('PRJ-5', 'Task', 'Thread');
  threaded.fields.comment = {
    comments: [
      { author: { displayName: 'Later' }, created: '2026-03-02T00:00:00.000+0000', body: 'second' },
      { author: { displayName: 'Earlier' }, created: '2026-03-01T00:00:00.000+0000', body: 'first' },
    ],
  };
  const md = generateIssueMd(threaded, undefined, false);
  assert.ok(md.indexOf('### Earlier — 2026-03-01') < md.indexOf('### Later — 2026-03-02'));
});

// --- searchIssues pagination ---

const fakeSearchClient = (responder) => {
  const urls = [];
  return {
    urls,
    get: async (url) => {
      urls.push(url);
      return responder(url);
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
  const client = fakeSearchClient((url) =>
    url.includes('nextPageToken=')
      ? ok({ issues: [b], isLast: true })
      : ok({ issues: [a], isLast: false, nextPageToken: 'tok1' })
  );

  const issues = await searchIssues(client, 'https://x.atlassian.net', 'summary');

  assert.deepEqual(issues.map(i => i.key), ['A-1', 'B-1']);
  assert.equal(client.urls.length, 2);
  assert.ok(client.urls[1].includes('nextPageToken=tok1'));
});

test('searchIssues encodes the default JQL, maxResults, and fields', async () => {
  const client = fakeSearchClient(() => ok({ issues: [], isLast: true }));

  await searchIssues(client, 'https://x.atlassian.net', 'summary,description');

  const url = client.urls[0];
  assert.ok(url.includes('/rest/api/3/search/jql?'), url);
  assert.ok(url.includes('jql=assignee+%3D+currentUser%28%29'), url);
  assert.ok(url.includes('maxResults='), url);
  assert.ok(url.includes('fields=summary%2Cdescription'), url);
});

test('searchIssues encodes a custom JQL passed as an argument', async () => {
  const client = fakeSearchClient(() => ok({ issues: [], isLast: true }));

  await searchIssues(
    client,
    'https://x.atlassian.net',
    'summary',
    'project = "My Proj" AND updated >= -7d'
  );

  const url = client.urls[0];
  assert.ok(
    url.includes('jql=project+%3D+%22My+Proj%22+AND+updated+%3E%3D+-7d'),
    url
  );
});

test('searchIssues stops after a single last page', async () => {
  const client = fakeSearchClient(() => ok({ issues: [{ key: 'A-1', fields: { summary: 'a' } }], isLast: true }));

  const issues = await searchIssues(client, 'https://x.atlassian.net', 'summary');

  assert.equal(issues.length, 1);
  assert.equal(client.urls.length, 1);
  assert.ok(!client.urls[0].includes('nextPageToken='));
});

test('searchIssues throws on a non-OK response', async () => {
  const client = fakeSearchClient(() => ({
    ok: () => false,
    status: () => 401,
    json: async () => ({}),
  }));

  await assert.rejects(
    () => searchIssues(client, 'https://x.atlassian.net', 'summary'),
    /401/
  );
});

test('searchIssues throws when the response has no issues array', async () => {
  const client = fakeSearchClient(() => ok({ errorMessages: ['bad jql'] }));

  await assert.rejects(
    () => searchIssues(client, 'https://x.atlassian.net', 'summary'),
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

test('issueHref returns the root-relative POSIX path of an issue file', () => {
  assert.equal(issueHref(epic, map), 'PRJ-1-big-epic/_epic.md');
  assert.equal(issueHref(story, map), 'PRJ-1-big-epic/PRJ-2-a-story/_story.md');
  assert.equal(issueHref(sub, map), 'PRJ-1-big-epic/PRJ-2-a-story/PRJ-3-do-thing.md');
});

const blocksType = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const withLinks = (base, issuelinks) => ({ ...base, fields: { ...base.fields, issuelinks } });

test('generateIssueMd renders link direction, summary, and relative link', () => {
  const linked = withLinks(story, [
    { type: blocksType, outwardIssue: { key: 'PRJ-3', fields: { summary: 'Do thing' } } },
    { type: blocksType, inwardIssue: { key: 'PRJ-1', fields: { summary: 'Big Epic!' } } },
  ]);
  const linkTo = key => ({ 'PRJ-3': 'PRJ-3-do-thing.md', 'PRJ-1': '../_epic.md' })[key];
  const md = generateIssueMd(linked, epic, false, linkTo);
  assert.match(md, /## Related Issues\n- blocks \[PRJ-3 – Do thing\]\(PRJ-3-do-thing.md\)\n- is blocked by \[PRJ-1 – Big Epic!\]\(\.\.\/_epic\.md\)/);
});

test('generateIssueMd renders unexported link targets as plain text', () => {
  const linked = withLinks(story, [
    { type: blocksType, outwardIssue: { key: 'OTHER-1', fields: { summary: 'Elsewhere' } } },
  ]);
  const md = generateIssueMd(linked, undefined, false);
  assert.match(md, /- blocks OTHER-1 – Elsewhere$/);
  assert.doesNotMatch(md, /OTHER-1[^\n]*\]\(/);
});

test('generateIssueMd tolerates malformed issue links', () => {
  const linked = withLinks(story, [
    { type: { name: 'Relates' }, outwardIssue: { key: 'X-1', fields: { summary: 'No verbs' } } },
    { outwardIssue: { key: 'X-2' } },
    { type: blocksType },
    { type: blocksType, inwardIssue: { key: 'X-3', fields: { summary: 'A [weird] one\nwith newline' } } },
  ]);
  const md = generateIssueMd(linked, undefined, false);
  assert.match(md, /- Relates X-1 – No verbs\n/m);
  assert.match(md, /- relates to X-2\n/);
  assert.match(md, /- is blocked by X-3 – A \\\[weird\\\] one with newline/);
  assert.doesNotMatch(md, /undefined/);
  assert.equal((md.match(/^- /gm) || []).length, 4);
});

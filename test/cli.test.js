const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  parseIssueRef,
  parseExportArgs,
  refreshSessionCommand,
  describeIssueFetchError,
} = require('../src/cli.js');

const SCRIPT = path.join(__dirname, '..', 'export-issues.js');

const accepted = [
  ['ABC-123', 'ABC-123'],
  ['abc-123', 'ABC-123'],
  ['  ABC-123\n', 'ABC-123'],
  ['PRJ_X-7', 'PRJ_X-7'],
  ['https://x.atlassian.net/browse/ABC-123', 'ABC-123'],
  ['https://x.atlassian.net/browse/abc-123', 'ABC-123'],
  ['https://x.atlassian.net/browse/ABC-123?filter=1#comment-9', 'ABC-123'],
  ['https://x.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-123', 'ABC-123'],
  ['https://x.atlassian.net/jira/software/boards/1?issueKey=ABC-123', 'ABC-123'],
];

for (const [input, expected] of accepted) {
  test(`parseIssueRef accepts ${JSON.stringify(input)}`, () => {
    assert.equal(parseIssueRef(input), expected);
  });
}

const rejected = [
  '',
  '   ',
  'not-a-key',
  'ABC-',
  '-123',
  '123-ABC',
  'ht!tp://[bad url',
  // A key-shaped value on an unrelated URL must not be mistaken for a reference.
  'https://example.com/?next=ABC-123',
  'https://x.atlassian.net/jira/software/projects/ABC/boards/1',
  undefined,
  null,
  42,
];

for (const input of rejected) {
  test(`parseIssueRef rejects ${JSON.stringify(input)}`, () => {
    assert.equal(parseIssueRef(input), null);
  });
}

// The CLI must reject bad input before launching a browser or touching OUTPUT_DIR.
function runCli(args) {
  const outputDir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-cli-')),
    'exported-issues',
  );
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OUTPUT_DIR: outputDir, JIRA_STATE_FILE: '' },
  });
  return { ...result, outputDir };
}

test('an unparseable reference exits 1 without touching the output directory', () => {
  const { status, stderr, outputDir } = runCli(['not-a-key']);

  assert.equal(status, 1);
  assert.match(stderr, /Not a Jira issue key or URL: not-a-key/);
  assert.match(stderr, /Usage: node export-issues\.js/);
  assert.equal(fs.existsSync(outputDir), false);
});

test('an invalid reference among multiple references exits 1 without touching the output directory', () => {
  const { status, stderr, outputDir } = runCli(['ABC-1', 'not-a-key', 'PRJ-2']);

  assert.equal(status, 1);
  assert.match(stderr, /Not a Jira issue key or URL: not-a-key/);
  assert.equal(fs.existsSync(outputDir), false);
});

test('multiple references are normalized and de-duplicated', () => {
  assert.deepEqual(parseExportArgs([
    'abc-1',
    'https://x.atlassian.net/browse/ABC-1',
    'PRJ-2',
  ]), {
    issueKeys: ['ABC-1', 'PRJ-2'],
    jql: undefined,
    refreshSession: false,
  });
});

test('a JQL export scope is parsed without issue keys', () => {
  assert.deepEqual(parseExportArgs(['--jql', 'project = ABC AND status = Open']), {
    issueKeys: [],
    jql: 'project = ABC AND status = Open',
    refreshSession: false,
  });
});

test('--refresh-session preserves an issue-key export scope', () => {
  assert.deepEqual(parseExportArgs(['--refresh-session', 'abc-1']), {
    issueKeys: ['ABC-1'],
    jql: undefined,
    refreshSession: true,
  });
});

test('--refresh-session preserves a JQL export scope', () => {
  assert.deepEqual(parseExportArgs(['--jql', 'project = ABC', '--refresh-session']), {
    issueKeys: [],
    jql: 'project = ABC',
    refreshSession: true,
  });
});

test('refreshSessionCommand produces a copy-pasteable issue command', () => {
  assert.equal(
    refreshSessionCommand({ issueKeys: ['ABC-1', 'PRJ-2'] }),
    'npm run export -- --refresh-session ABC-1 PRJ-2',
  );
});

test('refreshSessionCommand safely quotes JQL', () => {
  assert.equal(
    refreshSessionCommand({ jql: "project = ABC AND status = 'In Progress'" }),
    `npm run export -- --refresh-session --jql 'project = ABC AND status = '"'"'In Progress'"'"''`,
  );
});

test('a missing --jql value exits 1 without touching the output directory', () => {
  const { status, stderr, outputDir } = runCli(['--jql']);

  assert.equal(status, 1);
  assert.match(stderr, /Missing JQL value after --jql/);
  assert.match(stderr, /Usage: node export-issues\.js/);
  assert.equal(fs.existsSync(outputDir), false);
});

test('mixing --jql with a reference exits 1 without touching the output directory', () => {
  const { status, stderr, outputDir } = runCli(['ABC-1', '--jql', 'project = ABC']);

  assert.equal(status, 1);
  assert.match(stderr, /Cannot combine --jql with issue keys or URLs/);
  assert.match(stderr, /Usage: node export-issues\.js/);
  assert.equal(fs.existsSync(outputDir), false);
});

test('describeIssueFetchError rewrites an ordinary refusal into advice', () => {
  const error = Object.assign(new Error('Failed to fetch ABC-1: 404'), { status: 404 });

  const described = describeIssueFetchError(error, 'ABC-1');

  assert.match(described.message, /Could not fetch ABC-1 \(404\)/);
  assert.match(described.message, /check the key and that you have access/);
});

test('describeIssueFetchError passes a rate-limit error through untouched', () => {
  const error = Object.assign(new Error('Jira rate-limited this export'), {
    status: 429,
    rateLimited: true,
  });

  // "Check the key" is the wrong advice for a throttle - the key is fine.
  const described = describeIssueFetchError(error, 'ABC-1');

  assert.equal(described, error);
  assert.doesNotMatch(described.message, /check the key/);
});

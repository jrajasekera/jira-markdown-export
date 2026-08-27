const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseIssueRef } = require('../export-issues.js');

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

test('more than one argument exits 1 without touching the output directory', () => {
  const { status, stderr, outputDir } = runCli(['ABC-1', 'ABC-2']);

  assert.equal(status, 1);
  assert.match(stderr, /Expected at most one issue key or URL/);
  assert.match(stderr, /Usage: node export-issues\.js/);
  assert.equal(fs.existsSync(outputDir), false);
});

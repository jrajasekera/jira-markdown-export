const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOutputDir } = require('../export-issues.js');

test('prepareOutputDir refuses dangerous targets', () => {
  for (const dir of [os.homedir(), process.cwd(), path.parse(process.cwd()).root]) {
    assert.throws(() => prepareOutputDir(dir), /Refusing to clear/);
  }
});

test('prepareOutputDir removes stale files and recreates the dir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  const target = path.join(base, 'out');
  fs.mkdirSync(path.join(target, 'OLD-1-stale'), { recursive: true });
  fs.writeFileSync(path.join(target, 'OLD-1-stale', '_task.md'), 'x');

  prepareOutputDir(target);

  assert.ok(fs.existsSync(target));
  assert.deepEqual(fs.readdirSync(target), []);
});

test('prepareOutputDir creates a missing dir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-export-'));
  const target = path.join(base, 'fresh');
  prepareOutputDir(target);
  assert.ok(fs.statSync(target).isDirectory());
});

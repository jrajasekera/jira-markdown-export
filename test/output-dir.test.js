const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOutputDir } = require('../src/pipeline.js');

test('prepareOutputDir refuses dangerous targets', () => {
  for (const dir of [os.homedir(), process.cwd(), path.parse(process.cwd()).root]) {
    assert.throws(() => prepareOutputDir(dir), /Refusing to clear/);
  }
});

// process.cwd() is the repo root under `npm test`, so the case above cannot tell
// the cwd rule from the checkout rule -- it would still pass if the checkout
// guard were dropped. Pin the checkout rule from a different cwd.
//
// fs.rmSync and fs.mkdirSync are stubbed first, and deliberately so: if the
// guard ever regresses, this test must fail loudly rather than recursively
// delete the checkout it is defending. Never call prepareOutputDir on a path
// you are not willing to lose without these stubs in place.
test('prepareOutputDir refuses the repo checkout regardless of cwd', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const cwd = process.cwd();
  const { rmSync, mkdirSync } = fs;
  const boom = () => { throw new Error('guard regressed: prepareOutputDir tried to clear the checkout'); };
  fs.rmSync = boom;
  fs.mkdirSync = boom;
  process.chdir(os.tmpdir());
  try {
    assert.throws(() => prepareOutputDir(repoRoot), /Refusing to clear/);
  } finally {
    process.chdir(cwd);
    fs.rmSync = rmSync;
    fs.mkdirSync = mkdirSync;
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

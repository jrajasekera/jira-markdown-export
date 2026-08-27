const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  attachmentFilename,
  attachmentKeys,
  rewriteAttachmentLinks,
  downloadAttachments,
} = require('../export-issues.js');

const UUID = '6a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

test('attachmentFilename prefixes the REST id and sanitizes the stem', () => {
  assert.equal(
    attachmentFilename({ id: '10042', filename: 'My Shot (1).PNG' }),
    '10042-my-shot-1.png'
  );
  assert.equal(attachmentFilename({ id: '7', filename: 'notes' }), '7-notes');
  assert.equal(attachmentFilename({ id: '7' }), '7-file');
});

test('attachmentKeys collects the id, the filename, and any UUID-shaped field', () => {
  const keys = attachmentKeys({
    id: '10042',
    filename: 'shot.png',
    mediaApiFileId: UUID,
    content: 'https://example.atlassian.net/rest/api/3/attachment/content/10042',
  });
  assert.deepEqual(keys.sort(), ['10042', UUID, 'shot.png'].sort());
});

test('attachmentKeys drops the filename when it is ambiguous', () => {
  const keys = attachmentKeys({ id: '1', filename: 'shot.png' }, { skipFilename: true });
  assert.deepEqual(keys, ['1']);
});

test('rewriteAttachmentLinks replaces known keys and leaves the rest alone', () => {
  assert.equal(
    rewriteAttachmentLinks(
      '![a](attachment:x) ![b](attachment:y)',
      new Map([['x', 'attachments/1.png']])
    ),
    '![a](attachments/1.png) ![b](attachment:y)'
  );
});

test('rewriteAttachmentLinks falls back to the link text as a key', () => {
  assert.equal(
    rewriteAttachmentLinks(
      `![shot.png](attachment:${UUID})`,
      new Map([['shot.png', 'attachments/10042-shot.png']])
    ),
    '![shot.png](attachments/10042-shot.png)'
  );
});

test('downloadAttachments honours the size limit and rewrites the issue file', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const small = {
    id: '1',
    filename: 'small.png',
    size: 1024,
    mediaApiFileId: UUID,
    content: 'https://jira.example/rest/api/3/attachment/content/1',
  };
  const big = {
    id: '2',
    filename: 'big.zip',
    size: 50 * 1024 * 1024,
    content: 'https://jira.example/rest/api/3/attachment/content/2',
  };

  const filePath = path.join(tmpDir, 'PROJ-1-thing.md');
  fs.writeFileSync(
    filePath,
    `# PROJ-1\n\n![small.png](attachment:${UUID})\n\n![big.zip](attachment:missing)\n`
  );

  const requested = [];
  const page = {
    request: {
      get: async (url) => {
        requested.push(url);
        return { ok: () => true, status: () => 200, body: async () => Buffer.from('png') };
      },
    },
  };

  const stats = await downloadAttachments(
    [{ issue: { key: 'PROJ-1', fields: { attachment: [small, big] } }, filePath, dir: tmpDir }],
    page,
    25
  );

  assert.deepEqual(stats, { downloaded: 1, skipped: 1, failed: 0 });
  assert.deepEqual(requested, [small.content]);
  assert.ok(fs.existsSync(path.join(tmpDir, 'attachments', '1-small.png')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'attachments', '2-big.zip')));

  const md = fs.readFileSync(filePath, 'utf8');
  assert.match(md, /!\[small\.png\]\(attachments\/1-small\.png\)/);
  assert.match(md, /!\[big\.zip\]\(attachment:missing\)/);
  assert.match(md, /## Attachments\n\n- \[small\.png\]\(attachments\/1-small\.png\)/);
});

test('downloadAttachments logs and skips a failed request without throwing', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const filePath = path.join(tmpDir, 'PROJ-2-thing.md');
  fs.writeFileSync(filePath, '# PROJ-2\n\n![a.png](attachment:x)\n');

  const page = {
    request: { get: async () => ({ ok: () => false, status: () => 403 }) },
  };

  const stats = await downloadAttachments(
    [{
      issue: {
        key: 'PROJ-2',
        fields: { attachment: [{ id: '1', filename: 'a.png', size: 10, content: 'https://jira.example/c/1' }] },
      },
      filePath,
      dir: tmpDir,
    }],
    page,
    25
  );

  assert.deepEqual(stats, { downloaded: 0, skipped: 0, failed: 1 });
  assert.equal(fs.readFileSync(filePath, 'utf8'), '# PROJ-2\n\n![a.png](attachment:x)\n');
});

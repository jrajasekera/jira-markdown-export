const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  attachmentFilename,
  attachmentKeys,
  collectPlaceholderKeys,
  rewriteAttachmentLinks,
  downloadAttachments,
} = require('../src/attachments.js');

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
  const client = {
    get: async (url) => {
      requested.push(url);
      return { ok: () => true, status: () => 200, body: async () => Buffer.from('png') };
    },
  };

  const stats = await downloadAttachments(
    [{ issue: { key: 'PROJ-1', fields: { attachment: [small, big] } }, filePath, dir: tmpDir }],
    client,
    25
  );

  assert.deepEqual(stats, { downloaded: 1, skipped: 1, failed: 0, rateLimited: 0 });
  assert.deepEqual(requested, [small.content]);
  assert.ok(fs.existsSync(path.join(tmpDir, 'attachments', '1-small.png')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'attachments', '2-big.zip')));

  const md = fs.readFileSync(filePath, 'utf8');
  assert.match(md, /!\[small\.png\]\(attachments\/1-small\.png\)/);
  // Skipped for size, so its placeholder falls back to the Jira URL.
  assert.match(md, /!\[big\.zip\]\(https:\/\/jira\.example\/rest\/api\/3\/attachment\/content\/2\)/);
  assert.match(md, /## Attachments\n\n- \[small\.png\]\(attachments\/1-small\.png\)/);
});

test('downloadAttachments logs a failed request without throwing and falls back to Jira', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const filePath = path.join(tmpDir, 'PROJ-2-thing.md');
  fs.writeFileSync(filePath, '# PROJ-2\n\n![a.png](attachment:x)\n');

  const client = {
    get: async () => ({ ok: () => false, status: () => 403 }),
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
    client,
    25
  );

  assert.deepEqual(stats, { downloaded: 0, skipped: 0, failed: 1, rateLimited: 0 });
  assert.equal(
    fs.readFileSync(filePath, 'utf8'),
    '# PROJ-2\n\n![a.png](https://jira.example/c/1)\n'
  );
});

test('collectPlaceholderKeys returns both the placeholder key and the link text', () => {
  const keys = collectPlaceholderKeys(
    `![shot.png](attachment:${UUID})\n[notes](attachment:10042)\n![](attachment:bare)`
  );
  assert.deepEqual([...keys].sort(), [UUID, '10042', 'bare', 'notes', 'shot.png'].sort());
});

test('downloadAttachments fetches only referenced media when downloadAll is off', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const inline = {
    id: '1',
    filename: 'inline.png',
    size: 1024,
    mediaApiFileId: UUID,
    content: 'https://jira.example/rest/api/3/attachment/content/1',
  };
  const unreferenced = {
    id: '2',
    filename: 'spec.pdf',
    size: 2048,
    content: 'https://jira.example/rest/api/3/attachment/content/2',
  };

  const filePath = path.join(tmpDir, 'PROJ-3-thing.md');
  fs.writeFileSync(filePath, `# PROJ-3\n\n![attachment](attachment:${UUID})\n`);

  const requested = [];
  const client = {
    get: async (url) => {
      requested.push(url);
      return { ok: () => true, status: () => 200, body: async () => Buffer.from('png') };
    },
  };

  const stats = await downloadAttachments(
    [{
      issue: { key: 'PROJ-3', fields: { attachment: [inline, unreferenced] } },
      filePath,
      dir: tmpDir,
    }],
    client,
    25,
    { downloadAll: false }
  );

  assert.deepEqual(stats, { downloaded: 1, skipped: 0, failed: 0, rateLimited: 0 });
  assert.deepEqual(requested, [inline.content]);
  assert.ok(fs.existsSync(path.join(tmpDir, 'attachments', '1-inline.png')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'attachments', '2-spec.pdf')));

  const md = fs.readFileSync(filePath, 'utf8');
  assert.match(md, /!\[attachment\]\(attachments\/1-inline\.png\)/);
  // The whole-issue list belongs to the full attachment export, not to this mode.
  assert.doesNotMatch(md, /## Attachments/);
});

test('downloadAttachments falls back to the Jira URL when a download does not happen', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const big = {
    id: '1',
    filename: 'huge.png',
    size: 50 * 1024 * 1024,
    mediaApiFileId: UUID,
    content: 'https://jira.example/rest/api/3/attachment/content/1',
  };
  const denied = {
    id: '2',
    filename: 'denied.png',
    size: 1024,
    content: 'https://jira.example/rest/api/3/attachment/content/2',
  };

  const filePath = path.join(tmpDir, 'PROJ-4-thing.md');
  fs.writeFileSync(
    filePath,
    `# PROJ-4\n\n![huge.png](attachment:${UUID})\n\n![denied.png](attachment:unknown-key)\n`
  );

  const client = {
    get: async () => ({ ok: () => false, status: () => 403 }),
  };

  const stats = await downloadAttachments(
    [{
      issue: { key: 'PROJ-4', fields: { attachment: [big, denied] } },
      filePath,
      dir: tmpDir,
    }],
    client,
    25,
    { downloadAll: false }
  );

  assert.deepEqual(stats, { downloaded: 0, skipped: 1, failed: 1, rateLimited: 0 });

  const md = fs.readFileSync(filePath, 'utf8');
  assert.match(md, /!\[huge\.png\]\(https:\/\/jira\.example\/rest\/api\/3\/attachment\/content\/1\)/);
  // Matched by its alt text, so the failed download still resolves to Jira.
  assert.match(md, /!\[denied\.png\]\(https:\/\/jira\.example\/rest\/api\/3\/attachment\/content\/2\)/);
  assert.doesNotMatch(md, /attachment:/);
});

test('a rate-limited attachment is counted separately and does not abort the run', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-att-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const filePath = path.join(tmpDir, 'PROJ-5-thing.md');
  fs.writeFileSync(filePath, '# PROJ-5\n\n![a.png](attachment:1)\n');

  const client = {
    get: async () => {
      const error = new Error('Jira rate-limited this export (HTTP 429)');
      error.rateLimited = true;
      throw error;
    },
  };

  // Markdown already on disk is valid, so attachments stay best-effort even
  // under throttling - but the summary has to say why the run came out thin.
  const stats = await downloadAttachments(
    [{
      issue: {
        key: 'PROJ-5',
        fields: { attachment: [{ id: '1', filename: 'a.png', size: 10, content: 'https://jira.example/c/1' }] },
      },
      filePath,
      dir: tmpDir,
    }],
    client,
    25
  );

  assert.deepEqual(stats, { downloaded: 0, skipped: 0, failed: 1, rateLimited: 1 });
  // The placeholder falls back to a URL a logged-in reader can still open.
  assert.match(fs.readFileSync(filePath, 'utf8'), /\(https:\/\/jira\.example\/c\/1\)/);
});

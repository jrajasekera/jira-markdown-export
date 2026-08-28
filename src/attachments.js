const fs = require('fs');
const path = require('path');
const { sanitizeDir } = require('./naming.js');

// Atlassian media-services ids are UUIDs; the ADF `media` node's attrs.id is one.
const MEDIA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ATTACHMENT_LINK = /(!?)\[([^\]]*)\]\(attachment:([^)]+)\)/g;

// The `attachment:<key>` placeholder syntax has exactly one owner: this module.
// `processMedia` in src/adf.js writes placeholders through the producer below,
// and `collectPlaceholderKeys` / `rewriteAttachmentLinks` read them back with
// ATTACHMENT_LINK. Keeping producer and parser together stops the two halves
// of the contract from drifting apart.
function attachmentPlaceholder(id, alt) {
  return `![${alt || 'attachment'}](attachment:${id || ''})`;
}

// On-disk name for a downloaded attachment: the REST id keeps it unique, the
// sanitized stem keeps it readable.
function attachmentFilename(att) {
  const base = att.filename || 'file';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return `${att.id}-${sanitizeDir(stem)}${ext ? '.' + ext : ''}`;
}

// Every identifier a `attachment:<key>` placeholder might carry. Jira does not
// document which field (if any) of the REST attachment record holds the media
// UUID used by ADF, so accept the REST id, the filename, and any UUID-shaped
// value on the record. Unmatched placeholders are simply left alone.
function attachmentKeys(att, { skipFilename = false } = {}) {
  const keys = new Set();
  if (att.id !== undefined && att.id !== null) keys.add(String(att.id));
  if (att.filename && !skipFilename) keys.add(att.filename);
  Object.values(att).forEach(value => {
    if (typeof value === 'string' && MEDIA_UUID.test(value)) keys.add(value);
  });
  return [...keys];
}

// Every `attachment:<key>` placeholder in a Markdown file, as the set of strings
// that could identify the attachment behind it: the placeholder key itself and
// the link text (Jira usually sets a media node's alt text to the filename).
function collectPlaceholderKeys(markdown) {
  const keys = new Set();
  for (const [, , alt, key] of markdown.matchAll(ATTACHMENT_LINK)) {
    keys.add(key);
    if (alt) keys.add(alt);
  }
  return keys;
}

// Replace `attachment:<key>` placeholders using a Map<key, target>. The link
// text is tried as a fallback key because Jira usually sets a media node's alt
// text to the attachment filename. Unresolved placeholders are left as-is.
function rewriteAttachmentLinks(markdown, mapping) {
  return markdown.replace(
    ATTACHMENT_LINK,
    (match, bang, alt, key) => {
      const target = mapping.get(key) || mapping.get(alt);
      return target ? `${bang}[${alt}](${target})` : match;
    }
  );
}

function renderAttachmentList(entries) {
  return `\n\n## Attachments\n\n${entries.map(e => `- [${e.filename}](${e.relPath})`).join('\n')}\n`;
}

// Resolve the attachments of every written issue file. An attachment is fetched
// when it is referenced by an inline placeholder in that file, or when
// `downloadAll` asks for the issue's whole attachment set; anything fetched is
// rewritten to its local path. A placeholder whose attachment was skipped or
// failed falls back to the Jira URL, which at least resolves for a logged-in
// reader, instead of staying an unusable `attachment:` link. Failures are
// logged and skipped so one bad attachment never aborts the export.
async function downloadAttachments(writes, page, maxMb, { downloadAll = true } = {}) {
  const limit = maxMb * 1024 * 1024;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { issue, filePath, dir } of writes) {
    const attachments = issue.fields?.attachment || [];
    if (attachments.length === 0) continue;

    const markdown = fs.readFileSync(filePath, 'utf8');
    const referenced = collectPlaceholderKeys(markdown);

    const seen = new Set();
    const ambiguous = new Set();
    attachments.forEach(att => {
      if (!att.filename) return;
      if (seen.has(att.filename)) ambiguous.add(att.filename);
      seen.add(att.filename);
    });
    ambiguous.forEach(name => {
      console.log(`[-] Ambiguous attachment mapping for ${name} on ${issue.key}; matching by id only`);
    });

    const attachmentDir = path.join(dir, 'attachments');
    const mapping = new Map();
    const listed = [];

    for (const att of attachments) {
      const label = att.filename || att.id;
      const keys = attachmentKeys(att, { skipFilename: ambiguous.has(att.filename) });
      const isReferenced = keys.some(key => referenced.has(key));

      // Without downloadAll only inline media is worth fetching; the rest of the
      // issue's attachments are not linked from the Markdown anyway.
      if (!downloadAll && !isReferenced) continue;

      // A placeholder that cannot be stored locally still points somewhere.
      const fallback = () => {
        if (!isReferenced || !att.content) return;
        keys.forEach(key => mapping.set(key, att.content));
      };

      if (att.size > limit) {
        console.log(`[-] Skipping ${label} (${(att.size / 1024 / 1024).toFixed(1)} MB > ${maxMb} MB)`);
        skipped++;
        fallback();
        continue;
      }
      if (!att.content) {
        console.log(`[-] Failed to download ${label}: no content URL`);
        failed++;
        continue;
      }

      let res;
      try {
        res = await page.request.get(att.content);
      } catch (error) {
        console.log(`[-] Failed to download ${label}: ${error.message}`);
        failed++;
        fallback();
        continue;
      }
      if (!res.ok()) {
        console.log(`[-] Failed to download ${label} (${res.status ? res.status() : 'not ok'})`);
        failed++;
        fallback();
        continue;
      }

      const name = attachmentFilename(att);
      fs.mkdirSync(attachmentDir, { recursive: true });
      fs.writeFileSync(path.join(attachmentDir, name), await res.body());
      console.log(`[+] Downloaded ${label}`);
      downloaded++;

      const relPath = `attachments/${name}`;
      keys.forEach(key => mapping.set(key, relPath));
      listed.push({ filename: label, relPath });
    }

    const rewritten = rewriteAttachmentLinks(markdown, mapping);
    const withList = downloadAll && listed.length > 0
      ? rewritten + renderAttachmentList(listed)
      : rewritten;
    if (withList !== markdown) fs.writeFileSync(filePath, withList);
  }

  console.log(`[+] Attachments: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);
  return { downloaded, skipped, failed };
}

module.exports = {
  attachmentPlaceholder,
  attachmentFilename,
  attachmentKeys,
  collectPlaceholderKeys,
  rewriteAttachmentLinks,
  downloadAttachments,
};

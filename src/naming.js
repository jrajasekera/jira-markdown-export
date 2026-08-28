function sanitizeDir(summary) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeFilename(key, summary) {
  return `${key}-${sanitizeDir(summary)}`;
}

// Info file written inside a folder issue's directory (_epic.md, _story.md, ...)
function infoFilename(typeName) {
  return `_${(typeName || 'unknown').toLowerCase().replace('-', '')}.md`;
}

module.exports = {
  sanitizeDir,
  sanitizeFilename,
  infoFilename,
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  intFromEnv,
  buildIssueFields,
  customFieldId,
  customFieldOverride,
} = require('../src/config.js');

const BOUNDS = { min: 0, max: 10 };

// Swallow the warning intFromEnv prints when it rejects a value.
function quietly(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

test('intFromEnv accepts integers inside the range, including the bounds', () => {
  assert.equal(intFromEnv('X', '0', 4, BOUNDS), 0);
  assert.equal(intFromEnv('X', '7', 4, BOUNDS), 7);
  assert.equal(intFromEnv('X', '10', 4, BOUNDS), 10);
});

test('intFromEnv falls back when the variable is unset or blank', () => {
  assert.equal(intFromEnv('X', undefined, 4, BOUNDS), 4);
  assert.equal(intFromEnv('X', '', 4, BOUNDS), 4);
  assert.equal(intFromEnv('X', '   ', 4, BOUNDS), 4);
});

test('intFromEnv rejects values that would corrupt a retry loop', () => {
  // Each of these reaches the retry count as NaN, a negative, or a fraction if
  // parsed with a bare Number().
  for (const raw of ['abc', '2.5', '-1', '99', 'Infinity']) {
    assert.equal(quietly(() => intFromEnv('X', raw, 4, BOUNDS)), 4, raw);
  }
});

test('intFromEnv warns by name so a typo is findable', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    intFromEnv('JIRA_MAX_RETRIES', 'lots', 4, BOUNDS);
  } finally {
    console.warn = original;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /JIRA_MAX_RETRIES=lots/);
});

test('custom field IDs are validated before being added to every issue request', () => {
  assert.equal(customFieldId(' customfield_10020 '), 'customfield_10020');
  assert.equal(customFieldId('Sprint'), undefined);
  assert.equal(customFieldId('customfield_nope'), undefined);

  const fields = buildIssueFields({ sprint: 'customfield_10020', storyPoints: 'invalid' });
  assert.match(fields, /fixVersions/);
  assert.match(fields, /customfield_10020/);
  assert.doesNotMatch(fields, /invalid/);
});

test('invalid custom field overrides fall back to automatic discovery with a warning', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    assert.equal(customFieldOverride('JIRA_SPRINT_FIELD_ID', 'Sprint'), '');
  } finally {
    console.warn = original;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /JIRA_SPRINT_FIELD_ID=Sprint/);
  assert.match(warnings[0], /automatic discovery/);
});

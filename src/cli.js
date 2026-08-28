// Turn a user-supplied issue reference into a Jira issue key, or null if it is not one.
// Accepts a bare key (`abc-123`) or a Jira URL carrying the key in `/browse/KEY`, or in a
// `selectedIssue` / `issueKey` query parameter. The key shape is deliberately permissive:
// it is a sanity check, not Jira validation - the API is the authority on whether a
// well-formed key exists.
const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

function parseIssueRef(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (ISSUE_KEY_RE.test(trimmed)) return trimmed.toUpperCase();

  let url;
  try {
    url = new URL(trimmed);
  } catch (error) {
    return null;
  }

  const candidates = [
    url.searchParams.get('selectedIssue'),
    url.searchParams.get('issueKey'),
  ];

  // .../browse/KEY -- take the segment right after `browse`.
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const browseIndex = segments.indexOf('browse');
  if (browseIndex !== -1) candidates.push(segments[browseIndex + 1]);

  for (const candidate of candidates) {
    if (candidate && ISSUE_KEY_RE.test(candidate)) return candidate.toUpperCase();
  }

  return null;
}

// The message shown when a single-issue export cannot fetch its seed. A bad key
// and a missing permission both look like an HTTP refusal, so the friendly
// rewrite covers them - but a rate-limit failure is neither, and telling the
// user to check the key would send them chasing the wrong problem. Those pass
// through untouched.
function describeIssueFetchError(error, issueKey) {
  if (error.rateLimited) return error;

  const status = error.status ? ` (${error.status})` : '';
  return new Error(`Could not fetch ${issueKey}${status} - check the key and that you have access`);
}

module.exports = {
  parseIssueRef,
  describeIssueFetchError,
};

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

// Parse the command-line export scope before the export starts. Keeping this
// separate from the entry point ensures bad input is rejected before a browser
// is opened or the output directory can be prepared.
function parseExportArgs(args) {
  const issueKeys = [];
  let jql;
  let refreshSession = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--refresh-session') {
      if (refreshSession) {
        return { error: 'Specify --refresh-session at most once.' };
      }
      refreshSession = true;
      continue;
    }

    if (argument === '--jql') {
      const value = args[index + 1];
      if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
        return { error: 'Missing JQL value after --jql.' };
      }
      if (jql !== undefined) {
        return { error: 'Specify --jql at most once.' };
      }
      jql = value;
      index += 1;
      continue;
    }

    const issueKey = parseIssueRef(argument);
    if (!issueKey) {
      return { error: `Not a Jira issue key or URL: ${argument}` };
    }
    issueKeys.push(issueKey);
  }

  if (jql !== undefined && issueKeys.length > 0) {
    return { error: 'Cannot combine --jql with issue keys or URLs.' };
  }

  return {
    issueKeys: [...new Set(issueKeys)],
    jql,
    refreshSession,
  };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

// Reconstruct a copy-pasteable command from the normalized export scope. This
// deliberately uses the saved issue keys rather than the original URLs: both
// select the same Jira issues, and keys are easier to read in recovery output.
function refreshSessionCommand({ issueKeys = [], jql } = {}) {
  const args = ['npm', 'run', 'export', '--', '--refresh-session'];
  if (jql !== undefined) {
    args.push('--jql', jql);
  } else {
    args.push(...issueKeys);
  }
  return args.map(shellQuote).join(' ');
}

// The message shown when a single-issue export cannot fetch its seed. A bad key
// and a missing permission both look like an HTTP refusal, so the friendly
// rewrite covers them - but a rate-limit failure is neither, and telling the
// user to check the key would send them chasing the wrong problem. Those pass
// through untouched.
function describeIssueFetchError(error, issueKey) {
  if (error.rateLimited || error.sessionExpired || error.transient) return error;

  const status = error.status ? ` (${error.status})` : '';
  return new Error(`Could not fetch ${issueKey}${status} - check the key and that you have access`);
}

module.exports = {
  parseIssueRef,
  parseExportArgs,
  refreshSessionCommand,
  describeIssueFetchError,
};

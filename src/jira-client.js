const { JQL } = require('./config.js');

async function searchIssues(client, jiraUrl, fieldsString, jql = JQL) {
  const issues = [];
  let nextPageToken;

  do {
    const params = new URLSearchParams({
      jql,
      maxResults: String(100),
      fields: fieldsString,
    });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const url = `${jiraUrl}/rest/api/3/search/jql?${params.toString()}`;
    const response = await client.get(
      url,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!response.ok()) {
      throw new Error(`API error: ${response.status()}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.issues)) {
      throw new Error(`Unexpected search response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    issues.push(...data.issues);
    console.log(`[*] Fetched ${issues.length} issues so far`);

    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);

  return issues;
}

// Fetch one issue by key. Throws on a non-OK response, with the HTTP status attached
// as `error.status` so callers can distinguish an API refusal from a network failure.
async function fetchIssue(client, jiraUrl, key, fieldsString) {
  const params = new URLSearchParams({ fields: fieldsString });
  const url = `${jiraUrl}/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`;
  const response = await client.get(
    url,
    {
      headers: {
        'Accept': 'application/json',
      }
    }
  );

  if (!response.ok()) {
    const error = new Error(`Failed to fetch ${key}: ${response.status()}`);
    error.status = response.status();
    throw error;
  }

  return response.json();
}

async function fetchAllParentIssues(issues, client, jiraUrl, fieldsString) {
  const processedKeys = new Set();
  const allIssuesMap = new Map();

  // Add initial assigned issues
  issues.forEach(issue => {
    processedKeys.add(issue.key);
    allIssuesMap.set(issue.key, issue);
  });

  // Queue for BFS traversal
  const queue = [...issues];

  while (queue.length > 0) {
    const currentIssue = queue.shift();
    const parentKey = currentIssue.fields.parent?.key;

    // If has parent and we haven't processed it yet
    if (parentKey && !processedKeys.has(parentKey)) {
      console.log(`[*] Fetching parent: ${parentKey}`);

      try {
        const parentIssue = await fetchIssue(client, jiraUrl, parentKey, fieldsString);
        processedKeys.add(parentKey);
        allIssuesMap.set(parentKey, parentIssue);
        queue.push(parentIssue);
        console.log(`[+] Fetched: ${parentKey}`);
      } catch (error) {
        // Being throttled is not the same as being refused. Treating it like a
        // missing parent would quietly reparent the child to the top level and
        // ship a wrong hierarchy, so it aborts the export instead.
        if (error.rateLimited) throw error;

        // A parent we cannot reach is not fatal: the child is exported at top level.
        if (error.status) {
          console.log(`[-] Failed to fetch ${parentKey}: ${error.status}`);
        } else {
          console.log(`[-] Error fetching ${parentKey}: ${error.message}`);
        }
      }
    }
  }

  return Array.from(allIssuesMap.values());
}

module.exports = {
  searchIssues,
  fetchIssue,
  fetchAllParentIssues,
};

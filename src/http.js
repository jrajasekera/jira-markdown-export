const { MAX_RETRIES } = require('./config.js');

// The statuses Jira uses to say "slow down". Keep 503 in this set for
// compatibility with the existing pacing and RateLimitError contract.
const THROTTLE_STATUSES = new Set([429, 503]);

const BASE_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// A server asking us to wait longer than this wants more patience than an
// export (holding a browser open) can offer. Fail fast and let the user retry.
const RETRY_AFTER_CEILING_MS = 120000;

// Adaptive pacing. Once Jira throttles us, every later request waits first, and
// that wait decays only as clean responses come back — so the export as a whole
// voluntarily slows down instead of hammering a limit it has already hit.
const PACE_START_MS = 1000;
const PACE_MAX_MS = 5000;
const PACE_FLOOR_MS = 250;
const PACE_DECAY = 0.75;

// Raised when retries are exhausted, or when the server's Retry-After exceeds
// the ceiling. `rateLimited` is what callers branch on: it separates "Jira told
// us to back off" from an ordinary refusal like 403/404, which they handle very
// differently.
class RateLimitError extends Error {
  constructor(status, url, retries) {
    const attempts = `${retries} ${retries === 1 ? 'retry' : 'retries'}`;
    super(`Jira rate-limited this export (HTTP ${status}) and did not recover after ${attempts}: ${url}`);
    this.name = 'RateLimitError';
    this.status = status;
    this.rateLimited = true;
  }
}

// A retryable server or transport failure exhausted its retry budget. This is
// intentionally distinct from RateLimitError: Jira did not necessarily ask us
// to slow down.
class TransientRequestError extends Error {
  constructor(url, retries, { status, cause } = {}) {
    const attempts = `${retries} ${retries === 1 ? 'retry' : 'retries'}`;
    const detail = status ? ` (HTTP ${status})` : '';
    super(`Jira request failed transiently${detail} and did not recover after ${attempts}: ${url}`, cause ? { cause } : undefined);
    this.name = 'TransientRequestError';
    this.status = status;
    this.transient = true;
  }
}

// A response to an API request which is no longer an authenticated Jira API
// response. Callers must abort rather than treating it as a missing issue or a
// failed optional attachment.
class SessionExpiredError extends Error {
  constructor(url, { status, responseUrl } = {}) {
    const detail = status ? ` (HTTP ${status})` : responseUrl ? ` (redirected to ${responseUrl})` : '';
    super(`Jira session expired or was redirected to login${detail}. Run the export with --refresh-session to log in again.`);
    this.name = 'SessionExpiredError';
    this.status = status;
    this.sessionExpired = true;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `Retry-After` is either delta-seconds or an HTTP-date. Anything else — blank,
// negative, unparseable, or a date already in the past — means we were told
// nothing useful, and the caller falls back to backoff. Never return 0: a
// zero-length wait turns the retry loop into a spin.
function parseRetryAfter(value, now) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// Not every response double in this repo implements `headers()` (none did
// before this module existed), so its absence means "no Retry-After" rather
// than a crash — the same defensiveness `downloadAttachments` applies to
// `status`.
function retryAfterOf(response, now) {
  if (typeof response.headers !== 'function') return null;
  return parseRetryAfter((response.headers() || {})['retry-after'], now);
}

// Half jitter: half the delay is fixed, half is random. Concurrent exports
// spread out, and no retry can come back instantly.
function backoffFor(retry, random) {
  const full = Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * 2 ** (retry - 1));
  return Math.round(full / 2 + random() * (full / 2));
}

function isTransientStatus(status) {
  return status >= 500 && status <= 599;
}

// Playwright network failures do not share one stable error class across its
// transports. Limit retries to familiar reset/timeout/DNS failures so coding
// errors and bad request options still fail immediately.
function isTransientNetworkError(error) {
  if (!error) return false;
  if (['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'EPIPE'].includes(error.code)) return true;
  return /(?:socket hang up|fetch failed|net::ERR_(?:CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|TIMED_OUT|NETWORK_CHANGED)|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|EPIPE)/i.test(error.message || '');
}

function responseUrl(response) {
  return typeof response.url === 'function' ? response.url() : null;
}

// API requests normally retain their Jira REST URL. Attachments may legitimately
// redirect to a CDN, so redirect detection is deliberately limited to REST API
// calls and recognisable login/SSO destinations.
function isLoginRedirect(requestUrl, finalUrl) {
  if (!requestUrl.includes('/rest/api/') || !finalUrl || finalUrl === requestUrl) return false;
  try {
    const url = new URL(finalUrl);
    return !url.pathname.includes('/rest/api/')
      || /(?:login|signin|sso|authorize)/i.test(url.pathname);
  } catch {
    return /(?:login|signin|sso|authorize)/i.test(finalUrl);
  }
}

// Wraps a Playwright page as the single door every Jira request goes through,
// so retry state and pacing state are shared across the whole export without
// living in module globals. `get` mirrors `page.request.get`, so call sites
// swap `page` for the client and change nothing else.
function createJiraClient(page, {
  maxRetries = MAX_RETRIES,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
} = {}) {
  let pace = 0;

  function tighten() {
    const wasIdle = pace === 0;
    pace = Math.min(PACE_MAX_MS, Math.max(PACE_START_MS, pace * 2));
    if (wasIdle) {
      console.log(`[*] Rate limited; pacing requests ${pace}ms apart until Jira recovers`);
    }
  }

  function relax() {
    if (pace === 0) return;
    pace = Math.round(pace * PACE_DECAY);
    if (pace < PACE_FLOOR_MS) {
      pace = 0;
      console.log('[+] Rate limiting cleared; requests back to full speed');
    }
  }

  async function get(url, init, { allowAuthFailure = false } = {}) {
    // Pacing is charged once per logical request, before the first attempt.
    // Retry waits are not added to it and do not re-trigger it.
    if (pace > 0) await sleep(pace);
    let throttledHere = false;

    for (let retry = 0; ; retry++) {
      let response;
      try {
        response = await page.request.get(url, init);
      } catch (error) {
        if (!isTransientNetworkError(error)) throw error;
        if (retry >= maxRetries) throw new TransientRequestError(url, maxRetries, { cause: error });

        const wait = backoffFor(retry + 1, random);
        console.log(`[*] Jira network error; retry ${retry + 1}/${maxRetries} in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }
      const status = typeof response.status === 'function' ? response.status() : 0;

      if (!allowAuthFailure && (status === 401 || status === 403)) {
        throw new SessionExpiredError(url, { status });
      }
      const finalUrl = responseUrl(response);
      if (!allowAuthFailure && isLoginRedirect(url, finalUrl)) {
        throw new SessionExpiredError(url, { responseUrl: finalUrl });
      }

      if (THROTTLE_STATUSES.has(status)) {
        throttledHere = true;
        tighten();

        const retryAfter = retryAfterOf(response, now);
        if (retryAfter !== null && retryAfter > RETRY_AFTER_CEILING_MS) {
          console.log(`[-] Jira asked for a ${Math.round(retryAfter / 1000)}s wait (HTTP ${status}); giving up rather than stalling the export`);
          throw new RateLimitError(status, url, retry);
        }
        if (retry >= maxRetries) {
          throw new RateLimitError(status, url, maxRetries);
        }

        const wait = retryAfter === null ? backoffFor(retry + 1, random) : retryAfter;
        console.log(`[*] Rate limited (HTTP ${status}); retry ${retry + 1}/${maxRetries} in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }

      if (isTransientStatus(status)) {
        if (retry >= maxRetries) throw new TransientRequestError(url, maxRetries, { status });

        const wait = backoffFor(retry + 1, random);
        console.log(`[*] Jira server error (HTTP ${status}); retry ${retry + 1}/${maxRetries} in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }

      {
        // A retry that recovers its own call must not decay the pace, or the
        // very first success would undo the slowdown for everything after it.
        if (!throttledHere) relax();
        return response;
      }
    }
  }

  return { get };
}

module.exports = {
  RateLimitError,
  SessionExpiredError,
  TransientRequestError,
  createJiraClient,
  isLoginRedirect,
  isTransientNetworkError,
  parseRetryAfter,
};

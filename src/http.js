const { MAX_RETRIES } = require('./config.js');

// The statuses Jira uses to say "slow down". 502/504 are gateway blips rather
// than rate limiting and are deliberately left to fail as they always have.
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

  async function get(url, init) {
    // Pacing is charged once per logical request, before the first attempt.
    // Retry waits are not added to it and do not re-trigger it.
    if (pace > 0) await sleep(pace);
    let throttledHere = false;

    for (let retry = 0; ; retry++) {
      const response = await page.request.get(url, init);
      const status = typeof response.status === 'function' ? response.status() : 0;

      if (!THROTTLE_STATUSES.has(status)) {
        // A retry that recovers its own call must not decay the pace, or the
        // very first success would undo the slowdown for everything after it.
        if (!throttledHere) relax();
        return response;
      }

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
    }
  }

  return { get };
}

module.exports = {
  RateLimitError,
  createJiraClient,
  parseRetryAfter,
};

import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { RateLimiter } from './rateLimiter.js';
import { QlooCache } from './qlooCache.js';
import { sanitizeTransportValue, redactionSummary } from './privacyGuard.js';
import { mockQlooRequest } from './qlooMock.js';
import { createLogger } from '../logger.js';

const log = createLogger('qloo');

export class QlooApiError extends Error {
  constructor(message, { status, statusText, data, attempts, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'QlooApiError';
    // Stable machine-readable code (parity with the typed domain errors).
    this.code = 'QLOO_API_ERROR';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
    this.attempts = attempts;
  }
}

/**
 * Shared limiter for every outgoing request to the Qloo Taste AI API.
 * All traffic (GET/POST/custom) funnels through `qlooRequest`, so this
 * single instance enforces the effective budget of the hackathon key.
 */
export const qlooRateLimiter = new RateLimiter({
  capacity: env.QLOO_RATE_LIMIT,
  intervalMs: env.QLOO_RATE_WINDOW_MS,
  maxConcurrent: env.QLOO_MAX_CONCURRENCY,
  maxQueue: env.QLOO_RATE_QUEUE_MAX,
});

/**
 * Single-flight cache for concurrent identical GET requests: if several code
 * paths request the same resource at the same moment, only one upstream call
 * is made and every caller shares its result. Prevents duplicate parallel
 * calls from wasting the key quota. Never applied to non-idempotent methods.
 */
const inflight = new Map();

/**
 * Two-tier response cache (memory + disk) keyed by a SHA-256 hash of the
 * canonical request identity. Saves hackathon key quota during development:
 * repeated identical queries are served locally, surviving `node --watch`
 * restarts via the disk tier. GET responses are cached by default; other
 * methods only with an explicit `cache: true` option.
 */
export const qlooResponseCache = new QlooCache({
  enabled: env.QLOO_CACHE_ENABLED,
  ttlMs: env.QLOO_CACHE_TTL_MS,
  dir: env.QLOO_CACHE_DIR,
  maxEntries: env.QLOO_CACHE_MAX_ENTRIES,
});

// Fingerprint of the API key (never the key itself) so caches from different
// accounts can never serve each other's data.
const KEY_FINGERPRINT = createHash('sha256')
  .update(env.QLOO_API_KEY)
  .digest('hex')
  .slice(0, 16);

/** Canonical cache key: base URL + key fingerprint + method + URL + body. */
function cacheKeyFor(method, url, body) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        env.QLOO_BASE_URL,
        KEY_FINGERPRINT,
        method,
        url,
        body ?? null,
      ])
    )
    .digest('hex');
}

/**
 * Per-endpoint TTL policy: Qloo entities, tags and audiences are
 * relatively static reference data (a movie does not rename itself
 * between two requests, and the `urn:audience:*` taxonomy changes on the
 * order of months), so repeated lookups are admitted under a long 24h
 * lifetime, while volatile endpoints (insights, taste, search) use the
 * general TTL.
 */
const LONG_LIVED_TTL_PATTERN = /^\/v2\/(entities|tags|audiences)(\/|$)/;

export function ttlForPathname(pathname) {
  return LONG_LIVED_TTL_PATTERN.test(pathname)
    ? env.QLOO_CACHE_TTL_ENTITIES_MS
    : env.QLOO_CACHE_TTL_MS;
}

const MAX_RETRY_AFTER_MS = 30_000;

/** HTTP statuses considered transient: quota throttle and overload. */
const RETRYABLE_STATUSES = new Set([429, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true for errors that indicate a transient network failure
 * (DNS blip, refused/reset connection, socket timeout). Caller-initiated
 * aborts are NOT retried — cancelling must stay deterministic; that is
 * checked via `signal.aborted` in `attemptRequest`.
 */
function isRetryableNetworkError(err) {
  if (err.name === 'AbortError') return false;
  if (err instanceof TypeError) return true; // fetch() network failures
  if (err.code && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND'].includes(err.code)) {
    return true;
  }
  const cause = err.cause;
  if (cause && cause !== err && isRetryableNetworkError(cause)) return true;
  return false;
}

/** Parses Retry-After (seconds or HTTP-date) into a clamped delay in ms. */
function parseRetryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(0, dateMs - Date.now()), MAX_RETRY_AFTER_MS);
  }

  return null;
}

/**
 * Full-jitter exponential backoff: random(0, min(base * 2^attempt, cap)).
 * Full jitter avoids synchronized retry storms from concurrent requests.
 */
function backoffWithJitter(attempt) {
  const base = Math.min(
    env.QLOO_RETRY_BASE_MS * 2 ** attempt,
    env.QLOO_RETRY_MAX_MS
  );
  return Math.floor(Math.random() * base);
}

async function readErrorPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Executes one attempt. Resolves with the parsed JSON body on 2xx,
 * throws `QlooApiError` on non-retryable HTTP failures and on transient
 * failures once retries are exhausted, or returns `{ retryAfterMs, status }`
 * when the caller should back off and try again.
 */
async function attemptRequest(url, fetchOptions, attemptsUsed) {
  let response;
  try {
    response = await qlooRateLimiter.schedule(() => fetch(url, fetchOptions));
  } catch (err) {
    // A caller-cancelled request (AbortController / AbortSignal.timeout)
    // must never be retried, regardless of the error shape.
    if (fetchOptions.signal?.aborted) {
      throw err;
    }
    // Transport-level failure before any HTTP response (DNS, reset, timeout).
    if (isRetryableNetworkError(err)) {
      return { retry: true, kind: 'network', cause: err };
    }
    throw err;
  }

  if (response.ok) {
    return { body: await response.json() };
  }

  const payload = await readErrorPayload(response);
  const error = new QlooApiError(
    `Qloo API request failed: ${response.status} ${response.statusText}`,
    {
      status: response.status,
      statusText: response.statusText,
      data: payload,
      attempts: attemptsUsed,
    }
  );

  if (!RETRYABLE_STATUSES.has(response.status)) {
    throw error; // permanent failure (401, 404, ...): retrying is pointless
  }

  return {
    retry: true,
    kind: 'http',
    status: response.status,
    retryAfterMs: parseRetryAfterMs(response),
    error,
  };
}

/**
 * Exponential backoff with 3 total attempts (initial + QLOO_MAX_RETRIES)
 * for transient failures: network errors and HTTP 429/503.
 *
 * Delay policy per retry:
 * 1. If the upstream sent Retry-After (429/503 overload hints) — honor it,
 *    clamped to QLOO_RETRY_MAX_MS.
 * 2. Otherwise — full-jitter exponential backoff: random(0, base * 2^n),
 *    capped at QLOO_RETRY_MAX_MS.
 *
 * Each retry re-acquires a rate-limiter token, so backoff retries can never
 * burst past the Qloo key quota.
 */
async function performRequest(url, fetchOptions) {
  const maxAttempts = env.QLOO_MAX_RETRIES + 1;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const retryAfterMs =
        lastError.retryAfterMs !== null && lastError.retryAfterMs !== undefined
          ? lastError.retryAfterMs
          : null;
      const waitMs =
        retryAfterMs !== null
          ? Math.min(retryAfterMs, env.QLOO_RETRY_MAX_MS)
          : backoffWithJitter(attempt - 1);

      log.warn(
        `transient failure for ${url.pathname} ` +
          `(${lastError.kind}${lastError.status ? ` ${lastError.status}` : ''}); ` +
          `retry ${attempt}/${env.QLOO_MAX_RETRIES} in ${waitMs}ms`
      );
      await sleep(waitMs);
    }

    const outcome = await attemptRequest(url, fetchOptions, attempt + 1);

    if (!outcome.retry) {
      return outcome.body;
    }

    lastError = outcome;
  }

  // All attempts exhausted: surface the last HTTP error verbatim, or wrap
  // the final network error so callers always see a QlooApiError.
  if (lastError.kind === 'http') {
    lastError.error.attempts = maxAttempts;
    throw lastError.error;
  }

  throw new QlooApiError(
    `Qloo API request failed after ${maxAttempts} attempts: ` +
      `${lastError.cause?.message ?? 'network error'}`,
    {
      status: null,
      statusText: 'Network Error',
      data: null,
      attempts: maxAttempts,
      cause: lastError.cause,
    }
  );
}

async function qlooRequest(endpoint, options = {}) {
  const {
    params,
    body,
    headers: customHeaders,
    cache: cacheOverride,
    ...rest
  } = options;

  // PRIVACY GUARANTEE (Qloo rule: zero personal data in requests): every
  // outbound query param and request body is pattern-redacted before it
  // can reach the wire. This is UNCONDITIONAL — a guarantee cannot have
  // an off switch. Headers are deliberately untouched: X-Api-Key is a
  // credential, not personal data. Sanitization happens BEFORE the cache
  // key and the single-flight key are computed, so a tainted and a
  // clean-but-otherwise-identical request converge on one cache entry.
  let sanitizedParams = params;
  if (params && typeof params === 'object') {
    const { value, findings } = sanitizeTransportValue(params);
    if (findings.length > 0) {
      log.warn('privacy guard redacted personal data from outbound params', {
        findings: redactionSummary(findings),
      });
    }
    sanitizedParams = value;
  }

  let sanitizedBody = body;
  if (body !== undefined && body !== null) {
    const { value, findings } = sanitizeTransportValue(body);
    if (findings.length > 0) {
      log.warn('privacy guard redacted personal data from outbound body', {
        findings: redactionSummary(findings),
      });
    }
    sanitizedBody = value;
  }

  const baseUrl = env.QLOO_BASE_URL.endsWith('/')
    ? env.QLOO_BASE_URL
    : env.QLOO_BASE_URL + '/';
  const url = new URL(endpoint.replace(/^\//, ''), baseUrl);

  if (sanitizedParams) {
    const searchParams = new URLSearchParams(sanitizedParams);
    url.search = searchParams.toString();
  }

  const headers = {
    Accept: 'application/json',
    ...customHeaders,
    // The API key is always attached last so no outgoing request to the
    // Qloo Taste AI API can accidentally omit (or override) credentials.
    'X-Api-Key': env.QLOO_API_KEY,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions = {
    ...rest,
    headers,
  };

  if (body !== undefined) {
    fetchOptions.body =
      typeof sanitizedBody === 'string' ? sanitizedBody : JSON.stringify(sanitizedBody);
  }

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const flightKey = `${method} ${url}`;

  // Cache policy: GET responses are cacheable by default; non-idempotent
  // methods only with an explicit opt-in. `cache: false` bypasses the cache
  // entirely (neither reads nor writes) — e.g. for forced freshness.
  // MOCK_MODE bypasses the cache unconditionally: fixtures are already
  // local and deterministic, and mock data must never pollute the disk
  // cache that live traffic reads after MOCK_MODE is switched off.
  const cacheable =
    !env.MOCK_MODE &&
    (cacheOverride === true || (cacheOverride !== false && method === 'GET'));
  const cacheKey = cacheable
    ? cacheKeyFor(method, url.toString(), fetchOptions.body)
    : null;

  if (method === 'GET' && inflight.has(flightKey)) {
    return inflight.get(flightKey);
  }

  const pending = (async () => {
    // TTL validation: entity/tag lookups get the long 24h lifetime,
    // everything else the general TTL. The cache itself re-validates the
    // stored value and falls back to its default when it is corrupt.
    const ttlMs = ttlForPathname(url.pathname);

    if (cacheKey) {
      const hit = await qlooResponseCache.get(cacheKey);
      if (hit) return hit.data;
    }

    try {
      // MOCK_MODE serves static fixtures at the same seam where live
      // requests run, so every service client works unchanged offline.
      // Mock errors (missing fixture) are NOT retried or wrapped — they
      // are programming errors, not transient upstream failures.
      const data = env.MOCK_MODE
        ? await mockQlooRequest(method, url)
        : await performRequest(url, fetchOptions);
      if (cacheKey) {
        // Best-effort: a cache write failure must never fail the request.
        await qlooResponseCache.set(cacheKey, data, { ttlMs }).catch(() => {});
      }
      return data;
    } catch (err) {
      // Stale-if-error: after upstream retries are exhausted, an expired
      // cached copy keeps development unblocked instead of an exception.
      if (cacheKey) {
        const stale = await qlooResponseCache
          .get(cacheKey, { allowStale: true })
          .catch(() => null);
        if (stale) {
          log.warn(
            `upstream failed (${err.message}); serving ` +
              `stale cached response for ${url.pathname} ` +
              `(${Math.round(stale.ageMs / 1000)}s old)`
          );
          return stale.data;
        }
      }
      throw err;
    }
  })();

  if (method === 'GET') {
    inflight.set(flightKey, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(flightKey);
    }
  }

  return pending;
}

function get(endpoint, params, options = {}) {
  return qlooRequest(endpoint, { ...options, params, method: 'GET' });
}

function post(endpoint, body, options = {}) {
  return qlooRequest(endpoint, { ...options, body, method: 'POST' });
}

function request(endpoint, options = {}) {
  return qlooRequest(endpoint, options);
}

export const qlooClient = {
  get,
  post,
  request,
  /** Cache observability snapshot (hits/misses/stores/failures). */
  cacheStats: () => qlooResponseCache.stats,
  /** Empties both cache tiers (memory + disk). Resolves when done. */
  clearCache: () => qlooResponseCache.clear(),
};
export default qlooClient;

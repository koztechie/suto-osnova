/**
 * Inbound client rate limiter (task 116) — spam protection for the
 * expensive generate routes, per CLIENT (IP).
 *
 * Distinct from the OUTBOUND RateLimiter (services/rateLimiter.js,
 * which protects the Qloo API-key quota): this guards the SERVER
 * against one client spamming repeated generate requests. A generate
 * run is expensive (a full cross-domain pipeline + upstream calls),
 * so a fixed window per client key fails fast on a burst.
 *
 * DESIGN (fixed window + bounded map + stale eviction):
 *   - `clientKey(req)` identifies the client: the FIRST
 *     X-Forwarded-For hop (a proxy prepends; the leftmost is the real
 *     client) else the socket remote address;
 *   - each key holds { count, resetAt }; a request past its window
 *     resets the counter;
 *   - `maxRequests` per `windowMs` — a burst beyond it is REJECTED
 *     (never queued: failing fast is cheaper than running the
 *     pipeline);
 *   - the map is BOUNDED (`maxClients`): expired entries are evicted
 *     first, then the earliest-reset entry, so memory cannot grow
 *     without limit under a distributed spoof flood.
 *
 * The 429 is written by `writeRateLimited` (a transport concern the
 * limiter owns directly), carrying the RATE_LIMITED code + a
 * Retry-After header. `check(key, now)` accepts an injected clock for
 * deterministic tests.
 */

/** The 429 envelope writer (the limiter owns its response). */
export function writeRateLimited(res, requestId, retryAfterSeconds) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(Math.max(1, retryAfterSeconds)),
    'X-Request-Id': requestId,
  });
  res.end(JSON.stringify({
    status: 'error',
    service: 'suto-osnova',
    error: { code: 'RATE_LIMITED', message: 'too many requests from this client', requestId },
  }));
}

export class ClientRateLimiter {
  #windowMs;
  #maxRequests;
  #maxClients;
  #entries = new Map();

  constructor({ windowMs, maxRequests, maxClients = 10_000 } = {}) {
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new TypeError('ClientRateLimiter: windowMs must be a number >= 1');
    }
    if (!Number.isFinite(maxRequests) || maxRequests < 1) {
      throw new TypeError('ClientRateLimiter: maxRequests must be a number >= 1');
    }
    if (!Number.isFinite(maxClients) || maxClients < 1) {
      throw new TypeError('ClientRateLimiter: maxClients must be a number >= 1');
    }
    this.#windowMs = windowMs;
    this.#maxRequests = maxRequests;
    this.#maxClients = maxClients;
  }

  /** The client key: the leftmost X-Forwarded-For hop, else the socket. */
  clientKey(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0].trim();
      if (first.length > 0) return first;
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }

  /** Count one request for `key`; report whether it is allowed. */
  check(key, now = Date.now()) {
    let entry = this.#entries.get(key);
    if (!entry || now >= entry.resetAt) {
      // Bound the map: drop expired entries first, then the
      // earliest-reset one, so a spoofed-IP flood cannot grow memory.
      if (!entry && this.#entries.size >= this.#maxClients) {
        this.#evict(now);
      }
      entry = { count: 0, resetAt: now + this.#windowMs };
      this.#entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > this.#maxRequests) {
      return Object.freeze({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      });
    }
    return Object.freeze({
      allowed: true,
      remaining: this.#maxRequests - entry.count,
      retryAfterSeconds: 0,
    });
  }

  #evict(now) {
    for (const [key, entry] of this.#entries) {
      if (now >= entry.resetAt) this.#entries.delete(key);
    }
    if (this.#entries.size < this.#maxClients) return;
    let oldestKey = null;
    let oldestReset = Infinity;
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt < oldestReset) { oldestReset = entry.resetAt; oldestKey = key; }
    }
    if (oldestKey !== null) this.#entries.delete(oldestKey);
  }

  /** Observability snapshot. */
  get stats() {
    return {
      tracked: this.#entries.size,
      windowMs: this.#windowMs,
      maxRequests: this.#maxRequests,
      maxClients: this.#maxClients,
    };
  }
}

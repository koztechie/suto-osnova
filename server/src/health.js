/**
 * System health for GET /api/health: service status plus QLOO
 * CONNECTIVITY status.
 *
 * Probe mechanics: a live check issues `GET /` against the Qloo API —
 * the documented "Get API Information" route (verified live 2026-10-15:
 * HTTP 200 JSON, ~700ms), the cheapest authenticated call that proves
 * DNS + TLS + key acceptance + gateway all work. The call runs through
 * qlooClient, so it inherits caching (repeated health polls reuse one
 * cached upstream call per TTL window), rate limiting, retries and the
 * privacy guard; a 5s AbortSignal bounds the worst case.
 *
 * Semantics:
 * - MOCK_MODE=true -> { status: 'mocked', reachable: null } and HTTP 200
 *   (the system is intentionally offline-capable; probing would only
 *   hit the fixture layer);
 * - live + probe enabled -> 'ok' (200) or 'unreachable' (503);
 * - live + probe=0|false -> 'skipped' (200, no upstream traffic).
 * HTTP 503 on degraded so orchestrators/load balancers can react to the
 * status code alone.
 *
 * The payload NEVER echoes request input (no PII surface) and only
 * summarizes transport internals: rate-limiter and cache stats.
 */

import { env } from './config/env.js';
import { isoNow } from './logger.js';
// Static (not per-call dynamic import): the dynamic form allocated
// promise/linkage machinery on every health poll (measured, task 38);
// version.js is crypto-free and ~0.3MB resident.
import { readVersion } from './version.js';

/** Upper bound for one connectivity probe (fetch abort). */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Qloo connectivity check.
 * @param {boolean} probe  live mode: whether to issue the upstream call.
 * @returns {Promise<object>} status report (never throws).
 */
export async function checkQloo({ probe = true } = {}) {
  const checkedAt = isoNow();

  if (env.MOCK_MODE) {
    return { mode: 'mock', status: 'mocked', reachable: null, checkedAt };
  }
  if (!probe) {
    return { mode: 'live', status: 'skipped', reachable: null, checkedAt: null };
  }

  // Lazy import (task 38): the whole Qloo transport chain (client,
  // limiter, cache, privacy guard, mock fixtures) stays OFF the server
  // boot path — the base HTTP server only pays for it when a live probe
  // or a transport-stats read actually runs. ESM module cache makes
  // repeated imports free after the first one.
  const { qlooClient } = await import('./services/qlooClient.js');

  const started = Date.now();
  try {
    await qlooClient.get('/', undefined, {
      // Bounded probe: the health route must answer fast even when the
      // upstream hangs. Aborts are never retried (transport contract).
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      mode: 'live',
      status: 'ok',
      reachable: true,
      latencyMs: Date.now() - started,
      checkedAt,
    };
  } catch (err) {
    return {
      mode: 'live',
      status: 'unreachable',
      reachable: false,
      latencyMs: Date.now() - started,
      checkedAt,
      error: {
        code: err?.code ?? err?.name ?? 'ERROR',
        message: String(err?.message ?? err).slice(0, 200),
      },
    };
  }
}

/**
 * Full health report. `status` is 'ok' unless a live probe FAILED
 * ('skipped' and 'mocked' count as ok — the system itself is healthy).
 *
 * Transport stats are reported ONLY when the Qloo transport chain is
 * already engaged (a live probe ran and loaded it) — importing it just
 * for stats would put the whole chain back on the request path and cost
 * ~7MB RSS (measured, task 38); in that case they come for free.
 */
export async function healthReport({ probe = true } = {}) {
  const qloo = await checkQloo({ probe });
  const healthy = qloo.reachable !== false;

  let transport = {
    rateLimiter: null,
    cache: null,
    note: 'qloo transport not engaged (mock/skipped probe)',
  };
  if (qloo.mode === 'live' && qloo.status !== 'skipped') {
    // Free: the probe above already loaded the chain.
    const { qlooClient, qlooRateLimiter } = await import(
      './services/qlooClient.js'
    );
    transport = {
      rateLimiter: qlooRateLimiter.stats,
      cache: qlooClient.cacheStats(),
    };
  }

  return {
    status: healthy ? 'ok' : 'degraded',
    service: 'suto-osnova',
    version: readVersion(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: isoNow(),
    mockMode: env.MOCK_MODE,
    qloo,
    transport,
  };
}

/** HTTP handler for GET /api/health (200 ok / 503 degraded). */
export async function handleHealth(req, res, url) {
  const probeParam = url.searchParams.get('probe');
  const probe = probeParam !== '0' && probeParam !== 'false';

  const report = await healthReport({ probe });

  res.writeHead(report.status === 'ok' ? 200 : 503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(report));
}

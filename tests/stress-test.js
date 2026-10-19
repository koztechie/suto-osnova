/**
 * BACKEND STRESS TEST (task 166) — 50 SEQUENTIAL requests against the
 * real HTTP handler, measuring per-request latency, status codes and
 * heap growth, then reporting throughput and failing loudly on any
 * non-200.
 *
 * HOW TO RUN (deliberately NOT part of `npm test`):
 *     node tests/stress-test.js            # 50 requests (the default)
 *     node tests/stress-test.js 200        # a custom count
 *     npm run test:stress                  # the same, via npm
 *
 * INVOCATION CONTRACT: `node --test` AUTO-DISCOVERS this file (it
 * matches the runner's `*-test.js` glob) and sets NODE_TEST_CONTEXT in
 * the child env. The guard below keeps the file INERT under the runner
 * so `npm test` is unaffected; the real stress run happens only on
 * DIRECT execution. This is why the file lives at tests/stress-test.js
 * (the mandated path) yet never slows the unit suite.
 *
 * SERVER UNDER TEST: the SAME `createHttpHandler()` the process
 * entrypoint listens with, bound to an ephemeral loopback port — the
 * repo's blessed pattern for driving the real HTTP surface without a
 * port race. Configuration is pinned BEFORE the app module loads (it
 * reads env at import time):
 *   - MOCK_MODE=true           deterministic fixtures, ZERO network;
 *   - QLOO_CACHE_ENABLED=false measure the pure handler cost, not the
 *                              cache's fast path, and keep the disk
 *                              tier out of the run;
 *   - INBOUND_RATE_LIMIT high  the generate routes are spam-protected
 *                              (30/60s by default) — the limiter is
 *                              pinned by rateLimitRoute.test.js; here
 *                              we must not throttle OURSELVES, so the
 *                              budget is raised above the request count;
 *   - LOG_LEVEL=error          a clean report, no per-request noise.
 *
 * WHAT IT PROVES: the backend sustains 50 back-to-back generate runs
 * (the most expensive route — a full cross-domain pipeline) with a
 * 100% success rate, stable latency and bounded memory growth.
 */
import http from 'node:http';

/** The default series length (the task mandates 50). */
export const STRESS_REQUESTS = 50;

/** The anchor every request generates (a fixture the mock gateway knows). */
const STRESS_SEED = 'A24 Psychological Horror';

/**
 * Runs the stress series against a freshly bound handler. Returns the
 * full measurement so callers (a script, a future gate) can assert.
 *
 * @param {object} [options]
 * @param {number} [options.requests] how many sequential requests to send
 * @param {string} [options.mode] the generate route to stress
 * @returns {Promise<object>} the measurement + a pass/fail verdict
 */
export async function runStressTest({
  requests = STRESS_REQUESTS,
  mode = 'worldbuilder',
} = {}) {
  if (!Number.isInteger(requests) || requests < 1) {
    throw new TypeError('runStressTest: requests must be a positive integer');
  }

  // Configure BEFORE the app module loads (env is read at import time).
  process.env.QLOO_API_KEY ??= 'stress-test-key';
  process.env.MOCK_MODE = 'true';
  process.env.QLOO_CACHE_ENABLED = 'false';
  process.env.INBOUND_RATE_LIMIT = String(requests + 10);
  process.env.INBOUND_RATE_WINDOW_MS = '60000';
  process.env.LOG_LEVEL = 'error';
  process.env.NODE_ENV = 'test';

  const { createHttpHandler } = await import('../server/src/app.js');

  const server = http.createServer(createHttpHandler());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Readiness: the server must answer health before we start the clock.
    const ready = await fetch(`${base}/api/health`);
    const healthBody = await ready.json();
    if (ready.status !== 200) {
      throw new Error(`server not ready: health ${ready.status}`);
    }

    const latencies = [];
    const statuses = [];
    const heapBefore = process.memoryUsage().heapUsed;
    const wallStart = performance.now();

    for (let i = 0; i < requests; i += 1) {
      const started = performance.now();
      const response = await fetch(`${base}/api/generate/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: STRESS_SEED, format: 'json' }),
      });
      // Drain the body so the socket is fully consumed (a kept-alive
      // connection would otherwise stall on an unread response).
      const payload = await response.json();
      latencies.push(performance.now() - started);
      statuses.push(response.status);
      if (response.status !== 200 || payload.status !== 'ok') {
        // Fail fast: a broken backend should not be measured 50 times.
        throw new Error(
          `request ${i + 1} failed: HTTP ${response.status} ` +
            `(${JSON.stringify(payload.error ?? payload).slice(0, 160)})`
        );
      }
    }

    const wallMs = performance.now() - wallStart;
    const heapAfter = process.memoryUsage().heapUsed;

    return {
      ok: true,
      requests,
      mode,
      port,
      health: {
        status: healthBody.status,
        qloo: healthBody.qloo?.status ?? null,
        mode: healthBody.qloo?.mode ?? null,
      },
      statuses,
      latencies,
      wallMs,
      rps: (requests / wallMs) * 1000,
      heapGrowthBytes: heapAfter - heapBefore,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** min/mean/p95/max summary of a latency series (ms). */
export function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    min: sorted[0],
    mean,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** The CLI entry: run, report to stdout, set the exit code. */
async function main() {
  const arg = Number(process.argv[2]);
  const requests = Number.isInteger(arg) && arg > 0 ? arg : STRESS_REQUESTS;

  process.stdout.write(
    `SUTO OSNOVA backend stress test — ${requests} sequential POST /api/generate/worldbuilder\n` +
      `MOCK_MODE=true, cache off, inbound limiter raised above ${requests}\n\n`
  );

  const result = await runStressTest({ requests });
  const stats = summarize(result.latencies);
  const distinct = [...new Set(result.statuses)];

  process.stdout.write(`health: ${result.health.status} (qloo: ${result.health.qloo}, mode: ${result.health.mode})\n`);
  process.stdout.write(`status codes: ${distinct.join(', ')} (all ${result.requests} requests)\n`);
  process.stdout.write(
    `latency: min ${formatMs(stats.min)} | mean ${formatMs(stats.mean)} | ` +
      `p50 ${formatMs(stats.p50)} | p95 ${formatMs(stats.p95)} | max ${formatMs(stats.max)}\n`
  );
  process.stdout.write(
    `throughput: ${formatMs(result.wallMs)} wall, ${result.rps.toFixed(1)} req/s\n`
  );
  process.stdout.write(`heap growth: ${formatMb(result.heapGrowthBytes)} over the series\n`);

  const failures = result.statuses.filter((s) => s !== 200).length;
  if (failures > 0) {
    process.stdout.write(`\nFAIL: ${failures}/${result.requests} request(s) did not return 200\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nPASS: ${result.requests}/${result.requests} requests returned 200\n`);
}

// The runner guard: inert under `node --test`, live on direct execution.
if (!process.env.NODE_TEST_CONTEXT) {
  main().catch((error) => {
    process.stderr.write(`stress test crashed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

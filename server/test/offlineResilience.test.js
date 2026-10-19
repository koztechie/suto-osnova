/**
 * OFFLINE RESILIENCE suite (task 167) — pins the system's behavior
 * during a TEMPORARY internet outage: the caller gets a CLEAR, HONEST
 * message and the Node.js process NEVER crashes.
 *
 * The concrete bug this closes (found by a live probe, recorded in
 * PLAN_STATE): when the Qloo upstream became unreachable mid-generate,
 * the seed resolver threw a `SeedResolutionError` with code
 * `upstream_error`, which the generic typed-input branch of
 * classifyError mis-mapped to HTTP 400 — blaming the CLIENT for an
 * internet blip. A transport outage is now reported as the transport
 * failure it is: 502 QLOO_NETWORK (or 504 QLOO_TIMEOUT), matching the
 * raw-Qloo classification and preserving upstream {status, attempts}.
 *
 * Three layers of proof:
 *   1. classifyError table — the code/status mapping is exact;
 *   2. in-process E2E — a real handler under a stubbed-dead upstream
 *      returns 502 QLOO_NETWORK with a clean message (no stack leak),
 *      keeps serving non-upstream routes, reports health 503 degraded,
 *      recovers to 200 once the upstream returns, and NEVER emits an
 *      unhandled rejection / uncaught exception;
 *   3. spawned-process liveness — a REAL separate `node server/src/index.js`
 *      process under a sustained outage keeps running (exitCode stays
 *      null) and keeps answering, which is the literal "process did not
 *      crash" guarantee.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Configure BEFORE the app module loads (env is read at import time).
// The outbound base URL is irrelevant for the in-process tests (fetch is
// stubbed), but the rate limiter is built from env at handler creation.
process.env.QLOO_API_KEY ??= 'offline-resilience-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.INBOUND_RATE_LIMIT = '100';
process.env.INBOUND_RATE_WINDOW_MS = '60000';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_RETRY_BASE_MS = '10';
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const { classifyError } = await import('../src/httpErrors.js');
const {
  SeedResolutionError,
  RESOLUTION_CODES,
} = await import('../src/services/seedEntityResolver.js');
const { QlooApiError } = await import('../src/services/qlooClient.js');
const { createHttpHandler } = await import('../src/app.js');
// The repo ROOT: this file lives at server/test/, so two levels up.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A minimal Response stand-in for a healthy upstream answer. */
function okResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** The upstream the worldbuilder needs to resolve a seed (recovery leg). */
function workingUpstream(url) {
  const u = String(url);
  if (u.includes('/search')) {
    return okResponse({
      results: [{
        id: 'aaaaaaaa-1111-4222-8333-444455556666',
        name: 'Blade Runner',
        subtype: 'urn:entity:movie',
        popularity: 0.9,
        tags: [],
      }],
    });
  }
  return okResponse({ results: [], count: 0 });
}

// ---------------------------------------------------------------------------
// 1. classifyError — the exact mapping.
// ---------------------------------------------------------------------------

test('classifyError: a seed-resolution transport failure maps to transport codes, not 400', () => {
  // The resolver's REAL shape: upstream_error wrapping the QlooApiError.
  const wrapped = new SeedResolutionError('Qloo search failed', {
    code: RESOLUTION_CODES.UPSTREAM_ERROR,
    cause: new QlooApiError('net', {
      status: null,
      statusText: 'Network Error',
      attempts: 2,
      cause: new TypeError('fetch failed'),
    }),
  });
  const got = classifyError(wrapped);
  assert.equal(got.httpStatus, 502, 'an outage is a 502, not a caller-blaming 400');
  assert.equal(got.code, 'QLOO_NETWORK');
  assert.equal(got.upstream.attempts, 2, 'upstream detail survives the delegation');

  // A bare network cause (no QlooApiError wrapper).
  const bare = new SeedResolutionError('search failed', {
    code: RESOLUTION_CODES.UPSTREAM_ERROR,
    cause: new TypeError('fetch failed'),
  });
  assert.equal(classifyError(bare).httpStatus, 502);
  assert.equal(classifyError(bare).code, 'QLOO_NETWORK');

  // A timeout cause is distinguished (504), matching the raw-Qloo rule.
  const timeout = new SeedResolutionError('search timed out', {
    code: RESOLUTION_CODES.UPSTREAM_ERROR,
    cause: Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
  });
  assert.equal(classifyError(timeout).httpStatus, 504);
  assert.equal(classifyError(timeout).code, 'QLOO_TIMEOUT');
});

test('classifyError: the non-transport resolution codes stay 400 (caller/content)', () => {
  for (const code of [
    RESOLUTION_CODES.NO_RESULTS,
    RESOLUTION_CODES.NO_VALID_ID,
    RESOLUTION_CODES.NO_MAPPED_ENTITY,
  ]) {
    const got = classifyError(new SeedResolutionError('no match', { code }));
    assert.equal(got.httpStatus, 400, `${code} is a content/caller problem`);
    assert.equal(got.code, code);
  }
});

// ---------------------------------------------------------------------------
// 2. In-process E2E — outage, liveness, recovery.
// ---------------------------------------------------------------------------

test('outage: a temporary upstream loss yields a clear 502 and the process survives', async () => {
  // Capture the NATIVE fetch before stubbing: the server and this client
  // share the same global, so the client calls must bypass the stub.
  const realFetch = globalThis.fetch;
  const server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const rejections = [];
  const exceptions = [];
  const onRejection = (reason) => rejections.push(String(reason?.message ?? reason));
  const onException = (error) => exceptions.push(String(error?.message ?? error));
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);

  const generate = async () => {
    const res = await realFetch(`${base}/api/generate/worldbuilder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: 'Blade Runner' }),
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    // --- OUTAGE: the upstream is unreachable (connection refused) ---
    globalThis.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNREFUSED' });
    };

    const first = await generate();
    assert.equal(first.status, 502, 'a network outage is a 502, not a caller-blaming 400');
    assert.equal(first.body.status, 'error');
    assert.equal(first.body.error.code, 'QLOO_NETWORK');
    assert.match(first.body.error.message, /unreachable|network/i, 'the message is CLEAR');
    assert.ok(first.body.error.requestId, 'the envelope carries a correlation id');
    assert.ok(
      !/at .*\.js:|\/home\/|node:/.test(first.body.error.message),
      'no stack or filesystem leak in the message'
    );

    // A sustained burst: every request fails typed, none break the handler.
    for (let i = 0; i < 5; i += 1) {
      const again = await generate();
      assert.equal(again.status, 502, `burst request ${i + 1} is still a typed 502`);
      assert.equal(again.body.error.code, 'QLOO_NETWORK');
    }

    // The server KEEPS SERVING what does not need the upstream.
    const categories = await realFetch(`${base}/api/categories`);
    assert.equal(categories.status, 200, 'non-upstream routes stay up');
    await categories.arrayBuffer();

    // Health tells the TRUTH about the outage, and answers (not a crash).
    const health = await realFetch(`${base}/api/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 503, 'health reports degraded during an outage');
    assert.equal(healthBody.status, 'degraded');
    assert.equal(healthBody.qloo.reachable, false);

    // --- RECOVERY: the upstream returns ---
    globalThis.fetch = workingUpstream;
    const recovered = await generate();
    assert.equal(recovered.status, 200, 'once the upstream returns, generation succeeds again');
    assert.equal(recovered.body.status, 'ok');

    // Across the WHOLE episode the process saw no fatal async failure.
    assert.deepEqual(rejections, [], 'zero unhandled rejections during the outage');
    assert.deepEqual(exceptions, [], 'zero uncaught exceptions during the outage');
  } finally {
    globalThis.fetch = realFetch;
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// 3. Spawned process — the literal "did not crash" guarantee.
// ---------------------------------------------------------------------------

/** Reserves an ephemeral port, closes it, and returns the number. */
async function reservePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Polls health until the server answers; fails loudly if the child dies. */
async function waitForServer(base, child) {
  const deadline = Date.now() + 5000;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early (code ${child.exitCode}): ${stderr.slice(0, 300)}`);
    }
    try {
      const res = await fetch(`${base}/api/health`);
      await res.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`backend never became ready on ${base}: ${stderr.slice(0, 300)}`);
}

test('outage: the spawned backend process does not crash under a sustained outage', async () => {
  const serverPort = await reservePort();
  const deadPort = await reservePort(); // reserved then closed -> ECONNREFUSED

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(serverPort),
      MOCK_MODE: 'false',
      QLOO_BASE_URL: `http://127.0.0.1:${deadPort}`,
      QLOO_MAX_RETRIES: '0',
      QLOO_CACHE_ENABLED: 'false',
      INBOUND_RATE_LIMIT: '100',
      LOG_LEVEL: 'error',
      QLOO_API_KEY: 'offline-child-key',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Attach the exit listener SYNCHRONOUSLY so it settles no matter when
  // the child exits (a late `once('exit')` in finally would hang on an
  // already-dead child).
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // A keep-alive handle: node --test's harness can misread a momentarily
  // idle event loop (between awaited fetches) as "resolved" and cancel a
  // still-running subtest. An interval guarantees the loop stays live for
  // exactly the duration of this test.
  const keepAlive = setInterval(() => {}, 25);

  const base = `http://127.0.0.1:${serverPort}`;

  try {
    await waitForServer(base, child);
    assert.equal(child.exitCode, null, 'the process is alive after boot');

    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${base}/api/generate/worldbuilder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 'Blade Runner' }),
      });
      assert.equal(res.status, 502, `request ${i + 1}: clear 502 under outage`);
      const body = await res.json();
      assert.equal(body.error.code, 'QLOO_NETWORK');
      assert.equal(child.exitCode, null, `the process survived request ${i + 1}`);
    }

    // Still serving non-upstream routes after the burst.
    const categories = await fetch(`${base}/api/categories`);
    assert.equal(categories.status, 200, 'the process keeps serving after the outage');
    await categories.arrayBuffer();
    assert.equal(child.exitCode, null, 'the process is still alive and serving');
  } finally {
    clearInterval(keepAlive);
    child.kill('SIGKILL');
    await exited;
  }
});

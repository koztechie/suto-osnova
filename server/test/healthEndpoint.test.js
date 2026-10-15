import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Deterministic transport env BEFORE the module graph loads.
process.env.QLOO_API_KEY = 'health-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';

const { createHttpHandler } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');

const realFetch = globalThis.fetch;
let server;
let baseUrl;
let fetchCalls;

beforeEach(async () => {
  env.MOCK_MODE = true;
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network disabled');
  };
  server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  env.MOCK_MODE = true;
  await new Promise((resolve) => server.close(resolve));
});

function request(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json: JSON.parse(text),
          })
        );
      }
    );
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body));
    else req.end();
  });
}

// --- mock mode (offline-capable system) -------------------------------------

test('mock mode: 200 ok, no upstream probe, full system status', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['content-type'], 'application/json');

  const body = res.json;
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'suto-osnova');
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)), 'ISO timestamp');
  assert.equal(body.mockMode, true);
  assert.deepEqual(body.qloo, {
    mode: 'mock',
    status: 'mocked',
    reachable: null,
    checkedAt: body.qloo.checkedAt,
  });
  assert.ok(Date.parse(body.qloo.checkedAt), 'checkedAt is ISO');
  // Transport stats stay null in mock mode: loading the Qloo chain just
  // for stats would put ~7MB back on the request path (task 38).
  assert.equal(body.transport.rateLimiter, null);
  assert.equal(body.transport.cache, null);
  assert.match(body.transport.note, /not engaged/);
  assert.equal(fetchCalls, 0, 'mock mode never probes upstream');
});

// --- live mode ------------------------------------------------------------------

test('live probe=0: 200 skipped without upstream traffic', async () => {
  env.MOCK_MODE = false;
  const res = await request('/api/health?probe=0');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.qloo.mode, 'live');
  assert.equal(res.json.qloo.status, 'skipped');
  assert.equal(res.json.qloo.reachable, null);
  assert.equal(fetchCalls, 0, 'explicit skip means zero upstream calls');
});

test('live probe=false (string form) also skips', async () => {
  env.MOCK_MODE = false;
  const res = await request('/api/health?probe=false');
  assert.equal(res.status, 200);
  assert.equal(res.json.qloo.status, 'skipped');
  assert.equal(fetchCalls, 0);
});

test('live probe success: 200 ok with latency', async () => {
  env.MOCK_MODE = false;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.match(String(url), /\/$/, 'probe hits the documented GET / route');
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ title: 'Qloo', version: 'probe' }),
      text: async () => '',
    };
  };
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.qloo.reachable, true);
  assert.equal(res.json.qloo.status, 'ok');
  assert.equal(typeof res.json.qloo.latencyMs, 'number');
  assert.equal(fetchCalls, 1, 'exactly one probe');
  // The live probe loaded the transport chain, so stats come for free.
  assert.equal(typeof res.json.transport.rateLimiter, 'object');
  assert.equal(typeof res.json.transport.cache, 'object');
});

test('live probe failure: 503 degraded with typed error', async () => {
  env.MOCK_MODE = false;
  // fetch stays sabotaged by beforeEach
  const res = await request('/api/health');
  assert.equal(res.status, 503, 'orchestrators act on the status code');
  assert.equal(res.json.status, 'degraded');
  assert.equal(res.json.qloo.mode, 'live');
  assert.equal(res.json.qloo.reachable, false);
  assert.equal(res.json.qloo.status, 'unreachable');
  assert.ok(res.json.qloo.error.code, 'error code surfaced');
  assert.ok(fetchCalls >= 1);
});

test('health payload never echoes request input (no PII surface)', async () => {
  const res = await request('/api/health?probe=0&note=secret@example.com');
  const dump = JSON.stringify(res.json);
  assert.ok(!dump.includes('secret@example.com'));
  assert.ok(!dump.includes('receivedBody'));
});

// --- legacy contract preserved ----------------------------------------------------

test('non-health routes keep the legacy echo behavior', async () => {
  const get = await request('/anything');
  assert.equal(get.status, 200);
  assert.deepEqual(get.json, { status: 'ok', service: 'suto-osnova', receivedBody: null });

  const post = await request('/', { method: 'POST', body: { hello: 'world' } });
  assert.equal(post.status, 200);
  assert.deepEqual(post.json.receivedBody, { hello: 'world' });
});

test('/api/health is GET-only (POST falls to the legacy echo route)', async () => {
  const res = await request('/api/health', { method: 'POST', body: { x: 1 } });
  assert.equal(res.status, 200);
  assert.equal(res.json.service, 'suto-osnova');
  assert.equal(res.json.receivedBody.x, 1, 'legacy echo, not the health payload');
});

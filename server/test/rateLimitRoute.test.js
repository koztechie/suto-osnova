/**
 * Inbound client rate limiter gate (task 116) — spam protection for
 * the generate routes:
 *   - the ClientRateLimiter class (fixed window, the injected clock,
 *     window reset, the bounded-map eviction, the client key);
 *   - the HTTP enforcement (the burst beyond the limit -> 429
 *     RATE_LIMITED with Retry-After; per-client buckets via
 *     X-Forwarded-For; health/categories stay UNLIMITED);
 *   - the 429 envelope writer's crash safety.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A tiny limit so the burst trips fast (parsed by env at import).
process.env.QLOO_API_KEY = 'ratelimit-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.INBOUND_RATE_LIMIT = '3';
process.env.INBOUND_RATE_WINDOW_MS = '60000';

const { createHttpHandler } = await import('../src/app.js');
const {
  ClientRateLimiter, writeRateLimited,
} = await import('../src/middleware/rateLimit.js');

const realFetch = globalThis.fetch;
let server;
let baseUrl;

beforeEach(async () => {
  globalThis.fetch = async () => { throw new Error('network disabled'); };
  server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

function post(path, { body = {}, forwarded } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (forwarded) headers['X-Forwarded-For'] = forwarded;
    const req = http.request(`${baseUrl}${path}`, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        json: () => JSON.parse(data),
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
    }).on('error', reject);
  });
}

// --- the limiter class (injected clock) ---------------------------------------

test('the limiter counts within a window, then resets', () => {
  const limiter = new ClientRateLimiter({ windowMs: 1000, maxRequests: 2 });
  assert.equal(limiter.check('ip-a', 0).allowed, true);
  assert.equal(limiter.check('ip-a', 10).allowed, true);
  const blocked = limiter.check('ip-a', 20);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  // Past the window: the counter resets.
  assert.equal(limiter.check('ip-a', 1500).allowed, true);
});

test('the client key: the leftmost X-Forwarded-For hop, else the socket', () => {
  const limiter = new ClientRateLimiter({ windowMs: 1000, maxRequests: 5 });
  assert.equal(limiter.clientKey({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }), '1.1.1.1');
  assert.equal(limiter.clientKey({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
  assert.equal(limiter.clientKey({ headers: {} }), 'unknown');
});

test('the bounded map evicts, and stats reports', () => {
  const limiter = new ClientRateLimiter({ windowMs: 1000, maxRequests: 5, maxClients: 2 });
  limiter.check('a', 0);
  limiter.check('b', 0);
  limiter.check('c', 0); // triggers eviction (maxClients 2)
  assert.ok(limiter.stats.tracked <= 2, 'the map stays bounded');
  assert.equal(limiter.stats.maxRequests, 5);
  for (const bad of [{ windowMs: 0 }, { maxRequests: 0 }, { maxClients: 0 }]) {
    assert.throws(() => new ClientRateLimiter({ windowMs: 1, maxRequests: 1, ...bad }), TypeError);
  }
});

// --- HTTP enforcement ---------------------------------------------------------

test('the burst beyond the limit -> 429 RATE_LIMITED with Retry-After', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    statuses.push((await post('/api/generate/worldbuilder', { body: {} })).status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 429],
    'the first 3 consume the window; the 4th is rejected');

  const limited = await post('/api/generate/worldbuilder', { body: {} });
  assert.equal(limited.status, 429);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  assert.equal(limited.json().status, 'error');
  assert.ok(Number(limited.headers['retry-after']) >= 1, 'Retry-After rides');
  assert.ok(limited.headers['x-request-id'], 'the correlation header rides');
});

test('per-client buckets: a different X-Forwarded-For is a fresh window', async () => {
  for (let i = 0; i < 3; i += 1) {
    await post('/api/generate/antithesis', { body: {}, forwarded: '5.5.5.5' });
  }
  const blockedSame = await post('/api/generate/antithesis', { body: {}, forwarded: '5.5.5.5' });
  assert.equal(blockedSame.status, 429, 'the same client is exhausted');

  const otherClient = await post('/api/generate/antithesis', { body: {}, forwarded: '6.6.6.6' });
  assert.equal(otherClient.status, 400, 'a different client has its own bucket');
});

test('all three generate routes are protected; metadata routes are not', async () => {
  for (const route of ['worldbuilder', 'experiential', 'antithesis']) {
    for (let i = 0; i < 3; i += 1) {
      await post(`/api/generate/${route}`, { body: {}, forwarded: `7.7.7.${route.length}` });
    }
    const blocked = await post(`/api/generate/${route}`, { body: {}, forwarded: `7.7.7.${route.length}` });
    assert.equal(blocked.status, 429, `${route} is protected`);
  }
  // Health + categories are UNLIMITED (no generate pipeline behind them).
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await get('/api/categories')).status, 200);
    assert.equal((await get('/api/health')).status, 200);
  }
});

test('the 429 writer is crash-safe on a live stream', () => {
  const destroyed = { destroyed: false, headersSent: true,
    destroy() { this.destroyed = true; }, writeHead() {}, end() {} };
  writeRateLimited(destroyed, 'req', 1);
  assert.equal(destroyed.destroyed, true, 'a sent stream is destroyed, not corrupted');
});

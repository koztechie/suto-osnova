import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Cache enabled with a throwaway disk tier; run before the module loads.
const dir = await mkdtemp(path.join(tmpdir(), 'qloo-client-cache-'));
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '50';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '5';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_RETRY_BASE_MS = '10';
process.env.QLOO_CACHE_ENABLED = 'true';
process.env.QLOO_CACHE_TTL_MS = '60000';
process.env.QLOO_CACHE_TTL_ENTITIES_MS = '600000'; // 10min "24h-style" TTL
process.env.QLOO_CACHE_DIR = dir;
process.env.QLOO_CACHE_MAX_ENTRIES = '50';

const { qlooClient, QlooApiError, ttlForPathname } = await import(
  '../src/services/qlooClient.js'
);

const realFetch = globalThis.fetch;
let calls;

function mockResponse({ status = 200, body = { ok: true }, headers = {} } = {}) {
  const map = new Map(
    Object.entries({
      'content-type': 'application/json',
      ...Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
      ),
    })
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(async () => {
  await qlooClient.clearCache();
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ body: { value: calls.length } });
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await qlooClient.clearCache();
  await rm(dir, { recursive: true, force: true });
});

test('identical GETs hit upstream once, second is served from cache', async () => {
  const first = await qlooClient.get('/v2/insights', { ids: 'a' });
  const second = await qlooClient.get('/v2/insights', { ids: 'a' });

  assert.equal(calls.length, 1, 'only one upstream call');
  assert.deepEqual(first, second);
  assert.equal(qlooClient.cacheStats().hitsMemory, 1);
});

test('different parameters are cached separately', async () => {
  await qlooClient.get('/v2/insights', { ids: 'a' });
  await qlooClient.get('/v2/insights', { ids: 'b' });
  await qlooClient.get('/v2/insights', { ids: 'a' });

  assert.equal(calls.length, 2, 'a and b are distinct cache keys');
});

test('POST is NOT cached by default (non-idempotent safety)', async () => {
  await qlooClient.post('/v2/taste', { ids: 'a' });
  await qlooClient.post('/v2/taste', { ids: 'a' });

  assert.equal(calls.length, 2);
});

test('POST caches only with explicit opt-in', async () => {
  await qlooClient.post('/v2/taste', { ids: 'a' }, { cache: true });
  await qlooClient.post('/v2/taste', { ids: 'a' }, { cache: true });

  assert.equal(calls.length, 1);
});

test('cache: false bypasses the cache entirely (no read, no write)', async () => {
  await qlooClient.get('/v2/insights', { ids: 'a' }); // cached: value 1
  const fresh = await qlooClient.get('/v2/insights', { ids: 'a' }, { cache: false });
  const cached = await qlooClient.get('/v2/insights', { ids: 'a' });

  assert.equal(calls.length, 2, 'bypass forces an upstream call');
  assert.deepEqual(fresh, { value: 2 });
  assert.deepEqual(cached, { value: 1 }, 'bypass did not overwrite the cache');
});

test('different HTTP methods on the same URL get distinct keys', async () => {
  await qlooClient.get('/v2/insights', { ids: 'same' });
  await qlooClient.post('/v2/insights', { ids: 'same' }, { cache: true });

  assert.equal(calls.length, 2);
});

test('serves cached copy without touching upstream (dev quota saving)', async () => {
  const first = await qlooClient.get('/v2/insights', { ids: 'a' });

  // Upstream breaks entirely (network down).
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    throw Object.assign(new Error('read ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };

  const second = await qlooClient.get('/v2/insights', { ids: 'a' });
  assert.deepEqual(second, first, 'cache served the response');
  assert.equal(calls.length, 1, 'no new upstream attempts were made');
});

test('clearCache empties the cache for real', async () => {
  await qlooClient.get('/v2/insights', { ids: 'a' });
  await qlooClient.clearCache();
  await qlooClient.get('/v2/insights', { ids: 'a' });

  assert.equal(calls.length, 2, 'after clear, upstream is called again');
});

test('upstream errors are NOT cached', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ status: 500, body: { message: 'boom' } });
  };

  await assert.rejects(qlooClient.get('/v2/insights', { ids: 'err' }), QlooApiError);

  // Upstream recovers: next identical call must go upstream, not serve 500.
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ body: { recovered: true } });
  };
  const result = await qlooClient.get('/v2/insights', { ids: 'err' });

  assert.deepEqual(result, { recovered: true });
  assert.equal(calls.length, 2, 'error responses were not cached');
});

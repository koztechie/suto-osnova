import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Short general TTL + long "24h-style" entity/tag TTL: expiry behavior for
// both tiers becomes observable within milliseconds of test time.
const dir = await mkdtemp(path.join(tmpdir(), 'qloo-client-ttl-'));
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '50';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '5';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_CACHE_ENABLED = 'true';
process.env.QLOO_CACHE_TTL_MS = '80';
process.env.QLOO_CACHE_TTL_ENTITIES_MS = '600000';
process.env.QLOO_CACHE_DIR = dir;
process.env.QLOO_CACHE_MAX_ENTRIES = '50';

const { qlooClient, ttlForPathname } = await import('../src/services/qlooClient.js');

const realFetch = globalThis.fetch;
let calls;

function mockResponse(body = { ok: true }) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await qlooClient.clearCache();
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ n: calls.length });
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await qlooClient.clearCache();
  await rm(dir, { recursive: true, force: true });
});

test('ttlForPathname routes entities/tags to the long TTL', () => {
  // zod coerces env strings to numbers — compare against the same shapes.
  const long = Number(process.env.QLOO_CACHE_TTL_ENTITIES_MS);
  const short = Number(process.env.QLOO_CACHE_TTL_MS);

  assert.equal(ttlForPathname('/v2/entities'), long);
  assert.equal(ttlForPathname('/v2/entities/urn:llm:thing:1'), long);
  assert.equal(ttlForPathname('/v2/tags'), long);
  assert.equal(ttlForPathname('/v2/tags/urn:llm:tag:genre:1'), long);

  // Volatile endpoints and prefix look-alikes must NOT get the long TTL.
  assert.equal(ttlForPathname('/v2/insights'), short);
  assert.equal(ttlForPathname('/v2/taste'), short);
  assert.equal(ttlForPathname('/v2/search'), short);
  assert.equal(ttlForPathname('/v2/entitiesx'), short);
  assert.equal(ttlForPathname('/v1/entities'), short);
});

test('entities and tags are still cached after the general TTL expires', async () => {
  await qlooClient.get('/v2/entities', { ids: 'urn:llm:thing:1' });
  await qlooClient.get('/v2/tags', { ids: 'urn:llm:tag:1' });
  assert.equal(calls.length, 2);

  await tick(150); // past the 80ms general TTL, far below the long TTL

  await qlooClient.get('/v2/entities', { ids: 'urn:llm:thing:1' });
  await qlooClient.get('/v2/tags', { ids: 'urn:llm:tag:1' });
  assert.equal(calls.length, 2, 'entity/tag entries outlived the general TTL');
});

test('volatile endpoints expire after the general TTL', async () => {
  await qlooClient.get('/v2/insights', { ids: 'urn:llm:thing:1' });
  assert.equal(calls.length, 1);

  await tick(150); // past the 80ms general TTL

  await qlooClient.get('/v2/insights', { ids: 'urn:llm:thing:1' });
  assert.equal(calls.length, 2, 'volatile entry expired and was re-fetched');
});

test('stale-if-error uses each entry\'s own TTL for staleness', async () => {
  await qlooClient.get('/v2/insights', { ids: 'urn:llm:thing:1' });
  await qlooClient.get('/v2/entities', { ids: 'urn:llm:thing:1' });

  await tick(150); // general TTL expired; entity TTL still valid

  // Upstream dies completely.
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    throw Object.assign(new Error('read ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };

  // Volatile entry: expired, but stale-if-error serves it instead of failing.
  const insights = await qlooClient.get('/v2/insights', { ids: 'urn:llm:thing:1' });
  assert.deepEqual(insights, { n: 1 }, 'expired entry served as stale fallback');

  // Entity entry: still fresh under its 24h-style TTL — no upstream, no staleness.
  const entity = await qlooClient.get('/v2/entities', { ids: 'urn:llm:thing:1' });
  assert.deepEqual(entity, { n: 2 }, 'entity entry still fresh under long TTL');
  assert.equal(calls.length, 3, '1 insights + 1 entity + 1 failed insights retry');
});

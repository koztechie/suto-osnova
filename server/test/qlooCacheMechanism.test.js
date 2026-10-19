import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// CACHING MECHANISM suite (task 163): pins how the two-tier cache is
// WIRED into the client transport — single-flight interplay, disk-tier
// survival (restart + memory eviction), stale-if-error observability,
// the unconditional MOCK_MODE bypass, best-effort writes, and exact
// stats accounting. The cache class itself is pinned in qlooCache.test.js;
// plain hit/miss behavior lives in qlooClientCache.test.js and TTL
// routing in qlooClientTtl.test.js — this file covers the mechanism
// seams between them.
//
// Two TTL tiers make expiry observable in milliseconds: volatile
// endpoints (/v2/insights) expire after 80ms, entities/tags keep the
// long tier (10min stand-in for 24h) so multi-step tests cannot rot.
const dir = await mkdtemp(path.join(tmpdir(), 'qloo-cache-mechanism-'));
process.env.QLOO_API_KEY = 'test-key-mechanism';
process.env.QLOO_RATE_LIMIT = '50';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '5';
process.env.QLOO_RATE_QUEUE_MAX = '50';
process.env.QLOO_MAX_RETRIES = '0'; // failures resolve in one attempt
process.env.QLOO_RETRY_BASE_MS = '10';
process.env.QLOO_RETRY_MAX_MS = '100';
process.env.QLOO_CACHE_ENABLED = 'true';
process.env.QLOO_CACHE_TTL_MS = '80';
process.env.QLOO_CACHE_TTL_ENTITIES_MS = '600000';
process.env.QLOO_CACHE_DIR = dir;
process.env.QLOO_CACHE_MAX_ENTRIES = '2'; // eviction is reachable in-test
// The schema defaults MOCK_MODE to true — pin it off for the live seam.
process.env.MOCK_MODE = 'false';
process.env.LOG_LEVEL = 'error';

const { qlooClient, qlooResponseCache } = await import(
  '../src/services/qlooClient.js'
);

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

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stats deltas relative to a snapshot — stats accumulate per instance. */
const snapshotStats = () => ({ ...qlooClient.cacheStats() });
function statsDelta(before) {
  const now = qlooClient.cacheStats();
  const delta = {};
  for (const [key, value] of Object.entries(now)) {
    if (typeof value === 'number' && typeof before[key] === 'number') {
      delta[key] = value - before[key];
    }
  }
  return delta;
}

beforeEach(async () => {
  await qlooClient.clearCache();
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ served: calls.length });
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await qlooClient.clearCache();
  await rm(dir, { recursive: true, force: true });
});

test('mechanism: single-flight + cache — a concurrent batch costs ONE upstream call and ONE store', async () => {
  const before = snapshotStats();

  const [a, b, c] = await Promise.all([
    qlooClient.get('/v2/entities', { ids: 'batch' }),
    qlooClient.get('/v2/entities', { ids: 'batch' }),
    qlooClient.get('/v2/entities', { ids: 'batch' }),
  ]);

  assert.equal(calls.length, 1, 'the whole concurrent batch shares one upstream call');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  const afterBatch = statsDelta(before);
  assert.equal(afterBatch.stores, 1, 'the shared result is stored exactly once');

  // After the batch settles the flight is released and the cache answers.
  const later = await qlooClient.get('/v2/entities', { ids: 'batch' });
  assert.deepEqual(later, a, 'a later identical call gets the same body');
  assert.equal(calls.length, 1, 'and never touches upstream again');
  const delta = statsDelta(before);
  assert.equal(delta.hitsMemory, 1, 'the later call is a memory-tier hit');
  assert.equal(delta.misses, 1, 'exactly one miss (the batch) was recorded');
});

test('mechanism: single-flight never merges concurrent non-idempotent work', async () => {
  const before = snapshotStats();

  await Promise.all([
    qlooClient.post('/v2/taste', { entity: 'x' }, { cache: true }),
    qlooClient.post('/v2/taste', { entity: 'x' }, { cache: true }),
  ]);

  assert.equal(calls.length, 2,
    'concurrent identical POSTs both reach upstream (dedup is GET-only by design)');
  assert.equal(statsDelta(before).stores, 2, 'both results are stored');
});

test('mechanism: the disk tier answers a fresh instance after a restart, zero upstream cost', async () => {
  const first = await qlooClient.get('/v2/entities', { ids: 'restart-probe' });
  assert.equal(calls.length, 1);

  // Simulate `node --watch` / serverless cold start: a fresh module
  // instance (query-busted import) with an EMPTY memory tier but the
  // SAME disk directory.
  const restarted = await import('../src/services/qlooClient.js?restart=1');
  const cold = restarted.qlooClient.get.bind(restarted.qlooClient);
  const second = await cold('/v2/entities', { ids: 'restart-probe' });

  assert.deepEqual(second, first, 'the restart survivor returns the identical body');
  assert.equal(calls.length, 1, 'the cold start spent ZERO upstream quota');
  assert.equal(restarted.qlooClient.cacheStats().hitsDisk, 1,
    'the answer came from the disk tier');
});

test('mechanism: the cache key is body-sensitive — identical POSTs with different bodies never collide', async () => {
  // Both tiers are bounded by the same maxEntries, so memory eviction
  // also prunes the disk file (disk is a restart-survival tier, not an
  // overflow tier — pinned at class level in qlooCache.test.js). What
  // the CLIENT seam must guarantee is key IDENTITY: the canonical key
  // includes the request body, so a changed body can never serve the
  // previous answer.
  await qlooClient.post('/v2/taste', { entity: '坂本' }, { cache: true });
  await qlooClient.post('/v2/taste', { entity: 'Björk' }, { cache: true });
  assert.equal(calls.length, 2, 'different bodies are different cache entries');

  const repeatFirst = await qlooClient.post(
    '/v2/taste',
    { entity: '坂本' },
    { cache: true }
  );
  assert.deepEqual(repeatFirst, { served: 1 }, 'the first body hits its own entry');
  assert.equal(calls.length, 2, 'no upstream call for the repeated body');
});

test('mechanism: stale-if-error serves the expired entry AND records it in stats', async () => {
  const fresh = await qlooClient.get('/v2/insights', { ids: 'stale-probe' });
  assert.deepEqual(fresh, { served: 1 });

  await tick(120); // past the 80ms volatile TTL

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    throw Object.assign(new Error('read ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };
  const before = snapshotStats();

  const served = await qlooClient.get('/v2/insights', { ids: 'stale-probe' });

  assert.deepEqual(served, fresh, 'the expired copy unblocked the call');
  assert.equal(calls.length, 2, 'upstream was still given its one honest attempt');
  assert.equal(statsDelta(before).staleServed, 1,
    'the stale fallback is observable, not silent');
});

test('mechanism: MOCK_MODE never reads or writes the cache and never pollutes live traffic', async () => {
  // Fixture-backed call through the mock transport (no fetch involved).
  process.env.MOCK_MODE = 'true';
  const { env } = await import('../src/config/env.js');
  env.MOCK_MODE = true;
  try {
    const before = snapshotStats();
    const mockFirst = await qlooClient.get('/v2/tags', { 'filter.query': 'vegan', take: 3 });
    const mockSecond = await qlooClient.get('/v2/tags', { 'filter.query': 'vegan', take: 3 });

    assert.ok(mockFirst.results.tags.length > 0, 'the fixture answered');
    assert.deepEqual(mockSecond, mockFirst, 'fixtures are deterministic');
    assert.equal(calls.length, 0, 'MOCK_MODE never reaches the network');
    const delta = statsDelta(before);
    assert.equal(delta.stores, 0, 'the cache is never written under MOCK_MODE');
    assert.equal(delta.hitsMemory + delta.hitsDisk, 0, 'nor read');
  } finally {
    env.MOCK_MODE = false;
    process.env.MOCK_MODE = 'false';
  }

  // Live traffic afterwards starts from a pristine cache: nothing that
  // the mock served could ever have been stored under the same key.
  const before = snapshotStats();
  const live = await qlooClient.get('/v2/tags', { 'filter.query': 'vegan', take: 3 });
  assert.deepEqual(live, { served: 1 }, 'live traffic went to the (mocked) upstream');
  assert.equal(calls.length, 1, 'and paid for it honestly');
  assert.equal(statsDelta(before).stores, 1);
});

test('mechanism: a failing cache write never fails the request (best-effort set)', async () => {
  const originalSet = qlooResponseCache.set;
  qlooResponseCache.set = async () => {
    throw new Error('disk full');
  };
  try {
    const result = await qlooClient.get('/v2/entities', { ids: 'write-failure' });
    assert.deepEqual(result, { served: 1 }, 'the caller still gets the upstream body');
    assert.equal(calls.length, 1, 'exactly one upstream attempt — the error stayed inside');
  } finally {
    qlooResponseCache.set = originalSet;
  }

  // The un-stored key must go upstream again next time (no phantom entry).
  const again = await qlooClient.get('/v2/entities', { ids: 'write-failure' });
  assert.deepEqual(again, { served: 2 }, 'nothing poisoned the cache');
});

test('mechanism: stats account the full miss -> store -> hit lifecycle exactly', async () => {
  const before = snapshotStats();

  await qlooClient.get('/v2/entities', { ids: 'lifecycle' }); // miss + store
  await qlooClient.get('/v2/entities', { ids: 'lifecycle' }); // memory hit

  const delta = statsDelta(before);
  assert.equal(delta.misses, 1, 'one miss');
  assert.equal(delta.stores, 1, 'one store');
  assert.equal(delta.hitsMemory, 1, 'one memory hit');
  assert.equal(delta.hitsDisk, 0, 'the disk tier stayed out of the fast path');
  assert.equal(delta.failures, 0, 'a healthy lifecycle records no failures');
  assert.equal(delta.staleServed, 0, 'and no staleness');
});

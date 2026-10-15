import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QlooCache, hashCacheKey } from '../src/services/qlooCache.js';

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'qloo-cache-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('hashCacheKey is deterministic and input-sensitive', () => {
  const a = hashCacheKey({ q: 'x', page: 1 });
  const b = hashCacheKey({ q: 'x', page: 1 });
  const c = hashCacheKey({ q: 'y', page: 1 });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('serves from memory on second get (no disk read)', async () => {
  const cache = new QlooCache({ dir, ttlMs: 1000, maxEntries: 10 });
  const key = hashCacheKey({ a: 1 });

  await cache.set(key, { hits: 42 });
  const hit = await cache.get(key);

  assert.deepEqual(hit.data, { hits: 42 });
  assert.equal(hit.stale, false);
  assert.equal(cache.stats.hitsMemory, 1);
  assert.equal(cache.stats.hitsDisk, 0);
});

test('survives a "restart": fresh instance reads from disk tier', async () => {
  const first = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const key = hashCacheKey({ entity: 'urn:llm:thing:1' });
  await first.set(key, { name: 'persisted' });

  const second = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const hit = await second.get(key);

  assert.deepEqual(hit.data, { name: 'persisted' });
  assert.equal(hit.stale, false);
  assert.equal(second.stats.hitsDisk, 1);

  // Hydration: a third get must hit memory, not disk.
  await second.get(key);
  assert.equal(second.stats.hitsMemory, 1);
});

test('expires entries after TTL; allowStale still returns them', async () => {
  const cache = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const key = hashCacheKey({ q: 'ttl' });
  await cache.set(key, { v: 1 });

  await tick(60);

  assert.equal(await cache.get(key), null, 'fresh get must miss after TTL');

  const stale = await cache.get(key, { allowStale: true });
  assert.deepEqual(stale.data, { v: 1 });
  assert.equal(stale.stale, true);
  assert.ok(stale.ageMs >= 40);
});

test('stores only what it can clone back unchanged (isolation by copy)', async () => {
  const cache = new QlooCache({ dir, ttlMs: 1000, maxEntries: 10 });
  const key = hashCacheKey({ iso: true });
  const original = { nested: { list: [1, 2, 3] } };

  await cache.set(key, original);
  original.nested.list.push(999); // caller mutates after caching

  const hit = await cache.get(key);
  assert.deepEqual(hit.data.nested.list, [1, 2, 3], 'mutation must not leak');

  hit.data.nested.list.push(777); // caller mutates the returned copy
  const again = await cache.get(key);
  assert.deepEqual(again.data.nested.list, [1, 2, 3], 'reads must be isolated');
});

test('bounds memory tier by maxEntries (LRU eviction)', async () => {
  const cache = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 2 });

  await cache.set(hashCacheKey({ n: 1 }), { n: 1 });
  await cache.set(hashCacheKey({ n: 2 }), { n: 2 });
  await cache.get(hashCacheKey({ n: 1 })); // touch n:1 -> n:2 becomes LRU
  await cache.set(hashCacheKey({ n: 3 }), { n: 3 });

  // n:2 evicted from memory but still on disk -> served with hitsDisk.
  const evicted = await cache.get(hashCacheKey({ n: 2 }));
  assert.deepEqual(evicted.data, { n: 2 });
  assert.equal(cache.stats.hitsDisk, 1);
});

test('corrupt disk entry degrades to a miss, never throws', async () => {
  const cache = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const key = hashCacheKey({ corrupt: true });

  await cache.set(key, { good: true });
  await writeFile(path.join(dir, `${key}.json`), '{not json!');

  // Fresh instance: memory tier empty, disk tier corrupt.
  const fresh = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  assert.equal(await fresh.get(key), null);
  assert.equal(fresh.stats.failures, 0, 'corruption is a miss, not a failure');
});

test('unwritable directory does not break set() (best-effort persistence)', async () => {
  const cache = new QlooCache({
    dir: path.join(dir, 'locked', 'deep', 'path'), // parent is a file -> EENOTDIR
    ttlMs: 60_000,
    maxEntries: 10,
  });
  await writeFile(path.join(dir, 'locked'), 'i am a file');

  const key = hashCacheKey({ besteffort: true });
  await cache.set(key, { ok: true }); // must not throw

  // Memory tier still works.
  const hit = await cache.get(key);
  assert.deepEqual(hit.data, { ok: true });
  assert.ok(cache.stats.failures >= 1, 'failure was recorded');
});

test('clear() empties both tiers', async () => {
  const cache = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  await cache.set(hashCacheKey({ c: 1 }), { c: 1 });
  await cache.set(hashCacheKey({ c: 2 }), { c: 2 });

  await cache.clear();

  assert.equal(await cache.get(hashCacheKey({ c: 1 })), null);
  assert.equal(await cache.get(hashCacheKey({ c: 2 })), null);
  const files = await readdir(dir);
  assert.equal(files.filter((f) => f.endsWith('.json')).length, 0);
});

test('prunes oldest disk files beyond maxEntries', async () => {
  const cache = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 3 });

  for (let n = 1; n <= 6; n += 1) {
    await cache.set(hashCacheKey({ n }), { n });
    await tick(5); // distinct mtimes for deterministic ordering
  }

  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 3, 'disk tier bounded by maxEntries');

  const survivor = JSON.parse(
    await readFile(path.join(dir, files[0]), 'utf8')
  );
  assert.equal(typeof survivor.cachedAt, 'number');
  assert.ok(survivor.data.n >= 4, 'newest entries survive pruning');
});

test('disabled cache is a no-op', async () => {
  const cache = new QlooCache({ dir, enabled: false });
  const key = hashCacheKey({ off: true });

  await cache.set(key, { v: 1 });
  assert.equal(await cache.get(key), null);
  assert.equal(cache.stats.stores, 0);
});

test('rejects invalid constructor options', () => {
  assert.throws(() => new QlooCache({ ttlMs: -1 }), TypeError);
  assert.throws(() => new QlooCache({ dir: '' }), TypeError);
  assert.throws(() => new QlooCache({ maxEntries: 0 }), TypeError);
  assert.throws(() => new QlooCache({ enabled: 'yes' }), TypeError);
});

test('per-entry TTL outlives the cache-wide default TTL', async () => {
  const cache = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const key = hashCacheKey({ entity: 'long-lived' });

  await cache.set(key, { name: 'movie' }, { ttlMs: 60_000 }); // 24h-style
  await tick(60); // past the 40ms default TTL

  const hit = await cache.get(key);
  assert.ok(hit, 'entry with long per-entry TTL must survive default expiry');
  assert.equal(hit.stale, false);
  assert.equal(hit.ttlMs, 60_000, 'hit reports its validated lifetime');
});

test('entries without per-entry TTL use the default TTL', async () => {
  const cache = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const key = hashCacheKey({ volatile: 'data' });

  await cache.set(key, { v: 1 }); // no per-entry TTL
  await tick(60);

  assert.equal(await cache.get(key), null, 'default TTL applied and expired');
});

test('per-entry TTL survives a restart via the disk tier', async () => {
  const key = hashCacheKey({ entity: 'persisted-ttl' });

  const first = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  await first.set(key, { name: 'movie' }, { ttlMs: 60_000 });

  await tick(60); // past the default TTL of a fresh instance

  const second = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const hit = await second.get(key);
  assert.ok(hit, 'disk entry kept its 24h-style lifetime across restart');
  assert.equal(hit.ttlMs, 60_000);
  assert.equal(hit.stale, false);
});

test('TTL validation: invalid per-entry TTL on write falls back to default', async () => {
  const cache = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const key = hashCacheKey({ bad: 'ttl' });

  await cache.set(key, { v: 1 }, { ttlMs: -5 }); // invalid — must not throw
  await tick(60);

  assert.equal(await cache.get(key), null, 'fell back to the 40ms default');
  assert.ok(cache.stats.failures >= 1, 'invalid TTL was recorded');
});

test('TTL validation: corrupt per-entry TTL on disk falls back to default', async () => {
  const cache = new QlooCache({ dir, ttlMs: 40, maxEntries: 10 });
  const key = hashCacheKey({ corrupt: 'ttl' });

  // Hand-write an entry with a corrupt TTL value.
  await writeFile(
    path.join(dir, `${key}.json`),
    JSON.stringify({
      v: 1,
      cachedAt: Date.now() - 100, // older than the 40ms default TTL
      ttlMs: 'twenty-four-hours', // corrupt shape
      data: { v: 1 },
    })
  );

  assert.equal(await cache.get(key), null, 'corrupt TTL -> default TTL -> expired');

  // allowStale still serves it, reporting the validated default lifetime.
  const stale = await cache.get(key, { allowStale: true });
  assert.equal(stale.ttlMs, 40);
  assert.equal(stale.stale, true);
});

test('TTL validation: per-entry TTL of 0 disables reuse of that entry', async () => {
  const cache = new QlooCache({ dir, ttlMs: 60_000, maxEntries: 10 });
  const key = hashCacheKey({ zero: 'ttl' });

  await cache.set(key, { v: 1 }, { ttlMs: 0 }); // valid, but immediately stale

  assert.equal(await cache.get(key), null, 'TTL 0 == never reusable');
});

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MOCK_MODE BEFORE the module graph loads (env.js reads process.env once).
// Cache is deliberately ENABLED here: mock mode must bypass it entirely.
const cacheDir = await mkdtemp(path.join(tmpdir(), 'qloo-mock-'));
process.env.QLOO_API_KEY = 'test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'true';
process.env.QLOO_CACHE_DIR = cacheDir;
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';

const { qlooClient } = await import('../src/services/qlooClient.js');
const { searchEntities } = await import('../src/services/entitySearchClient.js');
const { findTags } = await import('../src/services/tasteTagsClient.js');
const { getCrossDomainAffinities } = await import(
  '../src/services/crossDomainClient.js'
);
const { getAudienceInsights, searchAudiences } = await import(
  '../src/services/audienceInsightsClient.js'
);
const {
  findMockFixture,
  MockFixtureNotFoundError,
} = await import('../src/services/qlooMock.js');
const { deterministicMockId } = await import('../src/mocks/qlooFixtures.js');
const { setSink, resetSink } = await import('../src/logger.js');

const PHOBBE = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';
const OUTDOORS = 'urn:audience:hobbies_and_interests:outdoors';
const UUID_RE =
  /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

beforeEach(() => {
  // Hard offline proof: ANY attempt to reach the network explodes.
  globalThis.fetch = async () => {
    throw new Error('network disabled: this test must run fully offline');
  };
});

after(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

// --- the autonomous-operation proof -------------------------------------------

test('every service client works fully offline (fetch sabotaged)', async () => {
  // 1. entity search (task 20)
  const search = await searchEntities('Severance', 'tv_show');
  assert.equal(search.results[0].name, 'Severance');
  assert.equal(search.results[0].subtype, 'urn:entity:tv_show');
  assert.equal(search.results[0].releaseYear, 2022);

  // 2. taste tags (task 21)
  const tags = await findTags(PHOBBE, 'genre:media');
  assert.equal(tags.results[0].name, 'Romance');
  assert.equal(tags.results[0].type, 'urn:tag:genre:media');

  // 3. cross-domain affinities (task 22)
  const cross = await getCrossDomainAffinities(PHOBBE, 'movie', { take: 3 });
  assert.equal(cross.count, 3);
  assert.equal(cross.results[0].name, 'Promising Young Woman');
  assert.ok(cross.results[0].affinity > 0.9, 'realistic affinity score');
  assert.deepEqual(cross.results[0].explain, { [PHOBBE]: 1 });
  assert.ok(
    cross.explainability['signal.interests.entities'].top3.length > 0,
    'aggregate attribution present when requested'
  );

  // 4. audience insights (task 23)
  const audience = await getAudienceInsights({
    targetDomain: 'place',
    audiences: OUTDOORS,
  });
  assert.equal(audience.results[0].name, 'Vanier Park');
  assert.equal(audience.results[0].city, 'Vancouver');

  // 5. audience discovery (task 23)
  const found = await searchAudiences('outdoors');
  assert.equal(found.results[0].id, OUTDOORS);
  assert.equal(found.results[0].name, 'Outdoors');
});

test('domain mapping (task 24) round-trips on mock search results', async () => {
  const { classifyEntity } = await import('../src/services/domainMapper.js');
  const lucali = await searchEntities('Lucali pizza Brooklyn', 'place');
  assert.equal(lucali.results[0].name, 'Lucali');
  assert.equal(
    classifyEntity(lucali.results[0]),
    'dining',
    'restaurant tag families survive the mock pipeline'
  );

  const nike = await searchEntities('Nike', 'brand');
  assert.equal(classifyEntity(nike.results[0]), 'fashion');
});

test('privacy guard (task 25) still runs in mock mode', async () => {
  // The sanitization seam is upstream of the mock branch: a tainted param
  // is redacted before the fixture matcher even sees it.
  const lines = [];
  process.env.LOG_LEVEL = 'warn';
  setSink((line) => lines.push(line));
  try {
    await searchEntities('Severance', 'tv_show', {
      extra: { 'x-note': 'mail me at offline@example.com' },
    }).catch(() => {});
  } finally {
    resetSink();
    delete process.env.LOG_LEVEL;
  }
  assert.ok(
    lines.some((l) => l.includes('privacy guard')),
    'the guard fired before the mock served the fixture'
  );
});

// --- fallbacks -------------------------------------------------------------------

test('unknown queries get deterministic skeleton fallbacks', async () => {
  const first = await searchEntities('Inception', 'movie');
  assert.equal(first.count, 1);
  assert.equal(first.results[0].name, 'Inception', 'name mirrors the query');
  assert.match(first.results[0].id, UUID_RE, 'realistic deterministic UUID');

  const again = await searchEntities('Inception', 'movie');
  assert.deepEqual(again.results, first.results, 'stable across calls');

  const other = await searchEntities('Interstellar', 'movie');
  assert.notEqual(other.results[0].id, first.results[0].id, 'query-sensitive');
});

test('fallbacks respect take and target type', async () => {
  const tags = await qlooClient.get('/v2/tags', { 'filter.query': 'vegan', take: 3 });
  assert.equal(tags.results.tags.length, 3, 'take is honored by the fallback');

  const podcasts = await getCrossDomainAffinities(PHOBBE, 'urn:entity:podcast');
  assert.equal(podcasts.count, 2, 'honest skeletons for un-pooled types');
  assert.equal(podcasts.results[0].subtype, 'urn:entity:podcast');
});

test('unknown endpoints fail loudly instead of inventing data', async () => {
  await assert.rejects(
    qlooClient.get('/v2/trending', { take: 1 }),
    (err) => {
      assert.ok(err instanceof MockFixtureNotFoundError);
      assert.equal(err.code, 'MOCK_FIXTURE_NOT_FOUND');
      assert.match(err.message, /\/v2\/trending/);
      assert.match(err.message, /qlooFixtures\.js/, 'message says how to fix');
      return true;
    }
  );
});

// --- mock-mode invariants ----------------------------------------------------------

test('mock mode never touches the cache (cache enabled on purpose)', () => {
  const stats = qlooClient.cacheStats();
  assert.equal(
    stats.entries,
    0,
    'no fixture may pollute the disk cache that live traffic reads'
  );
  assert.equal(stats.misses, 0, 'the cache was never even consulted');
});

test('object fixtures are cloned: caller mutation cannot corrupt the registry', async () => {
  const a = await searchEntities('Severance', 'tv_show');
  a.results[0].name = 'MUTATED';
  a.results[0].description = 'tampered';

  const b = await searchEntities('Severance', 'tv_show');
  assert.equal(b.results[0].name, 'Severance');
  assert.ok(b.results[0].description.includes('Lumon'), 'nested data intact');
});

test('explainability appears only when requested (mirrors live behavior)', async () => {
  const plain = await getCrossDomainAffinities(PHOBBE, 'movie', {
    explainability: false,
  });
  assert.equal(plain.results[0].explain, null);
  assert.equal(plain.explainability, null);

  const explained = await getCrossDomainAffinities(PHOBBE, 'movie');
  assert.deepEqual(explained.results[0].explain, { [PHOBBE]: 1 });
});

// --- matcher unit tests -------------------------------------------------------------

test('findMockFixture matches declared params (any-of arrays) with fallback priority', () => {
  const url = (q) => new URL(`https://mock.test${q}`);
  assert.equal(
    findMockFixture('GET', url('/search?query=Severance&types=urn%3Aentity%3Atv_show')).name,
    'search:severance-tv'
  );
  assert.equal(
    findMockFixture('GET', url('/search?query=whatever')).name,
    'fallback:search',
    'unmatched search falls back'
  );
  assert.equal(
    findMockFixture('POST', url('/search?query=Severance')),
    null,
    'method must match'
  );
  assert.equal(
    findMockFixture('GET', url('/v2/tags?filter.tag.types=urn%3Atag%3Agenre%3Amedia')).name,
    'tags:genres-media'
  );
});

test('deterministicMockId is UUID-shaped, stable and collision-resistant', () => {
  assert.match(deterministicMockId('seed-1'), UUID_RE);
  assert.equal(deterministicMockId('seed-1'), deterministicMockId('seed-1'));
  assert.notEqual(deterministicMockId('seed-1'), deterministicMockId('seed-2'));
});

// --- configuration (fresh processes) -------------------------------------------------

test('MOCK_MODE defaults to false and rejects garbage values', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envModule = path.join(here, '../src/config/env.js');
  const load = (overrides) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { env } from ${JSON.stringify(envModule)}; console.log(env.MOCK_MODE);`,
      ],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, QLOO_API_KEY: 'test-key', ...overrides },
      }
    );

  assert.equal(load({}).stdout.trim(), 'false', 'unset -> false');
  assert.equal(load({ MOCK_MODE: 'false' }).stdout.trim(), 'false', '"false" stays false');
  assert.equal(load({ MOCK_MODE: 'true' }).stdout.trim(), 'true');

  const bad = load({ MOCK_MODE: 'yes' });
  assert.notEqual(bad.status, 0, 'garbage values must fail config validation');
  assert.match(bad.stderr, /MOCK_MODE/);
});

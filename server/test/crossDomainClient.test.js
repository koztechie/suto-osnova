import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Transport-independent tests: cache off, generous limiter, no retries.
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  getCrossDomainAffinities,
  resolveEntityIds,
  resolveTargetDomain,
  normalizeAffinityEntity,
  CrossDomainAffinityError,
  TARGET_DOMAINS,
  INSIGHTS_PATH,
} = await import('../src/services/crossDomainClient.js');
const { QlooApiError, ttlForPathname } = await import(
  '../src/services/qlooClient.js'
);
const { env } = await import('../src/config/env.js');

const realFetch = globalThis.fetch;
const ARTIST = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';
const MOVIE = '969911E8-7092-43D9-8C7D-C7547EAE3C00';

let calls;

/** Entity shape as returned by the LIVE insights host. */
function liveEntity(overrides = {}) {
  return {
    name: 'Promising Young Woman',
    entity_id: 'E39A5CE6-5991-46B9-897D-4B23A494804A',
    type: 'urn:entity',
    subtype: 'urn:entity:movie',
    properties: {},
    popularity: 0.9933691872394652,
    query: { affinity: 0.9445416539735196 },
    ...overrides,
  };
}

function insightsPayload(entities = [], extra = {}) {
  return { success: true, results: { entities }, ...extra };
}

function mockOk(bodyFactory) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => bodyFactory(),
      text: async () => '',
    };
  };
}

beforeEach(() => {
  calls = [];
  mockOk(() => insightsPayload([liveEntity()]));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- transport integration --------------------------------------------------

test('issues GET /v2/insights with signals, target type, take and auth', async () => {
  await getCrossDomainAffinities(ARTIST, 'movie', { take: 5 });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, INSIGHTS_PATH);
  assert.equal(url.pathname, '/v2/insights');
  assert.equal(url.searchParams.get('filter.type'), 'urn:entity:movie');
  assert.equal(url.searchParams.get('signal.interests.entities'), ARTIST);
  assert.equal(url.searchParams.get('take'), '5');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.equal(calls[0].options.method, 'GET');
});

test('explainability is ON by default (attribution is the point)', async () => {
  await getCrossDomainAffinities(ARTIST, 'movie');
  assert.equal(
    new URL(calls[0].url).searchParams.get('feature.explainability'),
    'true'
  );

  await getCrossDomainAffinities(ARTIST, 'movie', { explainability: false });
  assert.equal(
    new URL(calls[1].url).searchParams.has('feature.explainability'),
    false,
    'explicit false omits the param (server default applies)'
  );
});

test('joins and deduplicates multiple signal ids, preserving order', async () => {
  await getCrossDomainAffinities([ARTIST, MOVIE, ARTIST], 'movie');
  assert.equal(
    new URL(calls[0].url).searchParams.get('signal.interests.entities'),
    `${ARTIST},${MOVIE}`,
    'a repeated id must not double its affinity weight'
  );

  await getCrossDomainAffinities(`${ARTIST}, ${MOVIE}`, 'movie');
  assert.equal(
    new URL(calls[1].url).searchParams.get('signal.interests.entities'),
    `${ARTIST},${MOVIE}`,
    'comma-separated strings are split and trimmed'
  );
});

test('sends weight, sortBy and biasTrends when provided', async () => {
  await getCrossDomainAffinities(ARTIST, 'place', {
    weight: 'high',
    sortBy: 'affinity',
    biasTrends: 'low',
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('signal.interests.entities.weight'), 'high');
  assert.equal(url.searchParams.get('sort_by'), 'affinity');
  assert.equal(url.searchParams.get('bias.trends'), 'low');
});

test('supports documented page pagination (page preferred over offset)', async () => {
  await getCrossDomainAffinities(ARTIST, 'movie', { page: 2 });
  let url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.has('offset'), false);

  await getCrossDomainAffinities(ARTIST, 'movie', { offset: 10 });
  url = new URL(calls[1].url);
  assert.equal(url.searchParams.get('offset'), '10');
  assert.equal(url.searchParams.has('page'), false);
});

// --- entity id validation -----------------------------------------------------

test('resolveEntityIds accepts strings, arrays and rejects bad ids', () => {
  assert.deepEqual(resolveEntityIds(ARTIST), [ARTIST]);
  assert.deepEqual(resolveEntityIds([ARTIST, ARTIST]), [ARTIST]);
  assert.deepEqual(resolveEntityIds(`${ARTIST},, ${MOVIE}`), [ARTIST, MOVIE]);

  for (const bad of [[], ['', '  '], [42], ['id with space'], [null, undefined]]) {
    assert.throws(
      () => resolveEntityIds(bad),
      (err) => {
        assert.ok(err instanceof CrossDomainAffinityError);
        assert.equal(err.code, 'INVALID_ENTITY_IDS');
        return true;
      },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
  assert.throws(() => resolveEntityIds('x'.repeat(129)), (err) => {
    assert.equal(err.code, 'INVALID_ENTITY_IDS');
    return true;
  });
  assert.throws(() => resolveEntityIds(Array(101).fill(ARTIST)), (err) => {
    assert.equal(err.code, 'INVALID_ENTITY_IDS');
    return true;
  }, 'the 100-signal safety rail');
});

test('invalid entity ids fail synchronously with no network call', () => {
  assert.throws(
    () => getCrossDomainAffinities([], 'movie'),
    (err) => {
      assert.equal(err.code, 'INVALID_ENTITY_IDS');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

// --- target domain resolution ---------------------------------------------------

test('resolveTargetDomain maps friendly names, aliases and folds', () => {
  assert.equal(resolveTargetDomain('movie'), 'urn:entity:movie');
  assert.equal(resolveTargetDomain('film'), 'urn:entity:movie');
  assert.equal(resolveTargetDomain('tv'), 'urn:entity:tv_show');
  assert.equal(resolveTargetDomain('music'), 'urn:entity:artist');
  assert.equal(resolveTargetDomain('actor'), 'urn:entity:person');
  assert.equal(resolveTargetDomain('game'), 'urn:entity:videogame');
  assert.equal(resolveTargetDomain('  Movie '), 'urn:entity:movie');
  // live-verified spellings that differ from the OpenAPI enum
  assert.equal(resolveTargetDomain('videogame'), 'urn:entity:videogame');
  assert.equal(resolveTargetDomain('video_game'), 'urn:entity:videogame');
  assert.equal(resolveTargetDomain('destination'), 'urn:entity:destination');
});

test('resolveTargetDomain passes raw URNs through (future-proofing)', () => {
  assert.equal(
    resolveTargetDomain('urn:entity:brand_new_type'),
    'urn:entity:brand_new_type'
  );
  assert.equal(resolveTargetDomain('URN:ENTITY:MOVIE'), 'urn:entity:movie');
});

test('resolveTargetDomain rejects heatmap, deprecated audience and junk', () => {
  for (const [bad, code] of [
    ['urn:heatmap', 'INVALID_TARGET_DOMAIN'],
    ['urn:entity:audience', 'INVALID_TARGET_DOMAIN'],
    ['spaceship', 'INVALID_TARGET_DOMAIN'],
    ['', 'INVALID_TARGET_DOMAIN'],
    [null, 'INVALID_TARGET_DOMAIN'],
    [42, 'INVALID_TARGET_DOMAIN'],
  ]) {
    assert.throws(
      () => resolveTargetDomain(bad),
      (err) => {
        assert.ok(err instanceof CrossDomainAffinityError);
        assert.equal(err.code, code);
        return true;
      },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
});

test('every TARGET_DOMAINS value is a well-formed entity URN', () => {
  for (const [name, urn] of Object.entries(TARGET_DOMAINS)) {
    assert.match(urn, /^urn:entity:[a-z0-9_]+$/, `domain ${name}`);
  }
});

// --- options validation ---------------------------------------------------------

test('clamps take to the documented 1..50, default 20, rejects junk', async () => {
  await getCrossDomainAffinities(ARTIST, 'movie', { take: 999 });
  await getCrossDomainAffinities(ARTIST, 'movie', { take: 0 });
  await getCrossDomainAffinities(ARTIST, 'movie');
  assert.equal(new URL(calls[0].url).searchParams.get('take'), '50');
  assert.equal(new URL(calls[1].url).searchParams.get('take'), '1');
  assert.equal(new URL(calls[2].url).searchParams.get('take'), '20');

  assert.throws(
    () => getCrossDomainAffinities(ARTIST, 'movie', { take: 'lots' }),
    (err) => {
      assert.equal(err.code, 'INVALID_TAKE');
      return true;
    }
  );
  assert.equal(calls.length, 3, 'invalid take made no request');
});

test('validates page, offset, weight, flags, sortBy and biasTrends', () => {
  const cases = [
    [{ page: 0 }, 'INVALID_PAGE'],
    [{ page: 101 }, 'INVALID_PAGE'],
    [{ page: 2.5 }, 'INVALID_PAGE'],
    [{ page: '2' }, 'INVALID_PAGE'],
    [{ offset: -1 }, 'INVALID_OFFSET'],
    [{ weight: -1 }, 'INVALID_WEIGHT'],
    [{ weight: 'strong' }, 'INVALID_WEIGHT'],
    [{ weight: NaN }, 'INVALID_WEIGHT'],
    [{ explainability: 'yes' }, 'INVALID_FEATURE_FLAG'],
    [{ sortBy: 'distance_asc' }, 'INVALID_SORT_BY'],
    [{ biasTrends: 'extreme' }, 'INVALID_BIAS_TRENDS'],
  ];
  for (const [options, code] of cases) {
    assert.throws(
      () => getCrossDomainAffinities(ARTIST, 'movie', options),
      (err) => {
        assert.ok(err instanceof CrossDomainAffinityError);
        assert.equal(err.code, code);
        return true;
      },
      `expected ${code} for ${JSON.stringify(options)}`
    );
  }
  assert.equal(calls.length, 0, 'no request was made for invalid options');
});

test('weight accepts documented numbers and weight words', async () => {
  await getCrossDomainAffinities(ARTIST, 'movie', { weight: 0.75 });
  assert.equal(
    new URL(calls[0].url).searchParams.get('signal.interests.entities.weight'),
    '0.75'
  );
  await getCrossDomainAffinities(ARTIST, 'movie', { weight: 0 });
  assert.equal(
    new URL(calls[1].url).searchParams.get('signal.interests.entities.weight'),
    '0',
    'weight 0 is meaningful (not a selector) and must be sent'
  );
});

test('rejects reserved/complex extra params and passes scalars through', async () => {
  assert.throws(
    () => getCrossDomainAffinities(ARTIST, 'movie', { extra: { take: 5 } }),
    (err) => {
      assert.equal(err.code, 'RESERVED_PARAM');
      return true;
    }
  );
  assert.throws(
    () =>
      getCrossDomainAffinities(ARTIST, 'movie', {
        extra: { 'filter.type': 'x' },
      }),
    (err) => {
      assert.equal(err.code, 'RESERVED_PARAM');
      return true;
    }
  );
  assert.throws(
    () =>
      getCrossDomainAffinities(ARTIST, 'movie', {
        extra: { 'filter.tags': ['a'] },
      }),
    (err) => {
      assert.equal(err.code, 'INVALID_EXTRA');
      return true;
    }
  );
  assert.equal(calls.length, 0);

  await getCrossDomainAffinities(ARTIST, 'movie', {
    extra: { 'filter.popularity.min': 0.5 },
  });
  assert.equal(
    new URL(calls[0].url).searchParams.get('filter.popularity.min'),
    '0.5'
  );
});

// --- response normalization -------------------------------------------------------

test('normalizes the live entity shape with attribution and measurements', async () => {
  mockOk(() =>
    insightsPayload([
      liveEntity({
        properties: {
          description: 'A woman goes on a vigilante mission.',
          image: { url: 'https://img.example/x.jpg' },
          release_year: 2020,
          release_date: '2020-12-25',
          duration: 113,
          content_rating: 'R',
          geocode: { name: 'London', country_code: 'GB' },
        },
        query: {
          affinity: 0.9445,
          affinity_rank: 0.91,
          measurements: { audience_growth: 0.12 },
          explainability: {
            'signal.interests.entities': [
              { entity_id: ARTIST, score: 0.5456 },
              { entity_id: MOVIE, score: 0.4543 },
            ],
          },
        },
        tags: [
          { id: 'urn:tag:genre:media:drama', name: 'Drama', type: 'urn:tag:genre:media' },
        ],
      }),
    ])
  );

  const result = await getCrossDomainAffinities([ARTIST, MOVIE], 'movie', {
    take: 5,
  });

  assert.deepEqual(result.sourceEntityIds, [ARTIST, MOVIE]);
  assert.equal(result.targetType, 'urn:entity:movie');
  assert.equal(result.take, 5);
  assert.equal(result.page, null);
  assert.equal(result.offset, null);
  assert.equal(result.count, 1);

  const [entity] = result.results;
  assert.equal(entity.id, 'E39A5CE6-5991-46B9-897D-4B23A494804A');
  assert.equal(entity.name, 'Promising Young Woman');
  assert.equal(entity.subtype, 'urn:entity:movie');
  assert.equal(entity.popularity, 0.9933691872394652);
  assert.equal(entity.affinity, 0.9445);
  assert.equal(entity.affinityRank, 0.91);
  assert.deepEqual(entity.explain, { [ARTIST]: 0.5456, [MOVIE]: 0.4543 });
  assert.deepEqual(entity.measurements, { audience_growth: 0.12 });
  assert.equal(entity.description, 'A woman goes on a vigilante mission.');
  assert.equal(entity.imageUrl, 'https://img.example/x.jpg');
  assert.equal(entity.releaseYear, 2020);
  assert.equal(entity.releaseDate, '2020-12-25');
  assert.equal(entity.duration, 113);
  assert.equal(entity.contentRating, 'R');
  assert.equal(entity.city, 'London');
  assert.equal(entity.countryCode, 'GB');
  assert.equal(entity.tags[0].name, 'Drama');
});

test('normalizes the aggregate explainability (effect_on_topN_recs)', async () => {
  mockOk(() =>
    insightsPayload([liveEntity()], {
      query: {
        explainability: {
          'signal.interests.entities': {
            effect_on_top3_recs: [
              { entity_id: MOVIE, avg_score: 0.5316 },
              { entity_id: ARTIST, avg_score: 0.4683 },
            ],
            effect_on_top5_recs: [{ entity_id: MOVIE, avg_score: 0.5316 }],
            unexpected_shape: 'ignored-tolerantly',
          },
          warning: 'partial attribution',
        },
      },
    })
  );

  const result = await getCrossDomainAffinities(ARTIST, 'movie');
  const interests = result.explainability['signal.interests.entities'];
  assert.deepEqual(interests.top3, [
    { entityId: MOVIE, avgScore: 0.5316 },
    { entityId: ARTIST, avgScore: 0.4683 },
  ]);
  assert.deepEqual(interests.top5, [{ entityId: MOVIE, avgScore: 0.5316 }]);
  assert.equal(result.explainability.warning, 'partial attribution');
});

test('aggregate explainability is null when absent; explain tolerates shapes', async () => {
  const plain = await getCrossDomainAffinities(ARTIST, 'movie');
  assert.equal(plain.explainability, null);
  assert.equal(plain.results[0].explain, null, 'no attribution -> null');

  // object-map explainability form (tolerated variant)
  mockOk(() =>
    insightsPayload([
      liveEntity({
        query: {
          affinity: 0.9,
          explainability: {
            'signal.interests.entities': { [ARTIST]: 0.7, [MOVIE]: 0.3 },
          },
        },
      }),
    ])
  );
  const mapped = await getCrossDomainAffinities(ARTIST, 'movie');
  assert.deepEqual(mapped.results[0].explain, { [ARTIST]: 0.7, [MOVIE]: 0.3 });
});

test('skips malformed items, falls back to id, tolerates odd tags', async () => {
  mockOk(() =>
    insightsPayload([
      null,
      'not-an-object',
      { name: 'No Id' },
      { entity_id: 'NO-NAME' },
      { id: 'fallback-id', name: 'Uses id field' },
      liveEntity({ tags: [null, { tag_id: 'urn:tag:x', name: 'X' }, { name: 'OnlyName' }] }),
    ])
  );

  const result = await getCrossDomainAffinities(ARTIST, 'movie');
  assert.equal(result.count, 2);
  assert.equal(result.results[0].id, 'fallback-id');
  assert.deepEqual(result.results[1].tags, [
    { id: 'urn:tag:x', name: 'X', type: null },
    { id: null, name: 'OnlyName', type: null },
  ]);
});

test('treats missing entity lists as an empty match set', async () => {
  mockOk(() => ({ success: true }));
  const result = await getCrossDomainAffinities(ARTIST, 'movie');
  assert.equal(result.count, 0);
  assert.deepEqual(result.results, []);
});

test('rejects non-object payloads and success=false', async () => {
  for (const [body, expectedCode] of [
    ['null', 'MALFORMED_RESPONSE'],
    ['[1,2]', 'MALFORMED_RESPONSE'],
    ['{"success":false,"message":"bad"}', 'UPSTREAM_ERROR'],
  ]) {
    mockOk(() => JSON.parse(body));
    await assert.rejects(
      getCrossDomainAffinities(ARTIST, 'movie'),
      (err) => {
        assert.ok(err instanceof CrossDomainAffinityError);
        assert.equal(err.code, expectedCode);
        return true;
      }
    );
  }
});

// --- upstream errors & quota protection -------------------------------------------

test('propagates QlooApiError from the transport layer', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: async () => ({ errors: [{ message: 'filter.type is required' }] }),
      text: async () => '',
    };
  };

  await assert.rejects(
    getCrossDomainAffinities(ARTIST, 'movie'),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('identical concurrent lookups are deduplicated by single-flight', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => insightsPayload([liveEntity()]),
      text: async () => '',
    };
  };

  const [a, b, c] = await Promise.all([
    getCrossDomainAffinities(ARTIST, 'movie'),
    getCrossDomainAffinities(ARTIST, 'movie'),
    getCrossDomainAffinities(ARTIST, 'movie'),
  ]);

  assert.equal(calls.length, 1, 'single-flight collapsed concurrent lookups');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

// --- cache TTL routing (integration with task 19) --------------------------------------

test('/v2/insights uses the general volatile TTL (insights are not reference data)', () => {
  assert.equal(ttlForPathname(INSIGHTS_PATH), env.QLOO_CACHE_TTL_MS);
});

test('normalizeAffinityEntity is exported and pure', () => {
  const raw = liveEntity();
  assert.deepEqual(normalizeAffinityEntity(raw), normalizeAffinityEntity(raw));
  assert.equal(normalizeAffinityEntity(undefined), null);
  assert.equal(normalizeAffinityEntity('str'), null);
  assert.equal(normalizeAffinityEntity({ id: 'x' }), null, 'missing name -> null');
  assert.equal(normalizeAffinityEntity({ name: 'x' }), null, 'missing id -> null');
});

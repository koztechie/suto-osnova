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
  getAudienceInsights,
  searchAudiences,
  resolveAudiences,
  resolveTagIds,
  normalizeAudience,
  AudienceInsightsError,
  AGE_RANGES,
  GENDERS,
  AUDIENCES_PATH,
} = await import('../src/services/audienceInsightsClient.js');
const { QlooApiError, ttlForPathname } = await import(
  '../src/services/qlooClient.js'
);
const { INSIGHTS_PATH } = await import('../src/services/crossDomainClient.js');
const { env } = await import('../src/config/env.js');

const realFetch = globalThis.fetch;
const OUTDOORS = 'urn:audience:hobbies_and_interests:outdoors';
const ARTIST = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';

let calls;

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

/** Entity shape as returned by the LIVE insights host. */
function liveEntity(overrides = {}) {
  return {
    name: 'Gaylord Rockies Resort',
    entity_id: 'F8351CC6-ADDD-4CD7-8A33-B6CA1F86D3CF',
    type: 'urn:entity',
    subtype: 'urn:entity:place',
    properties: {},
    popularity: 0.9,
    query: { affinity: 0.93 },
    ...overrides,
  };
}

/** Audience shape as returned by the LIVE /v2/audiences host. */
function liveAudience(overrides = {}) {
  return {
    entity_id: 'AAAE9FAA-FE3D-4732-9E82-BD4CED485D60',
    name: 'Outdoors',
    parents: [{ id: 'urn:audience:hobbies_and_interests', name: 'Hobbies And Interests', type: 'urn:audience' }],
    type: 'urn:audience:hobbies_and_interests',
    id: 'urn:audience:hobbies_and_interests:outdoors',
    disambiguation: 'Outdoors enthusiasts',
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  mockOk(() => ({ success: true, results: { entities: [liveEntity()] } }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- getAudienceInsights: transport integration ---------------------------------

test('issues GET /v2/insights with audience signal, target type and auth', async () => {
  await getAudienceInsights({ targetDomain: 'place', audiences: OUTDOORS });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, INSIGHTS_PATH);
  assert.equal(url.searchParams.get('filter.type'), 'urn:entity:place');
  assert.equal(url.searchParams.get('signal.demographics.audiences'), OUTDOORS);
  assert.equal(url.searchParams.get('take'), '20');
  assert.equal(url.searchParams.get('feature.explainability'), 'true');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.equal(calls[0].options.method, 'GET');
});

test('sends the full demographic profile with weights', async () => {
  await getAudienceInsights({
    targetDomain: 'movie',
    audiences: [OUTDOORS],
    audienceWeight: 'high',
    age: '36_to_55',
    ageWeight: 0.5,
    gender: 'female',
    genderWeight: 'low',
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('signal.demographics.audiences.weight'), 'high');
  assert.equal(url.searchParams.get('signal.demographics.age'), '36_to_55');
  assert.equal(url.searchParams.get('signal.demographics.age.weight'), '0.5');
  assert.equal(url.searchParams.get('signal.demographics.gender'), 'female');
  assert.equal(url.searchParams.get('signal.demographics.gender.weight'), 'low');
});

test('combines demographics with taste signals and location', async () => {
  await getAudienceInsights({
    targetDomain: 'place',
    audiences: OUTDOORS,
    entityIds: [ARTIST, ARTIST],
    tagIds: ['genre:place:hotel', 'urn:tag:style:qloo:indie'],
    location: '  Denver ',
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('signal.interests.entities'), ARTIST, 'deduped');
  assert.equal(
    url.searchParams.get('signal.interests.tags'),
    'urn:tag:genre:place:hotel,urn:tag:style:qloo:indie'
  );
  assert.equal(url.searchParams.get('signal.location.query'), 'Denver');
});

test('supports documented page pagination (page preferred over offset)', async () => {
  await getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, page: 2 });
  let url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.has('offset'), false);

  await getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, offset: 5 });
  url = new URL(calls[1].url);
  assert.equal(url.searchParams.get('offset'), '5');
  assert.equal(url.searchParams.has('page'), false);
});

// --- audience validation (the silent-garbage guard) -------------------------------

test('resolveAudiences maps URNs and shorthands, dedupes and splits', () => {
  assert.deepEqual(resolveAudiences(OUTDOORS), [OUTDOORS]);
  assert.deepEqual(resolveAudiences('hobbies_and_interests:outdoors'), [OUTDOORS]);
  assert.deepEqual(resolveAudiences([OUTDOORS, OUTDOORS]), [OUTDOORS]);
  assert.deepEqual(resolveAudiences(`${OUTDOORS},, global_issues:sustainability`), [
    OUTDOORS,
    'urn:audience:global_issues:sustainability',
  ]);
});

test('rejects single-word audiences (the gateway silently misreads them)', () => {
  for (const bad of ['outdoors', 'Outdoors!', 'urn:audience:outdoors', '', 'urn:audience:a:b c']) {
    assert.throws(
      () => resolveAudiences(bad),
      (err) => {
        assert.ok(err instanceof AudienceInsightsError);
        assert.equal(err.code, 'INVALID_AUDIENCES');
        return true;
      },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
  assert.throws(() => resolveAudiences([42]), (err) => {
    assert.equal(err.code, 'INVALID_AUDIENCES');
    return true;
  });
  assert.throws(() => resolveAudiences(Array(101).fill(OUTDOORS)), (err) => {
    assert.equal(err.code, 'INVALID_AUDIENCES');
    return true;
  }, 'the 100-audience safety rail');
});

test('invalid audiences fail synchronously with no network call', () => {
  assert.throws(
    () => getAudienceInsights({ targetDomain: 'movie', audiences: 'outdoors' }),
    (err) => {
      assert.equal(err.code, 'INVALID_AUDIENCES');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

// --- taste-signal and enum validation ----------------------------------------------

test('resolveTagIds validates urn:tag:* and shorthands, rejects singles', () => {
  assert.deepEqual(resolveTagIds('genre:place:hotel'), ['urn:tag:genre:place:hotel']);
  assert.deepEqual(resolveTagIds('urn:tag:style:qloo:indie'), ['urn:tag:style:qloo:indie']);
  for (const bad of [['horror'], ['urn:tag'], ['a b:c']]) {
    assert.throws(
      () => resolveTagIds(bad),
      (err) => {
        assert.equal(err.code, 'INVALID_TAG_IDS');
        return true;
      }
    );
  }
});

test('age and gender enums are validated before any network call', async () => {
  // valid: single and comma list
  await getAudienceInsights({
    targetDomain: 'movie',
    audiences: OUTDOORS,
    age: ['36_to_55', '35_and_younger'],
  });
  assert.equal(
    new URL(calls[0].url).searchParams.get('signal.demographics.age'),
    '36_to_55,35_and_younger'
  );

  for (const bad of ['twenties', 35, ['36_to_55', 'old']]) {
    assert.throws(
      () => getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, age: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_AGE');
        return true;
      }
    );
  }
  for (const bad of ['unknown', 'Female', 1]) {
    assert.throws(
      () => getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, gender: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_GENDER');
        return true;
      }
    );
  }
  assert.equal(calls.length, 1, 'invalid enums made no requests');
});

test('AGE_RANGES and GENDERS match the live-verified enums', () => {
  assert.deepEqual([...AGE_RANGES].sort(), [
    '24_and_younger',
    '25_to_29',
    '30_to_34',
    '35_and_younger',
    '35_to_44',
    '36_to_55',
    '45_to_54',
    '55_and_older',
  ]);
  assert.deepEqual([...GENDERS], ['male', 'female']);
});

test('weights accept numbers and documented words, reject junk', async () => {
  await getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, audienceWeight: 0 });
  assert.equal(
    new URL(calls[0].url).searchParams.get('signal.demographics.audiences.weight'),
    '0',
    'weight 0 must be sent, not dropped'
  );

  for (const bad of [-1, 'strong', NaN]) {
    assert.throws(
      () => getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, audienceWeight: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_WEIGHT');
        return true;
      }
    );
  }
  assert.equal(calls.length, 1);
});

// --- signal presence, pagination and extra validation ---------------------------------

test('rejects calls with NO signal at all (live gateway would 400)', () => {
  assert.throws(
    () => getAudienceInsights({ targetDomain: 'movie' }),
    (err) => {
      assert.equal(err.code, 'NO_SIGNAL');
      return true;
    }
  );
  assert.throws(
    () => getAudienceInsights({ targetDomain: 'movie', explainability: false }),
    (err) => {
      assert.equal(err.code, 'NO_SIGNAL');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test('a filter.* passed via extra satisfies the signal requirement', async () => {
  await getAudienceInsights({
    targetDomain: 'movie',
    extra: { 'filter.tags': 'urn:tag:genre:media:comedy' },
  });
  assert.equal(calls.length, 1);
});

test('clamps take to 1..50 and validates take/page/offset', async () => {
  await getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS, take: 999 });
  assert.equal(new URL(calls[0].url).searchParams.get('take'), '50');

  const cases = [
    [{ targetDomain: 'movie', audiences: OUTDOORS, take: 'lots' }, 'INVALID_TAKE'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, page: 0 }, 'INVALID_PAGE'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, page: 2.5 }, 'INVALID_PAGE'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, offset: -1 }, 'INVALID_OFFSET'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, explainability: 'yes' }, 'INVALID_FEATURE_FLAG'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, extra: { take: 5 } }, 'RESERVED_PARAM'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, extra: { 'signal.demographics.age': 'x' } }, 'RESERVED_PARAM'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, extra: { 'filter.tags': ['a'] } }, 'INVALID_EXTRA'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, extra: [] }, 'INVALID_EXTRA'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, location: '  ' }, 'INVALID_LOCATION'],
    [{ targetDomain: 'urn:heatmap', audiences: OUTDOORS }, 'INVALID_TARGET_DOMAIN'],
    [{ targetDomain: 'spaceship', audiences: OUTDOORS }, 'INVALID_TARGET_DOMAIN'],
    [{ targetDomain: 'movie', audiences: OUTDOORS, entityIds: [] }, 'INVALID_ENTITY_IDS'],
  ];
  for (const [parameters, code] of cases) {
    assert.throws(
      () => getAudienceInsights(parameters),
      (err) => {
        assert.ok(err instanceof AudienceInsightsError, `${code}: ${err.name}`);
        assert.equal(err.code, code, JSON.stringify(parameters));
        return true;
      }
    );
  }
  assert.equal(calls.length, 1, 'invalid options made no extra requests');

  // Synchronous throw -> assert.throws (not rejects): the validation
  // error surfaces before any promise exists.
  assert.throws(() => getAudienceInsights('not-an-object'), (err) => {
    assert.equal(err.code, 'INVALID_PARAMETERS');
    return true;
  });
});

test('explainability can be turned off (param omitted)', async () => {
  await getAudienceInsights({
    targetDomain: 'movie',
    audiences: OUTDOORS,
    explainability: false,
  });
  assert.equal(
    new URL(calls[0].url).searchParams.has('feature.explainability'),
    false
  );
});

// --- response normalization -----------------------------------------------------------

test('normalizes entities with attribution and the aggregate explainability', async () => {
  mockOk(() => ({
    success: true,
    results: {
      entities: [
        liveEntity({
          properties: { description: 'A park', geocode: { name: 'Vancouver', country_code: 'CA' } },
          query: {
            affinity: 0.93,
            explainability: {
              'signal.demographics.audiences': [{ id: OUTDOORS, score: 0.8 }],
            },
          },
        }),
      ],
    },
    query: {
      explainability: {
        'signal.demographics.audiences': {
          effect_on_top3_recs: [{ id: OUTDOORS, avg_score: 0.77 }],
        },
      },
    },
  }));

  const result = await getAudienceInsights({
    targetDomain: 'place',
    audiences: OUTDOORS,
    age: '36_to_55',
    gender: 'female',
  });

  assert.equal(result.targetType, 'urn:entity:place');
  assert.deepEqual(result.audiences, [OUTDOORS]);
  assert.deepEqual(result.age, ['36_to_55']);
  assert.equal(result.gender, 'female');
  assert.equal(result.count, 1);
  assert.equal(result.page, null);

  const [entity] = result.results;
  assert.equal(entity.name, 'Gaylord Rockies Resort');
  assert.equal(entity.affinity, 0.93);
  assert.equal(entity.city, 'Vancouver');
  // Live-verified: the sandbox attributes only signal.interests.entities
  // per result — demographic attribution is not computed yet, so `explain`
  // stays honestly null instead of inventing numbers.
  assert.equal(entity.explain, null);
  // The aggregate IS normalized per signal path (tolerant of the
  // demographics path if/when the backend starts emitting it).
  assert.deepEqual(
    result.explainability['signal.demographics.audiences'].top3,
    [{ entityId: OUTDOORS, avgScore: 0.77 }]
  );
});

test('mixed-signal aggregates are keyed per path (no collisions)', async () => {
  mockOk(() => ({
    success: true,
    results: { entities: [liveEntity()] },
    query: {
      explainability: {
        'signal.interests.entities': {
          effect_on_top3_recs: [{ entity_id: ARTIST, avg_score: 0.6 }],
        },
        'signal.demographics.audiences': {
          effect_on_top3_recs: [{ id: OUTDOORS, avg_score: 0.4 }],
        },
      },
    },
  }));

  const result = await getAudienceInsights({
    targetDomain: 'movie',
    audiences: OUTDOORS,
    entityIds: ARTIST,
  });
  assert.deepEqual(result.explainability['signal.interests.entities'].top3, [
    { entityId: ARTIST, avgScore: 0.6 },
  ]);
  assert.deepEqual(result.explainability['signal.demographics.audiences'].top3, [
    { entityId: OUTDOORS, avgScore: 0.4 },
  ]);
});

test('audience-only queries (no explainability computed) yield null aggregates', async () => {
  // Live shape: feature.explainability=true with a demographic-only signal
  // returns NO explainability blocks at all.
  mockOk(() => ({
    success: true,
    results: {
      entities: [liveEntity({ query: { affinity: 0.93, measurements: { audience_growth: 0 } } })],
    },
  }));
  const result = await getAudienceInsights({
    targetDomain: 'place',
    audiences: OUTDOORS,
  });
  assert.equal(result.explainability, null);
  assert.equal(result.results[0].explain, null);
});

test('tolerates missing entities, success=false and non-object payloads', async () => {
  mockOk(() => ({ success: true }));
  assert.equal((await getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS })).count, 0);

  for (const [body, expectedCode] of [
    ['null', 'MALFORMED_RESPONSE'],
    ['{"success":false}', 'UPSTREAM_ERROR'],
  ]) {
    mockOk(() => JSON.parse(body));
    await assert.rejects(
      getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS }),
      (err) => {
        assert.equal(err.code, expectedCode);
        return true;
      }
    );
  }
});

test('propagates QlooApiError from the transport layer', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: async () => ({ errors: [{ message: 'at least one valid signal or filter is required' }] }),
      text: async () => '',
    };
  };
  await assert.rejects(
    getAudienceInsights({ targetDomain: 'movie', audiences: OUTDOORS }),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('identical concurrent audience insights are deduplicated by single-flight', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, results: { entities: [liveEntity()] } }),
      text: async () => '',
    };
  };

  const [a, b, c] = await Promise.all([
    getAudienceInsights({ targetDomain: 'place', audiences: OUTDOORS }),
    getAudienceInsights({ targetDomain: 'place', audiences: OUTDOORS }),
    getAudienceInsights({ targetDomain: 'place', audiences: OUTDOORS }),
  ]);
  assert.equal(calls.length, 1, 'single-flight collapsed concurrent lookups');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

// --- searchAudiences (URN discovery) -----------------------------------------------------

test('searchAudiences issues GET /v2/audiences with the selector and auth', async () => {
  mockOk(() => ({ success: true, results: { audiences: [liveAudience()] } }));

  const result = await searchAudiences('  outdoors ', { take: 3 });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, AUDIENCES_PATH);
  assert.equal(url.pathname, '/v2/audiences');
  assert.equal(url.searchParams.get('filter.query'), 'outdoors');
  assert.equal(url.searchParams.get('take'), '3');
  assert.ok(url.searchParams.get('filter.query'), 'the selector is always sent');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');

  assert.equal(result.query, 'outdoors');
  assert.equal(result.take, 3);
  assert.equal(result.count, 1);
  const [audience] = result.results;
  assert.equal(audience.id, 'urn:audience:hobbies_and_interests:outdoors');
  assert.equal(audience.name, 'Outdoors');
  assert.equal(audience.type, 'urn:audience:hobbies_and_interests');
  assert.equal(audience.entityId, 'AAAE9FAA-FE3D-4732-9E82-BD4CED485D60');
  assert.equal(audience.disambiguation, 'Outdoors enthusiasts');
  assert.deepEqual(audience.parents, [
    { id: 'urn:audience:hobbies_and_interests', name: 'Hobbies And Interests', type: 'urn:audience' },
  ]);
});

test('searchAudiences validates query, take and extra before any network call', () => {
  for (const bad of [null, 42, '', '   ', 'x'.repeat(201)]) {
    assert.throws(
      () => searchAudiences(bad),
      (err) => {
        assert.equal(err.code, 'INVALID_QUERY');
        return true;
      }
    );
  }
  assert.throws(() => searchAudiences('x', { take: 'lots' }), (err) => {
    assert.equal(err.code, 'INVALID_TAKE');
    return true;
  });
  assert.throws(() => searchAudiences('x', { extra: { 'filter.query': 'y' } }), (err) => {
    assert.equal(err.code, 'RESERVED_PARAM');
    return true;
  });
  assert.equal(calls.length, 0);
});

test('searchAudiences skips malformed items and tolerates missing lists', async () => {
  mockOk(() => ({
    success: true,
    results: { audiences: [null, 'x', { name: 'No Id' }, { id: 'no-name' }, liveAudience()] },
  }));
  const result = await searchAudiences('outdoors');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].id, 'urn:audience:hobbies_and_interests:outdoors');

  mockOk(() => ({ success: true }));
  assert.equal((await searchAudiences('outdoors')).count, 0);

  mockOk(() => ({ success: false }));
  await assert.rejects(searchAudiences('outdoors'), (err) => {
    assert.equal(err.code, 'UPSTREAM_ERROR');
    return true;
  });
});

// --- cache TTL routing (integration with task 19) ------------------------------------------

test('/v2/audiences is reference data -> long-lived TTL; insights stays volatile', () => {
  assert.equal(
    ttlForPathname(AUDIENCES_PATH),
    env.QLOO_CACHE_TTL_ENTITIES_MS,
    'audience discovery must use the 24h reference-data TTL'
  );
  assert.equal(ttlForPathname(INSIGHTS_PATH), env.QLOO_CACHE_TTL_MS);
});

test('normalizeAudience is exported and pure', () => {
  const raw = liveAudience();
  assert.deepEqual(normalizeAudience(raw), normalizeAudience(raw));
  assert.equal(normalizeAudience(undefined), null);
  assert.equal(normalizeAudience('str'), null);
  assert.equal(normalizeAudience({ id: 'x' }), null, 'missing name -> null');
  assert.equal(normalizeAudience({ name: 'x' }), null, 'missing id -> null');
  assert.deepEqual(normalizeAudience({ id: 'a', name: 'b' }).parents, [], 'missing parents -> []');
});

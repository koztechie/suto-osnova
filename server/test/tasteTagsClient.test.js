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
  findTags,
  resolveTagType,
  normalizeTag,
  TasteTagsError,
  TAGS_PATH,
} = await import('../src/services/tasteTagsClient.js');
const { QlooApiError, ttlForPathname } = await import(
  '../src/services/qlooClient.js'
);
const { env } = await import('../src/config/env.js');

const realFetch = globalThis.fetch;
const ENTITY_ID = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';

let calls;

/** Tag shape as returned by the LIVE hackathon host. */
function liveTag(overrides = {}) {
  return {
    id: 'urn:tag:genre:media:indie',
    name: 'Indie',
    type: 'urn:tag:genre:media',
    popularity: 0.96761465,
    properties: {},
    parents: [{ type: 'urn:entity:movie' }],
    tags: [],
    ...overrides,
  };
}

function tagsPayload(tags = [], extra = {}) {
  return { success: true, results: { tags }, ...extra };
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
  mockOk(() => tagsPayload([liveTag()]));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- transport integration --------------------------------------------------

test('issues GET /v2/tags with entity, tag types, take, offset and auth', async () => {
  await findTags(ENTITY_ID, 'genre:media', { take: 5, offset: 2 });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, TAGS_PATH);
  assert.equal(url.pathname, '/v2/tags');
  assert.equal(url.searchParams.get('filter.entities'), ENTITY_ID);
  assert.equal(url.searchParams.get('filter.tag.types'), 'urn:tag:genre:media');
  assert.equal(url.searchParams.get('take'), '5');
  assert.equal(url.searchParams.get('offset'), '2');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.equal(calls[0].options.method, 'GET');
});

test('always sends a selector param — the gateway 400s on bare queries', async () => {
  // The live gateway requires at least one of filter.tag.types / filter.query
  // / filter.parents.types / … . The `type` argument guarantees it.
  await findTags(ENTITY_ID, 'subgenre:qloo');
  const url = new URL(calls[0].url);
  assert.ok(
    url.searchParams.get('filter.tag.types'),
    'filter.tag.types must always be present'
  );
});

test('joins multiple tag types with a comma', async () => {
  await findTags(ENTITY_ID, ['genre:media', 'urn:tag:subgenre:qloo']);
  const url = new URL(calls[0].url);
  assert.equal(
    url.searchParams.get('filter.tag.types'),
    'urn:tag:genre:media,urn:tag:subgenre:qloo'
  );
});

test('accepts a comma-separated type string and tolerates empty parts', async () => {
  await findTags(ENTITY_ID, 'genre:media,,subgenre:qloo');
  const url = new URL(calls[0].url);
  assert.equal(
    url.searchParams.get('filter.tag.types'),
    'urn:tag:genre:media,urn:tag:subgenre:qloo'
  );
});

// --- tag type resolution -----------------------------------------------------

test('resolveTagType maps shorthands and passes full URNs through', () => {
  assert.deepEqual(resolveTagType('genre:media'), ['urn:tag:genre:media']);
  assert.deepEqual(resolveTagType('  Genre:Media  '), ['urn:tag:genre:media']);
  assert.deepEqual(resolveTagType('urn:tag:subgenre:qloo'), [
    'urn:tag:subgenre:qloo',
  ]);
  assert.deepEqual(resolveTagType(['style:qloo', 'urn:tag:theme:qloo']), [
    'urn:tag:style:qloo',
    'urn:tag:theme:qloo',
  ]);
});

test('resolveTagType rejects single words (ambiguous across domains)', () => {
  for (const bad of ['genre', 'GENRE', 'urn:tag', 'urn:tag:', 'urn:foo:bar', 'a b:c']) {
    assert.throws(
      () => resolveTagType(bad),
      (err) => {
        assert.ok(err instanceof TasteTagsError);
        assert.equal(err.code, 'INVALID_TYPE');
        return true;
      },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
});

test('resolveTagType rejects non-strings and empty resolutions', () => {
  for (const bad of [null, undefined, 42, {}, [], ['ok', 7]]) {
    assert.throws(
      () => resolveTagType(bad),
      (err) => {
        assert.equal(err.code, 'INVALID_TYPE');
        return true;
      }
    );
  }
  assert.throws(() => resolveTagType(','), (err) => {
    assert.equal(err.code, 'INVALID_TYPE');
    return true;
  });
});

// --- input validation (synchronous, no network) ------------------------------

test('rejects invalid entity ids before any network call', () => {
  for (const bad of ['', '   ', null, undefined, 42, 'id with space', 'a,b']) {
    assert.throws(
      () => findTags(bad, 'genre:media'),
      (err) => {
        assert.ok(err instanceof TasteTagsError);
        assert.equal(err.code, 'INVALID_ENTITY_ID');
        return true;
      }
    );
  }
  assert.throws(() => findTags('x'.repeat(129), 'genre:media'), (err) => {
    assert.equal(err.code, 'INVALID_ENTITY_ID');
    return true;
  });
  assert.equal(calls.length, 0, 'no request was made');
});

test('requires a type argument (entity scoping alone is not a selector)', () => {
  for (const bad of [null, undefined, '', 42]) {
    assert.throws(
      () => findTags(ENTITY_ID, bad),
      (err) => {
        assert.equal(err.code, 'INVALID_TYPE');
        return true;
      }
    );
  }
  assert.equal(calls.length, 0);
});

test('clamps take to the documented 1..50 and rejects non-numeric take', async () => {
  await findTags(ENTITY_ID, 'genre:media', { take: 999 });
  await findTags(ENTITY_ID, 'genre:media', { take: 0 });
  assert.equal(new URL(calls[0].url).searchParams.get('take'), '50');
  assert.equal(new URL(calls[1].url).searchParams.get('take'), '1');

  assert.throws(
    () => findTags(ENTITY_ID, 'genre:media', { take: 'lots' }),
    (err) => {
      assert.equal(err.code, 'INVALID_TAKE');
      return true;
    }
  );
  assert.equal(calls.length, 2, 'invalid take made no request');
});

test('defaults take to the documented 20', async () => {
  await findTags(ENTITY_ID, 'genre:media');
  assert.equal(new URL(calls[0].url).searchParams.get('take'), '20');
});

test('supports the documented page pagination and validates its range', async () => {
  await findTags(ENTITY_ID, 'genre:media', { page: 3 });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.has('offset'), false, 'offset omitted with page');

  for (const bad of [0, -1, 101, 2.5, '2']) {
    assert.throws(
      () => findTags(ENTITY_ID, 'genre:media', { page: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_PAGE');
        return true;
      },
      `expected rejection for page=${JSON.stringify(bad)}`
    );
  }
  assert.equal(calls.length, 1, 'invalid pages made no requests');
});

test('sends filter.query with typo/semantic flags only when explicitly true', async () => {
  await findTags(ENTITY_ID, 'genre:media', {
    query: '  indie ',
    typoTolerance: true,
    semanticSearch: false,
  });
  let url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('filter.query'), 'indie');
  assert.equal(url.searchParams.get('feature.typo_tolerance'), 'true');
  assert.equal(url.searchParams.has('feature.semantic_search'), false);

  // undefined flags are omitted entirely (server defaults apply)
  await findTags(ENTITY_ID, 'genre:media', { query: 'indie' });
  url = new URL(calls[1].url);
  assert.equal(url.searchParams.has('feature.typo_tolerance'), false);

  for (const bad of ['', '   ', 'x'.repeat(201), 42]) {
    assert.throws(
      () => findTags(ENTITY_ID, 'genre:media', { query: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_QUERY');
        return true;
      }
    );
  }
  assert.throws(
    () => findTags(ENTITY_ID, 'genre:media', { typoTolerance: 'yes' }),
    (err) => {
      assert.equal(err.code, 'INVALID_FEATURE_FLAG');
      return true;
    }
  );
  assert.equal(calls.length, 2);
});

test('validates popularity bounds and drops the gateway-poisoned zero', async () => {
  await findTags(ENTITY_ID, 'genre:media', {
    popularityMin: 0.5,
    popularityMax: 0.98,
  });
  let url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('filter.popularity.min'), '0.5');
  assert.equal(url.searchParams.get('filter.popularity.max'), '0.98');

  // min=0 is silently dropped by the live gateway (would otherwise widen
  // semantics) — the client omits it instead of sending a no-op.
  await findTags(ENTITY_ID, 'genre:media', { popularityMin: 0 });
  url = new URL(calls[1].url);
  assert.equal(url.searchParams.has('filter.popularity.min'), false);

  for (const bad of [-0.1, 1.5, NaN, '0.5']) {
    assert.throws(
      () => findTags(ENTITY_ID, 'genre:media', { popularityMin: bad }),
      (err) => {
        assert.equal(err.code, 'INVALID_POPULARITY');
        return true;
      }
    );
  }
  assert.equal(calls.length, 2);
});

test('validates offset and rejects reserved/complex extra params', async () => {
  assert.throws(
    () => findTags(ENTITY_ID, 'genre:media', { offset: -1 }),
    (err) => {
      assert.equal(err.code, 'INVALID_OFFSET');
      return true;
    }
  );
  assert.throws(
    () => findTags(ENTITY_ID, 'genre:media', { extra: { take: 5 } }),
    (err) => {
      assert.equal(err.code, 'RESERVED_PARAM');
      return true;
    }
  );
  assert.throws(
    () =>
      findTags(ENTITY_ID, 'genre:media', {
        extra: { 'filter.tag.types': 'x' },
      }),
    (err) => {
      assert.equal(err.code, 'RESERVED_PARAM');
      return true;
    }
  );
  assert.throws(
    () => findTags(ENTITY_ID, 'genre:media', { extra: { 'filter.tags': ['a'] } }),
    (err) => {
      assert.equal(err.code, 'INVALID_EXTRA');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test('passes scalar extra params through to the query string', async () => {
  await findTags(ENTITY_ID, 'genre:media', {
    extra: { 'filter.parents.types': 'urn:entity:movie' },
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('filter.parents.types'), 'urn:entity:movie');
});

// --- response normalization ---------------------------------------------------

test('normalizes the live-host tag shape and returns the envelope', async () => {
  mockOk(() =>
    tagsPayload([
      liveTag({
        properties: {
          description: 'A broad category of independent music/film.',
          history: 'Present since the mid-20th century.',
        },
        parents: [{ type: 'urn:entity:movie' }, { type: 'urn:entity:book' }],
        tags: [
          {
            tag_id: 'urn:tag:collection:canonical',
            name: 'Canonical',
            type: 'urn:tag:collection',
            value: 'urn:tag:collection:canonical',
          },
        ],
      }),
    ])
  );

  const result = await findTags(ENTITY_ID, 'genre:media', { take: 5 });

  assert.equal(result.entityId, ENTITY_ID);
  assert.deepEqual(result.types, ['urn:tag:genre:media']);
  assert.equal(result.take, 5);
  assert.equal(result.page, null, 'page absent -> null in the envelope');
  assert.equal(result.offset, null, 'offset absent -> null in the envelope');
  assert.equal(result.count, 1);

  const [tag] = result.results;
  assert.equal(tag.id, 'urn:tag:genre:media:indie');
  assert.equal(tag.name, 'Indie');
  assert.equal(tag.type, 'urn:tag:genre:media');
  assert.equal(tag.popularity, 0.96761465);
  assert.equal(tag.description, 'A broad category of independent music/film.');
  assert.equal(tag.history, 'Present since the mid-20th century.');
  assert.deepEqual(tag.parents, ['urn:entity:movie', 'urn:entity:book']);
  assert.deepEqual(tag.tags, [
    {
      id: 'urn:tag:collection:canonical',
      name: 'Canonical',
      type: 'urn:tag:collection',
    },
  ]);
});

test('tolerates the documented tag_id/subtype/tag_value shape with affinity', async () => {
  mockOk(() =>
    tagsPayload([
      {
        tag_id: 'urn:tag:keyword:media:brady_bunch',
        name: 'Brady Bunch',
        subtype: 'urn:tag:keyword:media',
        tag_value: 'urn:tag:keyword:media:brady_bunch',
        types: ['urn:entity:tv_show'],
        query: { affinity: 0.87 },
      },
    ])
  );

  const result = await findTags(ENTITY_ID, 'keyword:media');
  assert.equal(result.count, 1);
  const [tag] = result.results;
  assert.equal(tag.id, 'urn:tag:keyword:media:brady_bunch');
  assert.equal(tag.type, 'urn:tag:keyword:media');
  assert.equal(tag.affinity, 0.87);
});

test('skips malformed items and tolerates odd parents/tags entries', async () => {
  mockOk(() =>
    tagsPayload([
      null,
      'not-an-object',
      { name: 'No Id' },
      { id: 'urn:tag:x:y' },
      {
        id: 'urn:tag:genre:media:ok',
        name: 'Ok',
        parents: ['urn:entity:movie', 42, null, { type: 'urn:entity:book' }],
        tags: [null, { value: 'urn:tag:v' }, { name: 'Only Name' }],
      },
    ])
  );

  const result = await findTags(ENTITY_ID, 'genre:media');
  assert.equal(result.count, 1, 'only items with both id and name survive');
  const [tag] = result.results;
  assert.deepEqual(tag.parents, ['urn:entity:movie', 'urn:entity:book']);
  assert.deepEqual(tag.tags, [
    { id: 'urn:tag:v', name: null, type: null },
    { id: null, name: 'Only Name', type: null },
  ]);
});

test('treats missing tag lists as an empty match set', async () => {
  mockOk(() => ({ success: true }));
  const result = await findTags(ENTITY_ID, 'genre:media');
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
      findTags(ENTITY_ID, 'genre:media'),
      (err) => {
        assert.ok(err instanceof TasteTagsError);
        assert.equal(err.code, expectedCode);
        return true;
      }
    );
  }
});

// --- upstream errors & quota protection ---------------------------------------

test('propagates QlooApiError from the transport layer', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: async () => ({ errors: [{ message: 'At least one selector…' }] }),
      text: async () => '',
    };
  };

  await assert.rejects(
    findTags(ENTITY_ID, 'genre:media'),
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
      json: async () => tagsPayload([liveTag()]),
      text: async () => '',
    };
  };

  const [a, b, c] = await Promise.all([
    findTags(ENTITY_ID, 'genre:media'),
    findTags(ENTITY_ID, 'genre:media'),
    findTags(ENTITY_ID, 'genre:media'),
  ]);

  assert.equal(calls.length, 1, 'single-flight collapsed concurrent lookups');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

// --- cache TTL routing (integration with task 19) ------------------------------

test('/v2/tags is routed to the long-lived entities TTL by the transport', () => {
  assert.equal(
    ttlForPathname(TAGS_PATH),
    env.QLOO_CACHE_TTL_ENTITIES_MS,
    'tag lookups must use the 24h reference-data TTL'
  );
});

test('normalizeTag is exported and pure', () => {
  const raw = liveTag();
  assert.deepEqual(normalizeTag(raw), normalizeTag(raw));
  assert.equal(normalizeTag(undefined), null);
  assert.equal(normalizeTag('str'), null);
  assert.equal(normalizeTag({ id: 'x' }), null, 'missing name -> null');
  assert.equal(normalizeTag({ name: 'x' }), null, 'missing id -> null');
});

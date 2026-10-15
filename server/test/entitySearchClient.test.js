import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Transport-independent tests: cache off, generous limiter, no retries.
const dir = await mkdtemp(path.join(tmpdir(), 'qloo-search-'));
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  searchEntities,
  resolveDomain,
  normalizeEntity,
  EntitySearchError,
  DOMAINS,
} = await import('../src/services/entitySearchClient.js');
const { QlooApiError } = await import('../src/services/qlooClient.js');

const realFetch = globalThis.fetch;
let calls;

function searchPayload(items = [], extra = {}) {
  return {
    success: true,
    results: items,
    ...extra,
  };
}

function item(overrides = {}) {
  return {
    name: 'Phoebe Bridgers',
    entity_id: 'ABC-123',
    type: 'urn:entity',
    subtype: 'urn:entity:artist',
    properties: {},
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => searchPayload([item()]),
      text: async () => '',
    };
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

// --- transport integration -------------------------------------------------

test('issues GET /search with query, take, offset and auth header', async () => {
  await searchEntities('Phoebe Bridgers', 'artist');

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('query'), 'Phoebe Bridgers');
  assert.equal(url.searchParams.get('types'), 'urn:entity:artist');
  assert.equal(url.searchParams.get('take'), '10');
  assert.equal(url.searchParams.get('offset'), '0');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key');
  assert.equal(calls[0].options.method, 'GET');
});

test('omits types entirely when no domain is given', async () => {
  await searchEntities('Blade Runner');

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.has('types'), false);
});

test('joins multiple domains with a comma', async () => {
  await searchEntities('Ridley Scott', ['person', 'movie']);

  const url = new URL(calls[0].url);
  assert.equal(
    url.searchParams.get('types'),
    'urn:entity:person,urn:entity:movie'
  );
});

// --- domain resolution -----------------------------------------------------

test('resolveDomain maps friendly names, aliases and deprecated folds', () => {
  assert.deepEqual(resolveDomain('artist'), ['urn:entity:artist']);
  assert.deepEqual(resolveDomain('film'), ['urn:entity:movie']);
  assert.deepEqual(resolveDomain('tv'), ['urn:entity:tv_show']);
  assert.deepEqual(resolveDomain('music'), ['urn:entity:artist']);
  assert.deepEqual(resolveDomain('actor'), ['urn:entity:person']);
  assert.deepEqual(resolveDomain('author'), ['urn:entity:person']);
  assert.deepEqual(resolveDomain('director'), ['urn:entity:person']);
});

test('resolveDomain accepts raw URNs and case/whitespace variants', () => {
  assert.deepEqual(resolveDomain('urn:entity:podcast'), ['urn:entity:podcast']);
  assert.deepEqual(resolveDomain('  TV   Show '), ['urn:entity:tv_show']);
  assert.deepEqual(resolveDomain('Film'), ['urn:entity:movie']);
});

test('resolveDomain accepts the agent domain vocabulary (books/dining/fashion)', () => {
  assert.deepEqual(resolveDomain('books'), ['urn:entity:book']);
  assert.deepEqual(resolveDomain('dining'), ['urn:entity:place']);
  assert.deepEqual(resolveDomain('fashion'), ['urn:entity:brand']);
});

test('resolveDomain passes through unknown raw urn:entity:* values', () => {
  // A stale DOMAINS registry must never block a valid new URN.
  assert.deepEqual(resolveDomain('urn:entity:brand_new_type'), [
    'urn:entity:brand_new_type',
  ]);
});

test('resolveDomain rejects unknown friendly names with guidance', () => {
  assert.throws(
    () => resolveDomain('spaceship'),
    (err) => {
      assert.ok(err instanceof EntitySearchError);
      assert.equal(err.code, 'INVALID_DOMAIN');
      assert.match(err.message, /Unknown domain/);
      assert.match(err.message, /urn:entity/);
      return true;
    }
  );
});

test('resolveDomain treats undefined/null as "no filter"', () => {
  assert.deepEqual(resolveDomain(undefined), []);
  assert.deepEqual(resolveDomain(null), []);
});

test('every DOMAINS value is a well-formed entity URN', () => {
  for (const [name, urn] of Object.entries(DOMAINS)) {
    assert.match(urn, /^urn:entity:[a-z0-9_]+$/, `domain ${name}`);
  }
});

// --- input validation (synchronous, no network) ---------------------------

test('rejects empty/whitespace/non-string queries before any network call', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.throws(
      () => searchEntities(bad),
      (err) => {
        assert.ok(err instanceof EntitySearchError);
        assert.equal(err.code, 'EMPTY_QUERY');
        return true;
      }
    );
  }
  assert.equal(calls.length, 0, 'no request was made');
});

test('rejects queries longer than 200 characters', () => {
  assert.throws(
    () => searchEntities('x'.repeat(201)),
    (err) => {
      assert.equal(err.code, 'QUERY_TOO_LONG');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test('clamps take to 1..50 and rejects non-numeric take', async () => {
  await searchEntities('a', undefined, { take: 999 });
  await searchEntities('b', undefined, { take: 0 });
  assert.equal(new URL(calls[0].url).searchParams.get('take'), '50');
  assert.equal(new URL(calls[1].url).searchParams.get('take'), '1');

  assert.throws(
    () => searchEntities('c', undefined, { take: 'lots' }),
    (err) => {
      assert.equal(err.code, 'INVALID_TAKE');
      return true;
    }
  );
  assert.equal(calls.length, 2, 'invalid take made no request');
});

test('validates offset and rejects reserved/complex extra params', async () => {
  assert.throws(
    () => searchEntities('a', undefined, { offset: -1 }),
    (err) => {
      assert.equal(err.code, 'INVALID_OFFSET');
      return true;
    }
  );
  assert.throws(
    () => searchEntities('a', undefined, { extra: { take: 5 } }),
    (err) => {
      assert.equal(err.code, 'RESERVED_PARAM');
      return true;
    }
  );
  assert.throws(
    () => searchEntities('a', undefined, { extra: { 'filter.tags': ['a', 'b'] } }),
    (err) => {
      assert.equal(err.code, 'INVALID_EXTRA');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test('passes scalar extra params through to the query string', async () => {
  await searchEntities('a', 'movie', { extra: { 'filter.popularity.min': 0.5 } });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('filter.popularity.min'), '0.5');
});

// --- response normalization ------------------------------------------------

test('normalizes entities and returns envelope metadata', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () =>
        searchPayload([
          item({
            popularity: 0.98,
            query: { affinity: 0.87 },
            properties: {
              description: 'American singer-songwriter',
              image: { url: 'https://img.example/x.jpg' },
              geocode: { name: 'Los Angeles', country_code: 'US' },
            },
            tags: [{ id: 'urn:tag:genre:music:indie', name: 'Indie', type: 'urn:tag:genre:music' }],
          }),
        ]),
      text: async () => '',
    };
  };

  const result = await searchEntities('Phoebe Bridgers', 'artist', { take: 5 });

  assert.equal(result.query, 'Phoebe Bridgers');
  assert.deepEqual(result.types, ['urn:entity:artist']);
  assert.equal(result.take, 5);
  assert.equal(result.offset, 0);
  assert.equal(result.count, 1);

  const [entity] = result.results;
  assert.equal(entity.id, 'ABC-123');
  assert.equal(entity.name, 'Phoebe Bridgers');
  assert.equal(entity.subtype, 'urn:entity:artist');
  assert.equal(entity.popularity, 0.98);
  assert.equal(entity.affinity, 0.87);
  assert.equal(entity.description, 'American singer-songwriter');
  assert.equal(entity.imageUrl, 'https://img.example/x.jpg');
  assert.equal(entity.city, 'Los Angeles');
  assert.equal(entity.countryCode, 'US');
  assert.equal(entity.tags[0].name, 'Indie');
});

test('normalizes the LIVE search tag shape ({ name, tag_id, type, value })', async () => {
  // Live-verified (2026-10-14): /search returns tag URNs in `tag_id`
  // (insights uses `id`). Losing the URN here silently breaks downstream
  // tag-family classification (domainMapper dining/fashion), so this
  // shape must round-trip into `tags[].id`.
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () =>
        searchPayload([
          item({
            tags: [
              {
                name: 'Pizza restaurant',
                tag_id: 'urn:tag:category:place:pizza_restaurant',
                type: 'urn:tag:category:place',
                value: 'urn:tag:category:place:pizza_restaurant',
              },
              { name: 'No URN at all', type: 'urn:tag:x' },
            ],
          }),
        ]),
      text: async () => '',
    };
  };

  const result = await searchEntities('Lucali', 'place');
  const [tag, tagWithoutUrn] = result.results[0].tags;
  assert.equal(tag.id, 'urn:tag:category:place:pizza_restaurant');
  assert.equal(tag.name, 'Pizza restaurant');
  assert.equal(tag.type, 'urn:tag:category:place');
  assert.equal(tagWithoutUrn.id, null, 'missing URN degrades to null, not crash');
});

test('tolerates the { results: { entities: [...] } } shape', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, results: { entities: [item()] } }),
      text: async () => '',
    };
  };

  const result = await searchEntities('Phoebe Bridgers');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].id, 'ABC-123');
});

test('skips malformed items and falls back id->name heuristics', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () =>
        searchPayload([
          null,
          'not-an-object',
          { name: 'No Id' },
          { entity_id: 'NO-NAME' },
          { id: 'fallback-id', name: 'Uses id field' },
          item(),
        ]),
      text: async () => '',
    };
  };

  const result = await searchEntities('x');
  assert.equal(result.count, 2, 'only items with both id and name survive');
  assert.equal(result.results[0].id, 'fallback-id');
  assert.equal(result.results[1].id, 'ABC-123');
});

test('treats missing results as an empty match list', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
      text: async () => '',
    };
  };

  const result = await searchEntities('nothing here');
  assert.equal(result.count, 0);
  assert.deepEqual(result.results, []);
});

test('rejects non-object payloads and success=false', async () => {
  for (const [body, expectedCode] of [
    ['null', 'MALFORMED_RESPONSE'],
    ['[1,2]', 'MALFORMED_RESPONSE'],
    ['{"success":false,"message":"bad"}', 'UPSTREAM_ERROR'],
  ]) {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => JSON.parse(body),
        text: async () => '',
      };
    };

    await assert.rejects(
      searchEntities(`q-${expectedCode}`),
      (err) => {
        assert.ok(err instanceof EntitySearchError);
        assert.equal(err.code, expectedCode);
        return true;
      }
    );
  }
});

// --- upstream errors & quota protection ------------------------------------

test('propagates QlooApiError from the transport layer', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'invalid key' }),
      text: async () => '',
    };
  };

  await assert.rejects(
    searchEntities('Phoebe Bridgers'),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, 401);
      return true;
    }
  );
});

test('identical searches are deduplicated by the transport cache/single-flight', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => searchPayload([item()]),
      text: async () => '',
    };
  };

  const [a, b, c] = await Promise.all([
    searchEntities('Phoebe Bridgers', 'artist'),
    searchEntities('Phoebe Bridgers', 'artist'),
    searchEntities('Phoebe Bridgers', 'artist'),
  ]);

  assert.equal(calls.length, 1, 'single-flight collapsed concurrent searches');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('normalizeEntity is exported and pure', () => {
  const raw = item({ popularity: 0.5 });
  const first = normalizeEntity(raw);
  const second = normalizeEntity(raw);
  assert.deepEqual(first, second);
  assert.equal(normalizeEntity(undefined), null);
  assert.equal(normalizeEntity('str'), null);
});

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// entitySearchClient/crossDomainClient pull in env via qlooClient — set a
// deterministic transport env BEFORE those dynamic imports (same pattern
// as the other test files in this suite).
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  MANDATORY_DOMAINS,
  DOMAIN_REGISTRY,
  DomainMappingError,
  validateRegistry,
  resolveDomain,
  resolveDomains,
  searchTypesFor,
  primaryInsightType,
  insightTypesFor,
  toInsightsDomain,
  classifyEntity,
  groupByDomain,
} = await import('../src/services/domainMapper.js');
const { resolveDomain: searchResolveDomain } = await import(
  '../src/services/entitySearchClient.js'
);
const { resolveTargetDomain } = await import(
  '../src/services/crossDomainClient.js'
);

const realFetch = globalThis.fetch;

before(() => {
  // The module refuses to import a broken registry — prove the contract
  // holds for the shipped one.
  const report = validateRegistry(DOMAIN_REGISTRY);
  assert.equal(report.domains, 5);
  assert.ok(report.aliases > 20, 'alias vocabulary is substantial');
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- the mandatory-domain contract -------------------------------------------

test('the registry covers EXACTLY the five mandatory domains', () => {
  assert.deepEqual([...MANDATORY_DOMAINS], ['film', 'music', 'books', 'dining', 'fashion']);
  assert.deepEqual(Object.keys(DOMAIN_REGISTRY).sort(), [...MANDATORY_DOMAINS].sort());
});

test('music does NOT advertise album to insights (live enum gap)', () => {
  assert.ok(DOMAIN_REGISTRY.music.searchTypes.includes('urn:entity:album'));
  assert.ok(
    !DOMAIN_REGISTRY.music.insightTypes.includes('urn:entity:album'),
    'album is absent from the insights filter.type enum (live-verified)'
  );
});

// --- validateRegistry: broken registries are rejected, not shipped -------------

test('validateRegistry rejects missing/extra domains and bad entries', () => {
  const clone = () => structuredClone(DOMAIN_REGISTRY);

  // missing mandatory domain
  let broken = clone();
  delete broken.fashion;
  assert.throws(() => validateRegistry(broken), (err) => {
    assert.equal(err.code, 'INVALID_REGISTRY');
    assert.match(err.message, /missing mandatory domains: fashion/);
    return true;
  });

  // extra non-mandatory domain
  broken = clone();
  broken.gaming = { ...clone().film, id: 'gaming' };
  assert.throws(() => validateRegistry(broken), (err) => {
    assert.equal(err.code, 'INVALID_REGISTRY');
    assert.match(err.message, /non-mandatory domains: gaming/);
    return true;
  });

  // mismatched id
  broken = clone();
  broken.film = { ...broken.film, id: 'movies' };
  assert.throws(() => validateRegistry(broken), /mismatched id/);

  // malformed entity type URN
  broken = clone();
  broken.film = { ...broken.film, searchTypes: ['movie'] };
  assert.throws(() => validateRegistry(broken), /malformed URN/);

  // empty type list
  broken = clone();
  broken.books = { ...broken.books, insightTypes: [] };
  assert.throws(() => validateRegistry(broken), /non-empty array/);

  // insight type NOT in searchTypes (the stricter-enum invariant)
  broken = clone();
  broken.music = {
    ...broken.music,
    searchTypes: ['urn:entity:artist'],
    insightTypes: ['urn:entity:artist', 'urn:entity:album'],
  };
  assert.throws(() => validateRegistry(broken), /stricter than search/);

  // malformed tag family
  broken = clone();
  broken.dining = { ...broken.dining, tagFamilies: ['restaurant'] };
  assert.throws(() => validateRegistry(broken), /malformed tag family/);

  // alias claimed by two domains (ambiguous routing)
  broken = clone();
  broken.fashion = { ...broken.fashion, aliases: [...broken.fashion.aliases, 'stylee'] };
  broken.film = { ...broken.film, aliases: [...broken.film.aliases, 'StyleE '] };
  assert.throws(() => validateRegistry(broken), /claimed by both/);

  // empty alias
  broken = clone();
  broken.books = { ...broken.books, aliases: ['books', '  '] };
  assert.throws(() => validateRegistry(broken), /non-empty string/);

  // non-object registry
  assert.throws(() => validateRegistry(null), (err) => {
    assert.equal(err.code, 'INVALID_REGISTRY');
    return true;
  });

  // the shipped registry still validates
  assert.doesNotThrow(() => validateRegistry(DOMAIN_REGISTRY));
});

// --- resolveDomain: names and aliases ------------------------------------------

test('resolveDomain maps canonical ids and aliases, case/space tolerant', () => {
  const cases = [
    ['film', 'film'], ['Film', 'film'], [' movie ', 'film'], ['movies', 'film'],
    ['tv', 'film'], ['tv show', 'film'], ['TV-Show', 'film'], ['television', 'film'],
    ['series', 'film'], ['cinema', 'film'],
    ['music', 'music'], ['artist', 'music'], [' Artists ', 'music'], ['band', 'music'],
    ['albums', 'music'], ['songs', 'music'],
    ['books', 'books'], ['Book', 'books'], ['literature', 'books'], ['novels', 'books'],
    ['dining', 'dining'], ['food', 'dining'], ['restaurants', 'dining'],
    ['Restaurant', 'dining'], ['cuisine', 'dining'], ['cafe', 'dining'],
    ['fashion', 'fashion'], ['apparel', 'fashion'], ['clothing', 'fashion'],
    ['style', 'fashion'], ['wardrobe', 'fashion'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(resolveDomain(input), expected, `resolveDomain(${JSON.stringify(input)})`);
  }
});

test('resolveDomain rejects unknown/empty/non-string with guidance', () => {
  for (const bad of ['gaming', '', '   ', null, undefined, 42, {}]) {
    assert.throws(
      () => resolveDomain(bad),
      (err) => {
        assert.ok(err instanceof DomainMappingError);
        assert.equal(err.code, 'INVALID_DOMAIN');
        return true;
      },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
  assert.throws(() => resolveDomain('gaming'), (err) => {
    assert.match(err.message, /film \(film\/movie\/movies\/cinema\)/);
    assert.match(err.message, /fashion/);
    return true;
  });
});

test('resolveDomains dedupes and preserves order', () => {
  assert.deepEqual(resolveDomains(['Film', 'music', 'movie', ' books ']), [
    'film',
    'music',
    'books',
  ]);
  assert.throws(() => resolveDomains(['film', 'gaming']), (err) => {
    assert.equal(err.code, 'INVALID_DOMAIN');
    return true;
  });
});

// --- per-endpoint type resolution -----------------------------------------------

test('searchTypesFor returns per-domain search types (multi-type domains)', () => {
  assert.deepEqual(searchTypesFor('film'), ['urn:entity:movie', 'urn:entity:tv_show']);
  assert.deepEqual(searchTypesFor('music'), ['urn:entity:artist', 'urn:entity:album']);
  assert.deepEqual(searchTypesFor('books'), ['urn:entity:book']);
  assert.deepEqual(searchTypesFor('dining'), ['urn:entity:place']);
  assert.deepEqual(searchTypesFor('fashion'), ['urn:entity:brand']);
  assert.throws(() => searchTypesFor('gaming'), (err) => {
    assert.equal(err.code, 'INVALID_DOMAIN');
    return true;
  });
});

test('primaryInsightType picks the single filter.type per domain', () => {
  assert.equal(primaryInsightType('film'), 'urn:entity:movie');
  assert.equal(primaryInsightType('music'), 'urn:entity:artist');
  assert.equal(primaryInsightType('books'), 'urn:entity:book');
  assert.equal(primaryInsightType('dining'), 'urn:entity:place');
  assert.equal(primaryInsightType('fashion'), 'urn:entity:brand');
  assert.deepEqual(insightTypesFor('film'), ['urn:entity:movie', 'urn:entity:tv_show']);
  assert.deepEqual(insightTypesFor('music'), ['urn:entity:artist']);
});

// task 193: the production affinityFn must see a domain the client accepts.
test('toInsightsDomain: agent vocab maps, raw URNs pass through, unknown falls through', () => {
  // Agent vocabulary -> insights URN (the fetchAffinityVector contract).
  assert.equal(toInsightsDomain('books'), 'urn:entity:book');
  assert.equal(toInsightsDomain('dining'), 'urn:entity:place');
  assert.equal(toInsightsDomain('fashion'), 'urn:entity:brand');
  assert.equal(toInsightsDomain('film'), 'urn:entity:movie');
  assert.equal(toInsightsDomain('music'), 'urn:entity:artist');
  // Raw URNs pass through untouched (primaryInsightType throws on them).
  assert.equal(toInsightsDomain('urn:entity:brand'), 'urn:entity:brand');
  assert.equal(toInsightsDomain('urn:entity:place'), 'urn:entity:place');
  assert.equal(
    toInsightsDomain('  urn:Entity:Book '),
    '  urn:Entity:Book ',
    'the URN check is case/space tolerant and returns the value unchanged',
  );
  // Unknown vocabulary falls through so the client keeps its own
  // INVALID_TARGET_DOMAIN guidance instead of a mapper DomainMappingError.
  assert.equal(toInsightsDomain('spaceship'), 'spaceship');
  // Non-strings pass through for the client to reject.
  assert.equal(toInsightsDomain(undefined), undefined);
  assert.equal(toInsightsDomain(null), null);
});

// --- round-trip consistency with the existing service clients -------------------

test('search types pass through entitySearchClient.resolveDomain unchanged', () => {
  for (const domain of MANDATORY_DOMAINS) {
    for (const urn of searchTypesFor(domain)) {
      // resolveDomain returns an ARRAY of URNs (unlike the cross-domain
      // client's single-string resolver) — compare structurally.
      assert.deepEqual(
        searchResolveDomain(urn),
        [urn],
        `${urn} must be accepted by the search client (raw URN pass-through)`
      );
    }
  }
});

test('insight types pass through crossDomainClient.resolveTargetDomain', () => {
  for (const domain of MANDATORY_DOMAINS) {
    for (const urn of insightTypesFor(domain)) {
      assert.equal(
        resolveTargetDomain(urn),
        urn,
        `${urn} must be accepted by the cross-domain client`
      );
    }
  }
});

// --- classifyEntity: inbound direction -------------------------------------------

test('classifies media entities from raw and normalized shapes', () => {
  // raw search shape: types[] + string/URN tags
  assert.equal(classifyEntity({ types: ['urn:entity:movie'] }), 'film');
  assert.equal(classifyEntity({ types: ['urn:entity:tv_show'] }), 'film');
  // normalized client shape: subtype + tags[{id}]
  assert.equal(classifyEntity({ subtype: 'urn:entity:movie', tags: [] }), 'film');
  assert.equal(classifyEntity({ subtype: 'urn:entity:artist' }), 'music');
  assert.equal(classifyEntity({ types: ['urn:entity:album'], tags: [] }), 'music');
  assert.equal(classifyEntity({ subtype: 'urn:entity:book' }), 'books');
  // mixed shapes and type fallbacks
  assert.equal(classifyEntity({ type: 'urn:entity:book', name: 'Dune' }), 'books');
  assert.equal(
    classifyEntity({ types: ['urn:entity:artist', 'urn:entity:person'] }),
    'music',
    'first matching subtype wins'
  );
});

test('dining requires a restaurant tag family (a park is not dining)', () => {
  assert.equal(
    classifyEntity({ subtype: 'urn:entity:place', tags: [] }),
    null,
    'a bare place entity is NOT dining'
  );
  assert.equal(
    classifyEntity({ subtype: 'urn:entity:place', tags: [{ id: 'urn:tag:category:place:museum' }] }),
    null
  );
  // live-verified restaurant tag shapes
  assert.equal(
    classifyEntity({
      subtype: 'urn:entity:place',
      tags: [{ id: 'urn:tag:genre:place:restaurant', name: 'Restaurant' }],
    }),
    'dining'
  );
  assert.equal(
    classifyEntity({
      types: ['urn:entity:place'],
      tags: [{ tag_id: 'urn:tag:genre:place:restaurant:pizza' }],
    }),
    'dining',
    'tag_id fallback + ":value" suffix'
  );
  assert.equal(
    classifyEntity({
      subtype: 'urn:entity:place',
      tags: ['urn:tag:category:place:restaurant'],
    }),
    'dining',
    'string tags are accepted'
  );
});

test('fashion requires the fashion genre family (service brands do not)', () => {
  assert.equal(
    classifyEntity({ subtype: 'urn:entity:brand', tags: [] }),
    null,
    'a bare brand is NOT fashion'
  );
  assert.equal(
    classifyEntity({
      subtype: 'urn:entity:brand',
      tags: [{ id: 'urn:tag:genre:brand:mobile_app' }],
    }),
    null,
    'Nike Training Club-style service brand is not fashion'
  );
  // live-verified: Nike carries the fashion family, incl. deep suffixes
  assert.equal(
    classifyEntity({
      subtype: 'urn:entity:brand',
      tags: [{ id: 'urn:tag:genre:brand:fashion' }],
    }),
    'fashion'
  );
  assert.equal(
    classifyEntity({
      types: ['urn:entity:brand'],
      tags: [{ id: 'urn:tag:genre:brand:fashion:footwear:sneaker:running' }],
    }),
    'fashion'
  );
});

test('classifyEntity tolerates unusable input and ignores junk tags', () => {
  for (const bad of [null, undefined, 'str', 42, []]) {
    assert.equal(classifyEntity(bad), null, `input ${JSON.stringify(bad)}`);
  }
  assert.equal(classifyEntity({}), null);
  // malformed tags must not crash classification
  assert.equal(
    classifyEntity({
      subtype: 'urn:entity:place',
      tags: [null, 'garbage', 42, { id: 'not-a-urn' }, { tag_id: 7 }],
    }),
    null
  );
  // person is outside the five mandatory domains
  assert.equal(classifyEntity({ subtype: 'urn:entity:person' }), null);
});

// --- groupByDomain -----------------------------------------------------------------

test('groupByDomain buckets entities, preserving order, keeping unmapped', () => {
  const severance = { subtype: 'urn:entity:tv_show', name: 'Severance' };
  const kendrick = { subtype: 'urn:entity:artist', name: 'Kendrick Lamar' };
  const dune = { subtype: 'urn:entity:book', name: 'Dune' };
  const lucali = {
    subtype: 'urn:entity:place',
    name: 'Lucali',
    tags: [{ id: 'urn:tag:genre:place:restaurant:pizza' }],
  };
  const nike = {
    subtype: 'urn:entity:brand',
    name: 'Nike',
    tags: [{ id: 'urn:tag:genre:brand:fashion' }],
  };
  const centralPark = { subtype: 'urn:entity:place', name: 'Central Park' };
  const obama = { subtype: 'urn:entity:person', name: 'Obama' };

  const groups = groupByDomain([severance, kendrick, dune, lucali, nike, centralPark, obama]);

  assert.deepEqual(groups.film, [severance]);
  assert.deepEqual(groups.music, [kendrick]);
  assert.deepEqual(groups.books, [dune]);
  assert.deepEqual(groups.dining, [lucali]);
  assert.deepEqual(groups.fashion, [nike]);
  assert.deepEqual(groups.unmapped, [centralPark, obama], 'nothing is dropped');
  assert.equal(Object.keys(groups).length, 6, 'five domains + unmapped');

  // order within a bucket follows input order
  const movies = [
    { subtype: 'urn:entity:movie', name: 'A' },
    { subtype: 'urn:entity:tv_show', name: 'B' },
    { subtype: 'urn:entity:movie', name: 'C' },
  ];
  assert.deepEqual(groupByDomain(movies).film.map((e) => e.name), ['A', 'B', 'C']);

  // non-array input degrades to empty buckets
  const empty = groupByDomain(null);
  assert.deepEqual(empty.film, []);
  assert.deepEqual(empty.unmapped, []);
});

/**
 * Seed entity resolver tests (task 47) — pins the raw-text -> verified
 * entity_id + category pipeline with an injected search stub (zero
 * network): probe ladder construction, deterministic selection,
 * domain-scoped types, typed failure codes (no_results / no_valid_id /
 * no_mapped_entity / upstream_error), the person-domain contract,
 * frozen outputs and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Env must be configured BEFORE the modules under test load (see the
// repo-wide pattern in qlooClient.test.js): the config layer requires
// QLOO_API_KEY at import time.
process.env.QLOO_API_KEY = 'seed-resolver-test-key';

const {
  resolveTextQuery,
  selectBestCandidate,
  extractProbes,
  normalizeNameKey,
  SeedResolutionError,
  RESOLUTION_CODES,
  MAX_PROBE_ATTEMPTS,
} = await import('../src/services/seedEntityResolver.js');
const { InvalidSeedError, resolveSeed } = await import('../src/engine/SeedResolver.js');
const { classifySeedFormat } = await import('../src/engine/SeedClassifier.js');
const { searchTypesFor } = await import('../src/services/domainMapper.js');
const { env } = await import('../src/config/env.js');

const UUID = (tag) =>
  `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;

/** Search stub: canned pages + a call log for assertions. */
function stubSearch(pages) {
  const calls = [];
  const fn = async (query, types, opts) => {
    calls.push({ query, types, opts });
    const page = pages[calls.length - 1];
    return { results: page ?? [] };
  };
  fn.calls = calls;
  return fn;
}

const movie = (name, id = UUID('AAAAAAAA'), popularity = 0.9) => ({
  id,
  name,
  subtype: 'urn:entity:movie',
  popularity,
  tags: [],
});

const artist = (name, id = UUID('BBBBBBBB'), popularity = 0.8) => ({
  id,
  name,
  subtype: 'urn:entity:artist',
  popularity,
  tags: [],
});

const director = (name, id = UUID('CCCCCCCC'), popularity = 0.7) => ({
  id,
  name,
  subtype: 'urn:entity:person',
  popularity,
  tags: [],
});

const restaurant = (name, id = UUID('DDDDDDDD'), popularity = 0.6) => ({
  id,
  name,
  subtype: 'urn:entity:place',
  popularity,
  tags: [
    {
      id: 'urn:tag:genre:place:restaurant',
      name: 'Restaurant',
      type: 'urn:tag:genre:place',
    },
  ],
});

test('direct_title: year-stripped title probed first, verified film entity returned', async () => {
  const search = stubSearch([[movie('Blade Runner')]]);

  const result = await resolveTextQuery('Blade Runner (1982)', { search });

  assert.equal(result.verified, true);
  assert.equal(result.mode, env.MOCK_MODE ? 'mock' : 'live');
  assert.equal(result.format, 'direct_title');
  assert.equal(result.probe.text, 'Blade Runner', 'year stripped from probe');
  assert.equal(result.probe.source, 'title');
  assert.deepEqual(
    { ...result.entity },
    {
      id: movie('Blade Runner').id,
      name: 'Blade Runner',
      category: 'film',
      subtype: 'urn:entity:movie',
      popularity: 0.9,
    }
  );
  assert.equal(result.idValid, true);
  assert.equal(result.match, 'exact', 'exactness judged by the clean probe');
  assert.equal(result.attempts.length, 1);
  // Default scope: ALL agent domain types, take=10.
  assert.deepEqual(search.calls[0].types, [
    'urn:entity:movie',
    'urn:entity:tv_show',
    'urn:entity:artist',
    'urn:entity:album',
    'urn:entity:book',
    'urn:entity:place',
    'urn:entity:brand',
  ]);
  assert.equal(search.calls[0].opts.take, 10);
});

test('direct_title: quoted anchor is de-quoted before probing', async () => {
  const search = stubSearch([[movie('The Matrix')]]);
  const result = await resolveTextQuery('"The Matrix"', { search });
  assert.equal(result.probe.text, 'The Matrix');
  assert.equal(result.match, 'exact');
});

test('person: a particle-bearing artist name probes as name and maps to music', async () => {
  const search = stubSearch([[artist('Ludwig van Beethoven')]]);
  const result = await resolveTextQuery('Ludwig van Beethoven', { search });

  assert.equal(result.format, 'person', 'particles push the classifier to person');
  assert.equal(result.probe.source, 'name');
  assert.equal(result.entity.category, 'music');
  assert.equal(result.match, 'exact');
});

test('domain hint scopes types; a bad hint fails before any search call', async () => {
  const search = stubSearch([[movie('Dune')]]);
  const result = await resolveTextQuery('Dune', { domain: 'film', search });

  assert.deepEqual(search.calls[0].types, searchTypesFor('film'));
  assert.equal(result.entity.category, 'film');

  const untouched = stubSearch([[]]);
  await assert.rejects(
    () => resolveTextQuery('Dune', { domain: 'blockchain', search: untouched }),
    InvalidSeedError
  );
  assert.equal(untouched.calls.length, 0, 'no quota burned on a bad hint');
});

test('aesthetic_description: quoted segment is the first probe, raw text never sent', async () => {
  const search = stubSearch([[movie('Blade Runner')]]);
  const result = await resolveTextQuery('movies like "Blade Runner" but funnier', {
    search,
  });

  assert.equal(result.format, 'aesthetic_description');
  assert.equal(result.probe.text, 'Blade Runner');
  assert.equal(result.probe.source, 'quoted');
  assert.deepEqual(
    search.calls.map((c) => c.query),
    ['Blade Runner'],
    'the full description is never probed (quota discipline)'
  );
});

test('aesthetic_description: fragment ladder falls through until a dining hit', async () => {
  const search = stubSearch([[], [], [restaurant("Lucali's")]]);

  const result = await resolveTextQuery('coffee shops, ambient jazz, rainy afternoons', {
    search,
  });

  assert.equal(result.entity.category, 'dining');
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(
    result.attempts.map((a) => a.count),
    [0, 0, 1]
  );
  assert.ok(search.calls.length <= MAX_PROBE_ATTEMPTS);
});

test('failure: no_results with the probe trail attached', async () => {
  const search = stubSearch([[], []]);
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search }),
    (err) =>
      err instanceof SeedResolutionError &&
      err.code === RESOLUTION_CODES.NO_RESULTS &&
      err.details.attempts.length === 1 &&
      err.details.attempts[0].probe === 'Blade Runner'
  );
});

test('failure: no_valid_id when candidates carry non-UUID ids; opt-out works', async () => {
  const malformed = [{ ...movie('Blade Runner'), id: 'not-a-uuid' }];
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search: stubSearch([malformed]) }),
    (err) =>
      err instanceof SeedResolutionError &&
      err.code === RESOLUTION_CODES.NO_VALID_ID &&
      /refusing to synthesize/.test(err.message)
  );

  const relaxed = await resolveTextQuery('Blade Runner', {
    search: stubSearch([malformed]),
    requireValidId: false,
  });
  assert.equal(relaxed.idValid, false, 'flagged, not silently accepted');
  assert.equal(relaxed.entity.id, 'not-a-uuid');
});

test('person-domain contract: a pure director fails no_mapped_entity; opt-out returns null category', async () => {
  const page = [director('Stanley Kubrick')];

  await assert.rejects(
    () => resolveTextQuery('Stanley Kubrick', { search: stubSearch([page]) }),
    (err) =>
      err instanceof SeedResolutionError &&
      err.code === RESOLUTION_CODES.NO_MAPPED_ENTITY
  );

  const relaxed = await resolveTextQuery('Stanley Kubrick', {
    search: stubSearch([page]),
    requireMapped: false,
  });
  assert.equal(relaxed.entity.category, null, 'reported, never faked');
});

test('extraTypes escape hatch widens the search scope', async () => {
  const search = stubSearch([[director('Stanley Kubrick')]]);
  const result = await resolveTextQuery('Stanley Kubrick', {
    search,
    requireMapped: false,
    extraTypes: ['urn:entity:person'],
  });

  assert.ok(search.calls[0].types.includes('urn:entity:person'));
  assert.equal(result.entity.category, null);
});

test('allow_fuzzy=false enforces exact names; min_popularity gates candidates', async () => {
  await assert.rejects(
    () =>
      resolveTextQuery('Blade Runner', {
        search: stubSearch([[movie('Blade Runner (1982)')]]),
        allowFuzzy: false,
      }),
    (err) => err.code === RESOLUTION_CODES.NO_RESULTS
  );

  await assert.rejects(
    () =>
      resolveTextQuery('Blade Runner', {
        search: stubSearch([[movie('Blade Runner', UUID('AAAAAAAA'), 0.1)]]),
        minPopularity: 0.5,
      }),
    (err) => err.code === RESOLUTION_CODES.NO_RESULTS
  );

  const ok = await resolveTextQuery('Blade Runner', {
    search: stubSearch([[movie('Blade Runner', UUID('AAAAAAAA'), 0.9)]]),
    minPopularity: 0.5,
    allowFuzzy: false,
  });
  assert.equal(ok.match, 'exact');
});

test('upstream failure is wrapped typed with cause and attempt trail', async () => {
  const boom = new Error('gateway exploded');
  const search = async () => {
    throw boom;
  };
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search }),
    (err) =>
      err instanceof SeedResolutionError &&
      err.code === RESOLUTION_CODES.UPSTREAM_ERROR &&
      err.cause === boom &&
      err.details.attempts[0].error === 'gateway exploded'
  );
});

test('selection is deterministic: popularity desc, then name, then id', () => {
  const a = movie('Blade Runner', UUID('AAAAAAAA'), 0.9);
  const b = movie('Blade Runner', UUID('BBBBBBBB'), 0.9);
  const c = movie('Blade Runner', UUID('CCCCCCCC'), 0.95);
  const queryKey = normalizeNameKey('Blade Runner');

  const first = selectBestCandidate([a, b, c], { queryKey });
  const shuffled = selectBestCandidate([b, c, a], { queryKey });
  assert.equal(first.best.id, c.id, 'highest popularity wins');
  assert.equal(shuffled.best.id, c.id, 'input order irrelevant');

  const tie = selectBestCandidate([a, b], { queryKey });
  assert.equal(tie.best.id, a.id, 'equal popularity -> name -> id order');
  assert.equal(tie.alternatives[0].id, b.id);
  assert.equal(tie.match, 'exact');
  assert.equal(tie.ambiguous, true);
});

test('output is fully frozen, serializable and reproducible', async () => {
  const pages = () => [[movie('Blade Runner', UUID('AAAAAAAA'), 0.9), movie('Blade Runner', UUID('BBBBBBBB'), 0.5)]];
  const run = () => resolveTextQuery('Blade Runner', { search: stubSearch(pages()) });

  assert.deepEqual(await run(), await run(), 'identical calls -> identical records');

  const result = await run();
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.entity));
  assert.ok(Object.isFrozen(result.query));
  assert.ok(Object.isFrozen(result.alternatives));
  assert.ok(Object.isFrozen(result.attempts));
  assert.throws(() => {
    result.entity.id = 'hijacked';
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(result)).entity.category, 'film');
  assert.equal(result.alternatives.length, 1, 'runner-up reported');
});

test('ingest validation: typed seed errors before any network call', async () => {
  const search = stubSearch([[]]);
  await assert.rejects(() => resolveTextQuery('a', { search }), InvalidSeedError);
  await assert.rejects(() => resolveTextQuery('', { search }), InvalidSeedError);
  assert.equal(search.calls.length, 0, 'zero quota on invalid input');
});

// ---------------------------------------------------------------------------
// Task 48 — statistical candidate ranking inside ambiguous resolution.
// ---------------------------------------------------------------------------

test('ambiguous search: graph affinity outranks raw popularity, relevance explained', async () => {
  const popular = {
    ...movie('Blade Runner', UUID('AAAAAAAA'), 0.95),
    affinity: 0.4,
  };
  const graphFavorite = {
    ...movie('Blade Runner', UUID('BBBBBBBB'), 0.5),
    affinity: 0.99,
  };
  const search = stubSearch([[popular, graphFavorite]]);

  const result = await resolveTextQuery('Blade Runner', { search });

  assert.equal(result.entity.id, graphFavorite.id, 'the graph opinion wins');
  assert.equal(result.match, 'exact', 'both are exact-name candidates');
  assert.equal(result.ambiguous, true);
  assert.equal(result.relevance.signals.graphAffinity, 0.99);
  assert.ok('nameSimilarity' in result.relevance.signals);
  assert.equal(result.alternatives[0].id, popular.id);
  assert.ok(typeof result.alternatives[0].score === 'number', 'runner-up scored');
  assert.ok(result.relevance.score > result.alternatives[0].score);
  assert.ok(Object.isFrozen(result.relevance));
});

test('ambiguous search: taste words from the query drive tag overlap', async () => {
  const moody = {
    ...movie('Blade Runner', UUID('AAAAAAAA'), 0.6),
    tags: [{ id: 'urn:tag:keyword:media:moody', name: 'Moody', type: 'urn:tag:keyword:media' }],
  };
  const feelGood = {
    ...movie('Blade Runner', UUID('BBBBBBBB'), 0.6),
    tags: [{ id: 'urn:tag:keyword:media:feel_good', name: 'Feel Good', type: 'urn:tag:keyword:media' }],
  };
  const search = stubSearch([[feelGood, moody]]);

  const result = await resolveTextQuery('moody films like "Blade Runner"', { search });

  assert.equal(result.entity.id, moody.id, 'the mood-matching entity wins');
  assert.equal(result.relevance.signals.tagOverlap, 1);
  assert.equal(result.alternatives[0].id, feelGood.id);
});

test('ambiguous search: domainFit breaks a tie under a domain hint', async () => {
  const band = artist('Kraftwerk', UUID('AAAAAAAA'), 0.5);
  const venue = restaurant('Kraftwerk', UUID('BBBBBBBB'), 0.5);
  const search = stubSearch([[band, venue]]);

  const result = await resolveTextQuery('Kraftwerk', { domain: 'music', search });

  assert.equal(result.entity.id, band.id, 'the hinted-domain entity wins');
  assert.equal(result.relevance.signals.domainFit, 1);
  assert.equal(result.entity.category, 'music');
});

test('probe extraction unit: dedup, ladder order, description rules', () => {
  const probeOf = (text, domain) => {
    const seed = resolveSeed(text, domain ? { domain } : undefined);
    return extractProbes(classifySeedFormat(seed), seed);
  };

  // Title == normalized collapses to one probe.
  assert.deepEqual(probeOf('The Godfather'), [
    { text: 'The Godfather', source: 'title' },
  ]);
  // Year stripping yields the clean probe first, then the full text.
  assert.deepEqual(probeOf('Blade Runner (1982)').map((p) => p.source), [
    'title',
    'normalized',
  ]);
  // Person: single probe (particles mark the person format).
  assert.deepEqual(probeOf('Ludwig van Beethoven'), [
    { text: 'Ludwig van Beethoven', source: 'name' },
  ]);
  // Description: quotes first, fragments after, single fragment dropped.
  const ladder = probeOf('films like "Blade Runner" and "Annihilation", moody');
  assert.deepEqual(ladder.map((p) => p.source), ['quoted', 'quoted', 'fragment']);

  // All probes respect the search client's 200-char ceiling.
  for (const probe of probeOf('x '.repeat(55))) {
    assert.ok(probe.text.length <= 200);
  }
});

test('name-based seed: a weak same-prefix PLACE is rejected (never a wrong venue)', async () => {
  // The real bug: "Bong Joon-ho" (a director) was fuzzy-matched to
  // "Bong Sung ... Restaurant" (only "Bong" shared) -> a WRONG dossier.
  const place = restaurant('Bong Sung Vegetarian Restaurant');
  await assert.rejects(
    () => resolveTextQuery('Bong Joon-ho', { search: stubSearch([[place]]) }),
    (err) =>
      err instanceof SeedResolutionError &&
      err.code === RESOLUTION_CODES.NO_RESULTS,
    'a weak same-prefix place never wins a name-based seed'
  );
});

test('aesthetic seed: a weak place match is EXEMPT (resolves by taste, not name)', async () => {
  // The aesthetic path matches by TASTE, so a venue whose name shares
  // nothing with the description is still a legitimate resolution — the
  // place floor is deliberately not applied to aesthetic seeds.
  const place = restaurant("Lucali's");
  const result = await resolveTextQuery('coffee shops, ambient jazz, rainy afternoons', {
    search: stubSearch([[], [], [place]]),
  });
  assert.equal(result.entity.name, "Lucali's", 'the aesthetic path is exempt from the place floor');
});

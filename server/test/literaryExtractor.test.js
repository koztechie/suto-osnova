/**
 * Literary extractor tests (task 52) — pins the literary-layer contract
 * with an injected affinity client (zero network): the >0.65
 * correlation rule (strictly above, missing correlation dropped by
 * default), author/essayist identification via marker tables,
 * philosophical-first text ranking, parallel leg isolation, typed
 * failures, limits and deterministic frozen outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'literary-extractor-test-key';

const {
  extractLiteraryProfile,
  matchEntityMarkers,
  applyCorrelation,
  LiteraryExtractionError,
  LITERARY_CODES,
  LITERARY_DEFAULTS,
  LITERARY_LEGS,
  MIN_CORRELATION,
  ESSAY_MARKERS,
  PHILOSOPHY_MARKERS,
} = await import('../src/services/literaryExtractor.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ANCHOR = { id: UUID('SEED000'), name: 'Blade Runner', category: 'film' };

const tag = (value, name) => ({ id: `urn:tag:genre:book:${value}`, name, type: 'urn:tag:genre:book' });
const person = (t, name, affinity, tags = []) => ({
  id: UUID(t), name, subtype: 'urn:entity:person', popularity: 0.6, affinity, tags,
});
const book = (t, name, affinity, tags = []) => ({
  id: UUID(t), name, subtype: 'urn:entity:book', popularity: 0.5, affinity, tags,
});

const SONTAG = person('PER0001', 'Susan Sontag', 0.8, [
  tag('essay', 'Essay'), tag('non_fiction', 'Non Fiction'),
]);
const ORTEGA = person('PER0002', 'Ortega y Gasset', 0.9, [tag('essayist', 'Essayist')]);
const ZIZEK = person('PER0003', 'Slavoj Zizek', 0.75, [tag('philosophy', 'Philosophy')]);
const BELOW = person('PER0004', 'Popular Memoirist', 0.5);
const UNVERIFIED = { id: UUID('PER0005'), name: 'No Correlation', subtype: 'urn:entity:person', tags: [] };

const defaultStubs = () => ({
  affinityFn: async (ids, urn) => {
    if (urn === 'urn:entity:person') return { results: [SONTAG, ORTEGA, ZIZEK, BELOW, UNVERIFIED] };
    return { results: [] };
  },
});

test('anchor validation and threshold validation are typed and fail fast', async () => {
  let calls = 0;
  const affinityFn = async () => { calls += 1; return { results: [] }; };

  await assert.rejects(
    () => extractLiteraryProfile({ id: '' }, { affinityFn }),
    (err) => err instanceof LiteraryExtractionError && err.code === LITERARY_CODES.NO_ANCHOR
  );
  for (const bad of [-0.1, 1.5, 'x', NaN]) {
    await assert.rejects(
      () => extractLiteraryProfile(ANCHOR, { affinityFn, minimumCorrelation: bad }),
      (err) => err.code === LITERARY_CODES.INVALID_THRESHOLD
    );
  }
  assert.equal(calls, 0, 'zero quota on invalid input');
  assert.equal(MIN_CORRELATION, 0.65, 'task contract constant');
  assert.equal(LITERARY_DEFAULTS.minimumCorrelation, 0.65);
});

test('happy path: authors ranked, essayists derived, texts philosophical-first', async () => {
  const BEING = book('BOK0001', 'Being and Nothingness', 0.8, [tag('philosophy', 'Philosophy')]);
  const MEDITATIONS = book('BOK0002', 'Meditations', 0.7, [
    { id: 'urn:tag:genre:book:stoicism', name: 'Stoicism', type: 'urn:tag:genre:book' },
  ]);
  const AIRPORT = book('BOK0003', 'Airport Novel', 0.4);

  const profile = await extractLiteraryProfile(ANCHOR, {
    ...defaultStubs(),
    affinityFn: async (ids, urn) => {
      if (urn === 'urn:entity:person') return defaultStubs().affinityFn(ids, urn);
      return { results: [AIRPORT, MEDITATIONS, BEING] };
    },
  });

  // Authors: correlation desc; below-threshold and unverified dropped.
  assert.deepEqual(profile.authors.map((a) => a.name), [
    'Ortega y Gasset', 'Susan Sontag', 'Slavoj Zizek',
  ]);
  assert.equal(profile.authors[0].correlation, 0.9);
  assert.equal(profile.authors[0].essayist, true);
  assert.equal(profile.authors[2].essayist, false, 'Zizek is philosophy, not essay');

  // Essayists derived from the authors leg.
  assert.deepEqual(profile.essayists.map((e) => e.name), ['Ortega y Gasset', 'Susan Sontag']);
  assert.equal(profile.essayists[0].rank, 1);

  // Texts: philosophical-first, then correlation.
  assert.deepEqual(profile.texts.map((t) => t.name), ['Being and Nothingness', 'Meditations']);
  assert.equal(profile.texts[0].philosophical, true);
  assert.deepEqual([...profile.texts[1].markers], ['stoicism']);

  assert.deepEqual({ ...profile.coverage }, {
    authors: true,
    essayists: true,
    texts: true,
    minimumCorrelation: 0.65,
    droppedBelowCorrelation: 2, // memoirist 0.5 + airport novel 0.4
    droppedUnverified: 1,
  });
  assert.deepEqual(profile.failures, []);
});

test('correlation rule is STRICTLY above the threshold', async () => {
  const at = person('P1', 'At Threshold', 0.65);
  const above = person('P2', 'Above Threshold', 0.650001);

  const profile = await extractLiteraryProfile(ANCHOR, {
    affinityFn: async (ids, urn) =>
      urn === 'urn:entity:person'
        ? { results: [at, above] }
        : { results: [] },
  });

  assert.deepEqual(profile.authors.map((a) => a.name), ['Above Threshold']);
  assert.equal(profile.coverage.droppedBelowCorrelation, 1, '0.65 itself does not qualify');
});

test('missing correlation: dropped by default, flaggable via requireCorrelation=false', async () => {
  const stubs = (rows) => ({
    affinityFn: async (ids, urn) => (urn === 'urn:entity:person' ? { results: rows } : { results: [] }),
  });

  const strictProfile = await extractLiteraryProfile(ANCHOR, stubs([SONTAG, UNVERIFIED]));
  assert.deepEqual(strictProfile.authors.map((a) => a.name), ['Susan Sontag']);
  assert.equal(strictProfile.coverage.droppedUnverified, 1);

  const relaxed = await extractLiteraryProfile(ANCHOR, {
    ...stubs([SONTAG, UNVERIFIED]),
    requireCorrelation: false,
  });
  const unverified = relaxed.authors.find((a) => a.name === 'No Correlation');
  assert.equal(unverified.unverified, true, 'reported, never faked');
  assert.equal(unverified.correlation, null);
  assert.equal(relaxed.authors[relaxed.authors.length - 1].id, unverified.id, 'ranked last');
  assert.equal(relaxed.coverage.droppedUnverified, 0);
});

test('minimumCorrelation override widens or narrows the pool', async () => {
  const profile = await extractLiteraryProfile(ANCHOR, {
    ...defaultStubs(),
    minimumCorrelation: 0.4,
  });
  assert.ok(profile.authors.some((a) => a.name === 'Popular Memoirist'));
  assert.deepEqual([...profile.authors].map((a) => a.correlation), [0.9, 0.8, 0.75, 0.5]);
});

test('marker units: haystack folding across names and tag URNs', () => {
  const entity = { tags: [tag('non_fiction', 'Non Fiction'), tag('philosophy', 'Philosophy')] };
  // "Non Fiction" folds to "non-fiction" — only the hyphenated marker
  // matches; "nonfiction" would need the run-together spelling.
  assert.deepEqual(matchEntityMarkers(entity, ESSAY_MARKERS), ['non-fiction']);
  assert.deepEqual(matchEntityMarkers({ tags: [tag('nonfiction', 'Nonfiction')] }, ESSAY_MARKERS), ['nonfiction']);
  assert.deepEqual(matchEntityMarkers(entity, PHILOSOPHY_MARKERS), ['philosophy']);
  assert.deepEqual(matchEntityMarkers({ tags: [] }, ESSAY_MARKERS), []);
  assert.deepEqual(matchEntityMarkers(null, ESSAY_MARKERS), []);
});

test('applyCorrelation unit: strict above, unverified handling, malformed dropped', () => {
  const rows = [
    { id: 'a', name: 'A', affinity: 0.9 },
    { id: 'b', name: 'B', affinity: 0.65 },
    { id: 'c', name: 'C' },
    { name: 'No Id' },
    'garbage',
  ];
  const strict = applyCorrelation(rows, { minimumCorrelation: 0.65, requireCorrelation: true });
  assert.deepEqual(strict.kept.map((r) => r.id), ['a']);
  assert.equal(strict.droppedBelow, 1);
  assert.equal(strict.droppedUnverified, 1);

  const relaxed = applyCorrelation(rows, { minimumCorrelation: 0.65, requireCorrelation: false });
  assert.deepEqual(relaxed.kept.map((r) => r.id), ['a', 'c']);
  assert.equal(relaxed.kept[1].unverified, true);
});

test('legs: URNs, take passthrough, parallel isolation of failures', async () => {
  const seen = [];
  const down = async (ids, urn, opts) => {
    seen.push({ urn, opts });
    if (urn === 'urn:entity:person') throw Object.assign(new Error('persons down'), { code: 'UPSTREAM_ERROR' });
    return { results: [book('B1', 'Kept Treatise', 0.8, [tag('philosophy', 'Philosophy')])] };
  };

  const profile = await extractLiteraryProfile(ANCHOR, { affinityFn: down, take: 7 });

  assert.deepEqual(seen.map((s) => s.urn).sort(), ['urn:entity:book', 'urn:entity:person']);
  assert.ok(seen.every((s) => s.opts.take === 7));
  assert.equal(profile.coverage.authors, false);
  assert.equal(profile.coverage.texts, true);
  assert.deepEqual(
    profile.failures.map((f) => ({ leg: f.leg, code: f.code })),
    [{ leg: 'authors', code: 'UPSTREAM_ERROR' }]
  );
});

test('both legs failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => extractLiteraryProfile(ANCHOR, { affinityFn: down }),
    (err) =>
      err instanceof LiteraryExtractionError &&
      err.code === LITERARY_CODES.ALL_LEGS_FAILED &&
      err.details.failures.length === LITERARY_LEGS.length
  );

  const oneDown = async (ids, urn) => {
    if (urn === 'urn:entity:person') throw new Error('persons down');
    return { results: [] };
  };
  await assert.rejects(
    () => extractLiteraryProfile(ANCHOR, { affinityFn: oneDown, strict: true }),
    (err) => err.code === LITERARY_CODES.PARTIAL_FAILURE
  );
});

test('authorLimit caps the ranked authors', async () => {
  const profile = await extractLiteraryProfile(ANCHOR, {
    ...defaultStubs(),
    authorLimit: 2,
  });
  assert.equal(profile.authors.length, 2);
  assert.deepEqual(profile.authors.map((a) => a.rank), [1, 2]);
});

test('outputs are deeply frozen, serializable and deterministic', async () => {
  const run = () =>
    extractLiteraryProfile(ANCHOR, {
      affinityFn: async (ids, urn) =>
        urn === 'urn:entity:person'
          ? { results: [SONTAG] }
          : { results: [book('B1', 'Meditations', 0.7, [tag('stoicism', 'Stoicism')])] },
    });

  const profile = await run();
  assert.deepEqual(await run(), profile, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.authors));
  assert.ok(Object.isFrozen(profile.authors[0].markers));
  assert.ok(Object.isFrozen(profile.essayists));
  assert.ok(Object.isFrozen(profile.texts));
  assert.throws(() => {
    profile.authors[0].essayist = false;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(profile)).texts[0].name, 'Meditations', 'serializable');
});

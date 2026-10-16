/**
 * Visual context extractor tests (task 55) — pins the
 * visual-cinematographic contract with injected clients (zero network):
 * two parallel legs (movie affinity + entity-scoped /v2/tags across
 * media|place families), three mandated tag buckets (cinematography
 * techniques / color solutions / art schools) via exported marker
 * tables, concrete FILMS as ranked carriers, carrier-share weights,
 * leg isolation, typed failures and deterministic frozen outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'visual-context-test-key';

const {
  extractVisualContext,
  matchTagMarkers,
  VisualContextError,
  VISUAL_CODES,
  VISUAL_DEFAULTS,
  VISUAL_LEGS,
  VISUAL_TAG_TYPES,
  CINEMATOGRAPHY_MARKERS,
  COLOR_MARKERS,
  ART_SCHOOL_MARKERS,
} = await import('../src/services/visualContextExtractor.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ANCHOR = { id: UUID('SEED000'), name: 'Blade Runner', category: 'film' };

const tag = (value, name) => ({
  id: `urn:tag:genre:media:${value}`,
  name,
  type: 'urn:tag:genre:media',
});

const DEEP_FOCUS = tag('deep_focus', 'Deep Focus');

const NEON_CITY = {
  id: UUID('MOV0001'),
  name: 'Neon City',
  subtype: 'urn:entity:movie',
  affinity: 0.9,
  popularity: 0.8,
  tags: [
    DEEP_FOCUS,
    tag('slow_cinema', 'Slow Cinema'),
    tag('technicolor', 'Technicolor'),
    tag('film_noir', 'Film Noir'),
  ],
};
const THE_LOOK = {
  id: UUID('MOV0002'),
  name: 'The Look',
  subtype: 'urn:entity:movie',
  affinity: 0.7,
  popularity: 0.5,
  tags: [
    tag('monochrome', 'Monochrome'),
    tag('german_expressionism', 'German Expressionism'),
    tag('dutch_angle', 'Dutch Angle'),
  ],
};

const CATALOG = [
  DEEP_FOCUS, // same URN as Neon City's -> merged sources
  tag('chiaroscuro', 'Chiaroscuro'),
  tag('teal_orange', 'Teal Orange'),
  tag('surrealism', 'Surrealism'),
];

const stubs = () => ({
  affinityFn: async (ids, urn) => {
    assert.deepEqual(urn, 'urn:entity:movie');
    return { results: [NEON_CITY, THE_LOOK] };
  },
  tagsFn: async () => ({ results: CATALOG }),
});

test('anchor validation typed, clients never called', async () => {
  let calls = 0;
  const affinityFn = async () => { calls += 1; return { results: [] }; };
  const tagsFn = async () => { calls += 1; return { results: [] }; };

  for (const bad of [null, {}, { id: '' }]) {
    await assert.rejects(
      () => extractVisualContext(bad, { affinityFn, tagsFn }),
      (err) => err instanceof VisualContextError && err.code === VISUAL_CODES.NO_ANCHOR
    );
  }
  assert.equal(calls, 0);
});

test('full assembly: three tag buckets + ranked films', async () => {
  const profile = await extractVisualContext(ANCHOR, stubs());

  // Cinematography: carriers first (name order), catalog-only last.
  assert.deepEqual(profile.cinematography.map((t) => t.name), [
    'Deep Focus', 'Dutch Angle', 'Slow Cinema', 'Chiaroscuro',
  ]);
  const deepFocus = profile.cinematography.find((t) => t.name === 'Deep Focus');
  assert.deepEqual([...deepFocus.sources], ['anchor_tags', 'film']);
  assert.equal(deepFocus.carriers, 1);
  assert.ok(Math.abs(deepFocus.weight - 1 / 2) < 1e-12, 'carrier share of 2 films');

  // Color solutions.
  assert.deepEqual(profile.colorSolutions.map((t) => t.name), [
    'Monochrome', 'Technicolor', 'Teal Orange',
  ]);

  // Art schools: "German Expressionism" nests "expressionism" -> 2
  // markers win the tie-break over Film Noir's single marker.
  assert.deepEqual(profile.artSchools.map((t) => t.name), [
    'German Expressionism', 'Film Noir', 'Surrealism',
  ]);

  // Films: most visual markers first, then correlation; category film.
  assert.deepEqual(profile.films.map((f) => f.name), ['Neon City', 'The Look']);
  assert.deepEqual([...profile.films[0].cinematographyMarkers], ['deep-focus', 'slow-cinema'], 'table order');
  assert.deepEqual([...profile.films[0].colorMarkers], ['technicolor']);
  assert.deepEqual([...profile.films[0].schoolMarkers], ['film-noir']);
  assert.equal(profile.films[0].category, 'film', 'movie type classifies into the film domain');

  assert.deepEqual({ ...profile.coverage }, {
    cinematography: true,
    colorSolutions: true,
    artSchools: true,
    films: true,
    entities: 2,
    tags: 10,
  });
  assert.deepEqual(profile.failures, []);
});

test('legs: movie URN and visual tag-type families passed through with takes', async () => {
  const seen = { urns: [], tagTypes: [] };
  const affinityFn = async (ids, urn, opts) => {
    seen.urns.push({ urn, take: opts.take });
    return { results: [] };
  };
  const tagsFn = async (entityId, type, opts) => {
    seen.tagTypes.push({ type, take: opts.take });
    return { results: [] };
  };

  await extractVisualContext(ANCHOR, { affinityFn, tagsFn, entityTake: 4, tagsTake: 25 });

  assert.deepEqual(seen.urns, [{ urn: 'urn:entity:movie', take: 4 }]);
  assert.deepEqual([...seen.tagTypes[0].type], [...VISUAL_TAG_TYPES]);
  assert.equal(VISUAL_TAG_TYPES.includes('urn:tag:genre:media'), true);
  assert.equal(seen.tagTypes[0].take, 25);
  assert.equal(VISUAL_DEFAULTS.visualLimit, 6);
});

test('cross-bucket overlap: one tag can inform colors and schools', async () => {
  const neonNoir = tag('neon_film_noir', 'Neon Film Noir');
  const profile = await extractVisualContext(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [neonNoir] }),
  });

  assert.deepEqual(profile.colorSolutions.map((t) => t.name), ['Neon Film Noir']);
  assert.deepEqual(profile.artSchools.map((t) => t.name), ['Neon Film Noir']);
});

test('leg isolation: tags leg failure never aborts the films leg', async () => {
  const profile = await extractVisualContext(ANCHOR, {
    ...stubs(),
    tagsFn: async () => {
      throw Object.assign(new Error('tags 503'), { code: 'UPSTREAM_ERROR' });
    },
  });

  assert.deepEqual(profile.failures.map((f) => f.leg), ['tags']);
  assert.equal(profile.coverage.films, true, 'films leg unaffected');
  assert.ok(profile.cinematography.length > 0, 'film-carried tags survive');
});

test('both legs failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => extractVisualContext(ANCHOR, { affinityFn: down, tagsFn: down }),
    (err) =>
      err instanceof VisualContextError &&
      err.code === VISUAL_CODES.ALL_LEGS_FAILED &&
      err.details.failures.length === VISUAL_LEGS.length
  );

  await assert.rejects(
    () => extractVisualContext(ANCHOR, { ...stubs(), tagsFn: down, strict: true }),
    (err) => err.code === VISUAL_CODES.PARTIAL_FAILURE
  );
});

test('visualLimit caps buckets and films', async () => {
  const profile = await extractVisualContext(ANCHOR, { ...stubs(), visualLimit: 1 });
  assert.equal(profile.cinematography.length, 1);
  assert.equal(profile.artSchools.length, 1);
  assert.equal(profile.films.length, 1);
  assert.equal(profile.films[0].name, 'Neon City', 'top film survives the cap');
});

test('entity dedup: a repeated film id counts once', async () => {
  const profile = await extractVisualContext(ANCHOR, {
    affinityFn: async () => ({ results: [NEON_CITY, { ...NEON_CITY, affinity: 0.1 }] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.equal(profile.films.length, 1);
  assert.equal(profile.films[0].affinity, 0.9, 'first occurrence wins');
  assert.equal(profile.coverage.entities, 1);
});

test('marker units: hyphen folding, substring nesting, table order', () => {
  assert.deepEqual(matchTagMarkers({ name: 'Deep Focus', id: 'x' }, CINEMATOGRAPHY_MARKERS), ['deep-focus']);
  assert.deepEqual(matchTagMarkers({ name: 'Slow Cinema', id: 'x' }, CINEMATOGRAPHY_MARKERS), ['slow-cinema']);
  assert.deepEqual(matchTagMarkers({ name: 'Teal Orange', id: 'x' }, COLOR_MARKERS), ['teal-orange']);
  // "German Expressionism" nests "expressionism" — TABLE order applies.
  assert.deepEqual(matchTagMarkers({ name: 'German Expressionism', id: 'x' }, ART_SCHOOL_MARKERS), [
    'expressionism', 'german-expressionism',
  ]);
  assert.deepEqual(matchTagMarkers({ name: 'Sunset', id: 'x' }, COLOR_MARKERS), []);
  assert.deepEqual(matchTagMarkers(null, COLOR_MARKERS), []);
});

test('empty legs are not failures', async () => {
  const profile = await extractVisualContext(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.deepEqual(profile.failures, []);
  assert.deepEqual({ ...profile.coverage }, {
    cinematography: false,
    colorSolutions: false,
    artSchools: false,
    films: false,
    entities: 0,
    tags: 0,
  });
});

test('outputs are deeply frozen, serializable and deterministic', async () => {
  const run = () => extractVisualContext(ANCHOR, stubs());

  const profile = await run();
  assert.deepEqual(await run(), profile, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.cinematography));
  assert.ok(Object.isFrozen(profile.cinematography[0].sources));
  assert.ok(Object.isFrozen(profile.films));
  assert.ok(Object.isFrozen(profile.films[0].schoolMarkers));
  assert.throws(() => {
    profile.films[0].rank = 9;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(profile)).films[0].name, 'Neon City', 'serializable');
});

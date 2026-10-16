/**
 * Gastronomy extractor tests (task 54) — pins the gastronomic-context
 * contract with injected clients (zero network): two parallel legs
 * (place affinity + entity-scoped /v2/tags), three mandated tag
 * buckets (drinks / culinary traditions / venue types) via exported
 * marker tables, concrete VENUES as ranked carriers, carrier-share
 * weights, leg isolation, typed failures and deterministic frozen
 * outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'gastronomy-test-key';

const {
  extractGastronomyContext,
  matchTagMarkers,
  GastronomyError,
  GASTRONOMY_CODES,
  GASTRONOMY_DEFAULTS,
  GASTRONOMY_LEGS,
  GASTRO_TAG_TYPES,
  DRINK_MARKERS,
  CULINARY_TRADITION_MARKERS,
  VENUE_TYPE_MARKERS,
} = await import('../src/services/gastronomyExtractor.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ANCHOR = { id: UUID('SEED000'), name: 'Blade Runner', category: 'film' };

const tag = (value, name) => ({
  id: `urn:tag:genre:place:${value}`,
  name,
  type: 'urn:tag:genre:place',
});

const SAKE = tag('sake', 'Sake');
const RESTAURANT = tag('restaurant', 'Restaurant');

const NEKO = {
  id: UUID('PLC0001'),
  name: 'Izakaya Neko',
  subtype: 'urn:entity:place',
  affinity: 0.85,
  popularity: 0.6,
  tags: [tag('izakaya', 'Izakaya'), tag('japanese', 'Japanese'), SAKE, tag('whiskey', 'Whiskey'), RESTAURANT],
};
const TEMPLE = {
  id: UUID('PLC0002'),
  name: 'Temple Coffee',
  subtype: 'urn:entity:place',
  affinity: 0.6,
  popularity: 0.5,
  tags: [tag('coffeehouse', 'Coffeehouse'), tag('coffee', 'Coffee'), tag('matcha', 'Matcha')],
};

const CATALOG = [
  SAKE, // same URN as Neko's -> merged sources
  tag('farm_to_table', 'Farm To Table'),
  tag('speakeasy', 'Speakeasy'),
];

const stubs = () => ({
  affinityFn: async (ids, urn) => {
    assert.deepEqual(urn, 'urn:entity:place');
    return { results: [NEKO, TEMPLE] };
  },
  tagsFn: async () => ({ results: CATALOG }),
});

test('anchor validation typed, clients never called', async () => {
  let calls = 0;
  const affinityFn = async () => { calls += 1; return { results: [] }; };
  const tagsFn = async () => { calls += 1; return { results: [] }; };

  for (const bad of [null, {}, { id: '' }]) {
    await assert.rejects(
      () => extractGastronomyContext(bad, { affinityFn, tagsFn }),
      (err) => err instanceof GastronomyError && err.code === GASTRONOMY_CODES.NO_ANCHOR
    );
  }
  assert.equal(calls, 0);
});

test('full assembly: three tag buckets + ranked venues', async () => {
  const profile = await extractGastronomyContext(ANCHOR, stubs());

  // Drinks: carrier tags first; substring semantics intentionally pull
  // "Coffeehouse" into drinks (it contains "coffee") — documented.
  assert.deepEqual(profile.drinks.map((t) => t.name), [
    'Coffee', 'Coffeehouse', 'Matcha', 'Sake', 'Whiskey',
  ]);
  const sake = profile.drinks.find((t) => t.name === 'Sake');
  assert.deepEqual([...sake.sources], ['anchor_tags', 'place']);
  assert.equal(sake.carriers, 1);
  assert.ok(Math.abs(sake.weight - 1 / 2) < 1e-12, 'carrier share of 2 venues');

  // Culinary traditions.
  assert.deepEqual(profile.traditions.map((t) => t.name), ['Japanese', 'Farm To Table']);
  assert.equal(profile.traditions[1].carriers, 0, 'catalog-only tradition');

  // Venue types: carriers first, then name, catalog-only last.
  assert.deepEqual(profile.venueTypes.map((t) => t.name), [
    'Coffeehouse', 'Izakaya', 'Restaurant', 'Speakeasy',
  ]);

  // Venues: venue-marker count first, then correlation.
  assert.deepEqual(profile.venues.map((v) => v.name), ['Izakaya Neko', 'Temple Coffee']);
  assert.deepEqual([...profile.venues[0].venueMarkers], ['restaurant', 'izakaya'], 'table order');
  assert.deepEqual([...profile.venues[0].traditionMarkers], ['japanese']);
  assert.deepEqual([...profile.venues[0].drinkMarkers], ['whiskey', 'sake'], 'table order');
  assert.equal(profile.venues[0].category, 'dining', 'restaurant tag family classifies');
  assert.equal(profile.venues[1].category, null);

  assert.deepEqual({ ...profile.coverage }, {
    drinks: true,
    traditions: true,
    venueTypes: true,
    venues: true,
    entities: 2,
    tags: 10,
  });
  assert.deepEqual(profile.failures, []);
});

test('legs: place URN and tag-type families passed through with takes', async () => {
  const seen = { urns: [], tagTypes: [] };
  const affinityFn = async (ids, urn, opts) => {
    seen.urns.push({ urn, take: opts.take });
    return { results: [] };
  };
  const tagsFn = async (entityId, type, opts) => {
    seen.tagTypes.push({ type, take: opts.take });
    return { results: [] };
  };

  await extractGastronomyContext(ANCHOR, { affinityFn, tagsFn, entityTake: 5, tagsTake: 40 });

  assert.deepEqual(seen.urns, [{ urn: 'urn:entity:place', take: 5 }]);
  assert.deepEqual([...seen.tagTypes[0].type], [...GASTRO_TAG_TYPES]);
  assert.equal(seen.tagTypes[0].take, 40);
  assert.equal(GASTRONOMY_DEFAULTS.gastroLimit, 6);
});

test('cross-bucket overlap: one tag can inform drinks and venue types', async () => {
  const ginBar = tag('gin_bar', 'Gin Bar');
  const profile = await extractGastronomyContext(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [ginBar] }),
  });

  assert.deepEqual(profile.drinks.map((t) => t.name), ['Gin Bar']);
  assert.deepEqual(profile.venueTypes.map((t) => t.name), ['Gin Bar']);
});

test('leg isolation: tags leg failure never aborts the places leg', async () => {
  const profile = await extractGastronomyContext(ANCHOR, {
    ...stubs(),
    tagsFn: async () => {
      throw Object.assign(new Error('tags 503'), { code: 'UPSTREAM_ERROR' });
    },
  });

  assert.deepEqual(profile.failures.map((f) => f.leg), ['tags']);
  assert.equal(profile.coverage.venues, true, 'places leg unaffected');
  assert.ok(profile.drinks.length > 0, 'place-carried drink tags survive');
});

test('both legs failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => extractGastronomyContext(ANCHOR, { affinityFn: down, tagsFn: down }),
    (err) =>
      err instanceof GastronomyError &&
      err.code === GASTRONOMY_CODES.ALL_LEGS_FAILED &&
      err.details.failures.length === GASTRONOMY_LEGS.length
  );

  await assert.rejects(
    () => extractGastronomyContext(ANCHOR, { ...stubs(), tagsFn: down, strict: true }),
    (err) => err.code === GASTRONOMY_CODES.PARTIAL_FAILURE
  );
});

test('gastroLimit caps buckets and venues', async () => {
  const profile = await extractGastronomyContext(ANCHOR, { ...stubs(), gastroLimit: 2 });
  assert.equal(profile.drinks.length, 2);
  assert.equal(profile.venueTypes.length, 2);
  assert.equal(profile.venues.length, 2);
  assert.equal(profile.venues[0].name, 'Izakaya Neko', 'top venue survives the cap');
});

test('entity dedup: a repeated place id counts once', async () => {
  const profile = await extractGastronomyContext(ANCHOR, {
    affinityFn: async () => ({ results: [NEKO, { ...NEKO, affinity: 0.1 }] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.equal(profile.venues.length, 1);
  assert.equal(profile.venues[0].affinity, 0.85, 'first occurrence wins');
  assert.equal(profile.coverage.entities, 1);
});

test('marker units: hyphen folding across the three tables', () => {
  assert.deepEqual(matchTagMarkers({ name: 'Farm To Table', id: 'x' }, CULINARY_TRADITION_MARKERS), ['farm-to-table']);
  assert.deepEqual(matchTagMarkers({ name: 'Craft Beer', id: 'x' }, DRINK_MARKERS), ['beer', 'craft-beer'], 'table order, substring hit');
  assert.deepEqual(matchTagMarkers({ name: 'Noodle Shop', id: 'x' }, VENUE_TYPE_MARKERS), ['noodle-shop']);
  assert.deepEqual(matchTagMarkers({ name: 'Museum', id: 'x' }, VENUE_TYPE_MARKERS), []);
  assert.deepEqual(matchTagMarkers(null, DRINK_MARKERS), []);
});

test('empty legs are not failures', async () => {
  const profile = await extractGastronomyContext(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.deepEqual(profile.failures, []);
  assert.deepEqual({ ...profile.coverage }, {
    drinks: false,
    traditions: false,
    venueTypes: false,
    venues: false,
    entities: 0,
    tags: 0,
  });
});

test('outputs are deeply frozen, serializable and deterministic', async () => {
  const run = () => extractGastronomyContext(ANCHOR, stubs());

  const profile = await run();
  assert.deepEqual(await run(), profile, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.drinks));
  assert.ok(Object.isFrozen(profile.drinks[0].sources));
  assert.ok(Object.isFrozen(profile.venues));
  assert.ok(Object.isFrozen(profile.venues[0].drinkMarkers));
  assert.throws(() => {
    profile.venues[0].rank = 9;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(profile)).venues[0].name, 'Izakaya Neko', 'serializable');
});

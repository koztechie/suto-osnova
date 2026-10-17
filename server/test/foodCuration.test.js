/**
 * FoodCuration gate (task 92) — the F&B zone map of the festival
 * ground:
 *   - classification into the pinned ZONE_REGISTRY (priority =
 *     layout order, word boundaries, matched-word explainability);
 *   - vendor sourcing discipline (layer venues first, ranked dining
 *     picks second, name-dedup, honest unclassified);
 *   - overflow honesty (zone_full / limit_reached — listed, never
 *     silently dropped);
 *   - the audience-tested flag (case-insensitive);
 *   - the real runExperiential integration (bundle.foodZones, flag
 *     and limit honored, TypeError bounds);
 *   - rendering, determinism, deep-freeze.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'food-curation-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildFoodCuration, renderFoodCuration, classifyZone,
  ZONE_REGISTRY, FOOD_REASONS,
} = await import('../src/modes/FoodCuration.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { searchStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const tag = (name) => ({ id: `urn:tag:t:${name}`, name, type: 'urn:tag:t' });
const venue = (name, venueMarkers = [], extra = {}) => ({
  id: `urn:place:${name}`, name, category: 'place', venueMarkers, ...extra,
});

const pieces = () => ({
  entity: { id: 'e1', name: 'Static Ash Live', category: 'music' },
  scene: { era: null, location: 'Berlin', geohash: null, startYear: null, endYear: null },
  ranked: [
    { domain: 'dining', name: 'Iron Skillet', affinity: 0.8, tags: [tag('Grill')] },
    { domain: 'dining', name: 'Verdant Bowl', affinity: 0.6, tags: [] },
    { domain: 'music', name: 'Neon Ritual', affinity: 0.92, tags: [] },
  ],
  layers: {
    gastronomy: {
      venues: [
        venue('Basilica Coffee', ['Coffeehouse'], { affinity: 0.9, drinkMarkers: ['coffee'] }),
        venue('The Hop Hall', ['Gastropub'], { affinity: 0.7, drinkMarkers: ['beer'] }),
        venue('Mystery Kitchen', []),
      ],
      drinks: [tag('Coffee'), tag('Beer')],
      traditions: [tag('Street Food')],
    },
  },
  audience: { top: [{ name: 'basilica coffee', affinityPercent: 80 }] },
});

test('classification: registry priority, word boundaries, explainability', () => {
  // The registry order is BOTH the priority and the layout order.
  assert.deepEqual(ZONE_REGISTRY.map((z) => z.kind),
    ['street_food', 'food_hall', 'cafe', 'restaurant', 'bar']);
  // Every registry FIRST word classifies into its own kind.
  for (const entry of ZONE_REGISTRY) {
    assert.equal(classifyZone([entry.words[0]])?.kind, entry.kind, entry.words[0]);
  }
  // Documented priority pairs.
  assert.equal(classifyZone(['Coffee Bar'])?.kind, 'cafe', 'coffee bar is a cafe');
  assert.equal(classifyZone(['Ramen Shop'])?.kind, 'street_food');
  assert.equal(classifyZone(['Fine Dining'])?.kind, 'restaurant');
  assert.equal(classifyZone(['The Speakeasy Door'])?.kind, 'bar');
  // Word boundaries: "grill" never matches "grilled".
  assert.equal(classifyZone(['Grilled Delights']), null);
  assert.equal(classifyZone([]), null);
});

test('zoning: pinned vendors per zone, sources, audience flag, markers', () => {
  const block = buildFoodCuration(pieces());

  assert.deepEqual(block.zones.map((z) => z.kind),
    ['street_food', 'cafe', 'bar'], 'layout order, empty zones excluded');
  assert.deepEqual(block.zones.map((z) => z.name),
    ['Street Food Row', 'Cafe Court', 'Bar Terrace']);
  assert.deepEqual(block.zones.map((z) => z.count), [1, 1, 1]);

  const [street] = block.zones[0].vendors;
  assert.equal(street.name, 'Iron Skillet');
  assert.equal(street.source, 'ranked_pick');
  assert.equal(street.affinityPercent, 80);
  assert.deepEqual([...street.markers], ['grill'], 'the matched word explains the zone');

  const [cafe] = block.zones[1].vendors;
  assert.equal(cafe.source, 'layer_venue');
  assert.equal(cafe.affinityPercent, 90);
  assert.equal(cafe.audienceTested, true, 'case-insensitive audience match');
  assert.deepEqual([...cafe.markers], ['coffeehouse', 'coffee'], 'all fired words');

  const [bar] = block.zones[2].vendors;
  assert.equal(bar.name, 'The Hop Hall');
  assert.deepEqual([...bar.markers], ['gastropub']);

  assert.deepEqual(block.unclassified.map((u) => [u.name, u.reason]), [
    ['Mystery Kitchen', FOOD_REASONS.NO_ZONE_MATCH],
    ['Verdant Bowl', FOOD_REASONS.NO_ZONE_MATCH],
  ], 'layer venues considered first; unproven candidates never placed');
  assert.deepEqual([...block.beverageDirection], ['Coffee', 'Beer']);
  assert.deepEqual([...block.traditions], ['Street Food']);
  assert.equal(block.locality, 'Berlin');

  assert.deepEqual({ ...block.stats }, {
    considered: 5, placed: 3, overflow: 0, unclassified: 2,
    kindsCovered: 3, registrySize: 5, audienceTested: 1,
  });
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.zones[0].vendors[0]));
});

test('overflow honesty: zone_full and limit_reached are listed, never dropped', () => {
  const crowded = pieces();
  crowded.ranked.push({ domain: 'dining', name: 'Kaffee Bar', affinity: 0.7, tags: [tag('Café')] });

  const zoneCapped = buildFoodCuration(crowded, { maxVendorsPerZone: 1 });
  const cafeZone = zoneCapped.zones.find((z) => z.kind === 'cafe');
  assert.equal(cafeZone.count, 1, 'one stall per zone');
  assert.deepEqual(zoneCapped.overflow.map((o) => [o.name, o.reason]),
    [['Kaffee Bar', FOOD_REASONS.ZONE_FULL]]);
  assert.equal(zoneCapped.stats.placed, 3);
  assert.equal(zoneCapped.stats.overflow, 1);

  const mapCapped = buildFoodCuration(crowded, { limit: 1 });
  assert.equal(mapCapped.stats.placed, 1, 'the whole map holds one stall');
  assert.deepEqual(mapCapped.overflow.map((o) => o.reason),
    [FOOD_REASONS.LIMIT_REACHED, FOOD_REASONS.LIMIT_REACHED, FOOD_REASONS.LIMIT_REACHED],
    'the global cap fires before any zone cap can');

  for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 },
    { maxVendorsPerZone: 0 }, { maxVendorsPerZone: 21 }]) {
    assert.throws(() => buildFoodCuration(pieces(), bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => buildFoodCuration(null), TypeError);
  assert.throws(() => buildFoodCuration({ entity: {} }), TypeError);
  assert.throws(() => renderFoodCuration({}), TypeError);
});

test('honest emptiness: no classifiable evidence -> theoretical map', () => {
  const empty = buildFoodCuration({
    entity: { name: 'Static Ash Live', category: 'music' },
    ranked: [{ domain: 'dining', name: 'Verdant Bowl', affinity: 0.6, tags: [] }],
    layers: { gastronomy: null },
  });
  assert.deepEqual([...empty.zones], []);
  assert.equal(empty.stats.placed, 0);
  assert.match(empty.summary, /gastronomic map stays theoretical/);
  assert.match(renderFoodCuration(empty), /gastronomic map stays theoretical/);
});

test('real run: the map rides the activation bundle, flag and limit honored', async () => {
  // Per-domain distinct ids (the shared runner stub reuses ids across
  // domains, and expandTastes dedups globally — dining would vanish).
  const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
  const diner = (name, i, words) => ({
    id: UUID(`d${i}00000`), name, subtype: 'urn:entity:restaurant',
    affinity: 0.9 - i * 0.02, popularity: 0.4,
    tags: words.map((w) => ({ id: `urn:tag:genre:place:${w}`, name: w, type: 'urn:tag:genre:place' })),
  });
  const foodAffinity = async (ids, domain) => {
    if (domain === 'dining') {
      return {
        results: [
          diner('Verde Coffee', 0, ['coffee']),
          diner('Spit & Coal', 1, ['street food']),
          diner('Mystery Pot', 2, []),
          diner('Cellar Door', 3, ['fine dining']),
        ],
      };
    }
    // The gastronomy layer probes the place domain through the same
    // affinity client — no place universe here, honestly empty.
    if (String(domain).includes('place')) return { results: [] };
    return {
      results: [{
        id: UUID(`${domain.slice(0, 1)}90000`), name: `Filler ${domain}`,
        subtype: 'urn:entity:artist', affinity: 0.8, popularity: 0.4,
      }],
    };
  };
  const options = () => ({
    affinityFn: foodAffinity,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    insightsFn: async () => ({ count: 0, results: [] }),
    synthesis: false,
    cutRate: 0,
  });

  const bundle = await runExperiential('Static Ash Live', options());
  assert.ok(bundle.foodZones !== null, 'the map is on by default');
  assert.equal(bundle.foodZones.host.name, bundle.entity.name);
  assert.deepEqual(bundle.foodZones.zones.map((z) => z.kind),
    ['street_food', 'cafe', 'restaurant'],
    'three classified zones in layout order');
  assert.equal(bundle.foodZones.stats.placed, 3);
  assert.deepEqual(bundle.foodZones.unclassified.map((u) => u.name), ['Mystery Pot']);

  const off = await runExperiential('Static Ash Live', { ...options(), foodZones: false });
  assert.equal(off.foodZones, null);

  const capped = await runExperiential('Static Ash Live', { ...options(), foodZoneLimit: 1 });
  assert.equal(capped.foodZones.stats.placed, 1);
  assert.equal(capped.foodZones.overflow.length, 2);

  await assert.rejects(
    () => runExperiential('Static Ash Live', { ...options(), foodZoneLimit: 0 }),
    TypeError
  );
});

test('rendering and determinism', () => {
  const block = buildFoodCuration(pieces());
  const a = renderFoodCuration(block);
  assert.match(a, /^F&B ZONE MAP — Static Ash Live \(music\)$/m);
  assert.match(a, /^ {3}\[cafe\] Cafe Court — 1 stall\(s\)$/m);
  assert.match(a, /^ {6}- Basilica Coffee \(90% affinity\), audience-tested$/m);
  assert.match(a, /^BEVERAGE DIRECTION: Coffee, Beer$/m);
  assert.match(a, /^CULINARY TRADITIONS: Street Food$/m);
  assert.match(a, /^UNCLASSIFIED \(2\): Mystery Kitchen, Verdant Bowl$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(a), 'zero emojis');

  const b = buildFoodCuration(pieces());
  assert.deepEqual(JSON.parse(JSON.stringify(block)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderFoodCuration(block), renderFoodCuration(b));
});

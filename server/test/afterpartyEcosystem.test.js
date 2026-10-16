/**
 * AfterpartyEcosystem gate (task 89) — the afterparty block of the
 * activation brief:
 *   - synthetic evidence: layer venues + ranked dining picks classify
 *     into kinds, authenticity tiers fire from the pinned markers,
 *     unclassified venues are honestly counted and LEFT OUT;
 *   - entry-by-entry pinning of KIND_REGISTRY and AUTHENTICITY_MARKERS;
 *   - the anti-fabrication contract (names only from the pieces,
 *     kinds only from the registry);
 *   - the real runExperiential integration (block present, honest
 *     emptiness, disable flag, limit);
 *   - rendering, determinism, deep-freeze, TypeError guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'afterparty-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildAfterpartyEcosystem, renderAfterpartyEcosystem,
  classifyVenueKind, authenticityOf,
  KIND_REGISTRY, AUTHENTICITY_MARKERS,
} = await import('../src/modes/AfterpartyEcosystem.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const tag = (name) => ({ id: `urn:tag:t:${name}`, name, type: 'urn:tag:t' });
const venue = (name, venueMarkers = [], extra = {}) => ({
  id: `urn:place:${name}`, name, category: 'place', venueMarkers, ...extra,
});

const pieces = () => ({
  entity: { id: 'e1', name: 'Static Ash Live', category: 'music' },
  scene: { era: null, location: 'Berlin', geohash: null, startYear: null, endYear: null },
  ranked: [
    { domain: 'dining', name: 'Midnight Diner', affinity: 0.8, tags: [tag('Late Night')] },
    { domain: 'dining', name: 'Dive & Duck', affinity: 0.6, tags: [] },
    { domain: 'music', name: 'Neon Ritual', affinity: 0.92, tags: [] },
  ],
  layers: {
    gastronomy: {
      venues: [
        venue('The Basement Den', ['Speakeasy', 'Cocktail'], { affinity: 0.7 }),
        venue('Kinetic Warehouse', ['warehouse', 'techno']),
        venue('Grand Hotel Lobby', []),
      ],
      drinks: [tag('Natural Wine')],
      traditions: [tag('Late Night')],
      venueTypes: [tag('Cocktail Bar')],
    },
  },
});

test('classification: layer venues and ranked picks map into kinds and tiers', () => {
  const block = buildAfterpartyEcosystem(pieces());

  assert.deepEqual(block.venues.map((v) => v.name),
    ['The Basement Den', 'Kinetic Warehouse', 'Midnight Diner', 'Dive & Duck'],
    'layer venues first, then ranked dining; unclassified excluded');
  assert.deepEqual(block.venues.map((v) => v.kind),
    ['speakeasy', 'club', 'late_food', 'bar']);
  assert.deepEqual(block.venues.map((v) => v.source),
    ['layer_venue', 'layer_venue', 'ranked_pick', 'ranked_pick']);
  assert.equal(block.venues[0].tier, 'marker_backed', 'speakeasy marker fires');
  assert.deepEqual([...block.venues[0].authenticityMarkers], ['speakeasy']);
  assert.equal(block.venues[1].tier, 'unverified', 'warehouse/techno prove no authenticity');
  assert.equal(block.venues[3].tier, 'marker_backed', 'the "dive" in the name counts');
  assert.equal(block.venues[2].affinityPercent, 80);

  assert.equal(block.stats.considered, 5);
  assert.equal(block.stats.listed, 4);
  assert.equal(block.stats.unclassified, 1, 'Grand Hotel Lobby stays out');
  assert.equal(block.stats.markerBacked, 2);

  assert.deepEqual([...block.drinkDirection], ['Natural Wine']);
  assert.deepEqual([...block.traditions], ['Late Night']);
  assert.deepEqual([...block.venueTypeHints], ['Cocktail Bar'],
    'venue types echo as scene hints, never as per-venue proof');
  assert.equal(block.locality, 'Berlin');
  assert.match(block.summary, /4 nightlife pick\(s\) around Berlin/);
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.venues));
});

test('KIND_REGISTRY: pinned entry by entry, priority order respected', () => {
  for (const entry of KIND_REGISTRY) {
    for (const word of entry.words) {
      assert.equal(classifyVenueKind([word]), entry.kind, `KIND word "${word}"`);
    }
  }
  assert.equal(classifyVenueKind(['listening bar']), 'lounge', 'lounge outranks bar');
  assert.equal(classifyVenueKind(['cocktail den']), 'speakeasy', 'speakeasy outranks all');
  assert.equal(classifyVenueKind(['Grand Hotel Lobby']), null, 'no guess');
  assert.equal(classifyVenueKind([]), null);
});

test('AUTHENTICITY_MARKERS: every marker word fires', () => {
  for (const marker of AUTHENTICITY_MARKERS) {
    assert.ok(authenticityOf([marker]).includes(marker), `marker "${marker}"`);
  }
  assert.deepEqual([...authenticityOf(['chain restaurant'])], []);
});

test('anti-fabrication: names only from the pieces, kinds only from the registry', () => {
  const source = pieces();
  const block = buildAfterpartyEcosystem(source);
  const known = new Set([
    ...source.layers.gastronomy.venues.map((v) => v.name),
    ...source.ranked.map((r) => r.name),
  ]);
  const kinds = new Set(KIND_REGISTRY.map((entry) => entry.kind));
  for (const item of block.venues) {
    assert.ok(known.has(item.name), `invented venue: ${item.name}`);
    assert.ok(kinds.has(item.kind), `invented kind: ${item.kind}`);
    assert.ok(['marker_backed', 'unverified'].includes(item.tier));
  }
  for (const hint of block.venueTypeHints) {
    assert.ok(hint === 'Cocktail Bar');
  }
});

test('honest emptiness: no venue evidence -> theoretical afterparty', () => {
  const block = buildAfterpartyEcosystem({
    entity: { id: 'e2', name: 'Bare Live', category: 'music' },
    ranked: [],
    layers: {},
  });
  assert.deepEqual([...block.venues], []);
  assert.match(block.summary, /afterparty stays theoretical/);
  const document = renderAfterpartyEcosystem(block);
  assert.match(document, /AFTERPARTY ECOSYSTEM — Bare Live/);
  assert.match(document, /afterparty stays theoretical/);
});

test('limit and option bounds', () => {
  const limited = buildAfterpartyEcosystem(pieces(), { limit: 2 });
  assert.equal(limited.venues.length, 2);
  for (const bad of [0, 51, 1.5]) {
    assert.throws(() => buildAfterpartyEcosystem(pieces(), { limit: bad }), TypeError);
  }
  assert.throws(() => buildAfterpartyEcosystem(null), TypeError);
  assert.throws(() => buildAfterpartyEcosystem({ entity: {} }), TypeError);
  assert.throws(() => renderAfterpartyEcosystem({}), TypeError);
});

test('real run: the block rides the activation bundle, flag and limit honored', async () => {
  const options = () => ({
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    insightsFn: async () => ({ count: 0, results: [] }),
    synthesis: false,
  });
  const bundle = await runExperiential('Static Ash Live', options());
  assert.ok(bundle.afterparty !== null, 'the block is on by default');
  assert.equal(bundle.afterparty.host.name, bundle.entity.name);
  assert.deepEqual([...bundle.afterparty.venues], [],
    'stub evidence carries no nightlife venue — honestly empty');
  assert.match(bundle.afterparty.summary, /theoretical/);

  const off = await runExperiential('Static Ash Live', { ...options(), afterparty: false });
  assert.equal(off.afterparty, null);

  await assert.rejects(
    () => runExperiential('Static Ash Live', { ...options(), afterpartyLimit: 0 }),
    TypeError
  );
});

test('determinism and the render contract', () => {
  const a = buildAfterpartyEcosystem(pieces());
  const b = buildAfterpartyEcosystem(pieces());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

  const document = renderAfterpartyEcosystem(a);
  assert.match(document, /^AFTERPARTY ECOSYSTEM — Static Ash Live \(music\)$/m);
  assert.match(document, /^ {3}- \[speakeasy\] The Basement Den \(marker_backed, .* audience affinity\)$/m);
  assert.match(document, /^ {3}- \[club\] Kinetic Warehouse \(unverified\)$/m);
  assert.match(document, /^DRINK DIRECTION: Natural Wine$/m);
  assert.match(document, /^LATE-NIGHT TRADITIONS: Late Night$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');
  assert.equal(renderAfterpartyEcosystem(a), renderAfterpartyEcosystem(b));
});

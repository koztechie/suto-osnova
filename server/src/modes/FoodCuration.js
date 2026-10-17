/**
 * FoodCuration (task 92) — the FOOD & BEVERAGE ZONE MAP of the
 * festival ground: a deterministic zoning of the dossier's own
 * gastronomic evidence (the gastronomy layer's venue entities + the
 * dining-domain ranked picks) into named F&B zones.
 *
 * HOW A VENDOR EARNS ITS PLACE:
 *   1. SOURCE — a real venue entity from the gastronomy layer
 *      (`layer_venue`, carries venueMarkers/traditionMarkers/
 *      drinkMarkers) or a confirmed dining-domain pick
 *      (`ranked_pick`). Layer venues are considered first: an actual
 *      Qloo place outranks a taste-graph neighbor. Names are never
 *      invented; every vendor is an evidence-backed candidate.
 *   2. ZONE — the exported ZONE_REGISTRY classifies the candidate
 *      (word boundaries over the name + its markers + its tag
 *      names) into one of street_food | food_hall | cafe |
 *      restaurant | bar. The registry ORDER is both the
 *      classification PRIORITY (specific formats first — "coffee
 *      bar" is a cafe, "ramen shop" is street food) and the
 *      documented MAP LAYOUT (high-traffic casual near the
 *      entrance, programmed dining next, the bar last). An
 *      UNCLASSIFIED candidate never masquerades as a vendor — it is
 *      honestly listed with reason `no_zone_match`.
 *   3. OVERFLOW HONESTY — two caps can leave a classified candidate
 *      off the map and it says so: `zone_full` (the zone already
 *      holds maxVendorsPerZone stalls) and `limit_reached` (the
 *      whole map already holds `limit` stalls). Overflow is listed,
 *      never silently dropped.
 *   4. AUDIENCE FLAG — a vendor whose name appears in the audience
 *      insights top list (case-insensitive, the task-87 discipline)
 *      is marked `audienceTested` — the strongest F&B programming
 *      argument, asserted only when the leg actually delivered.
 *
 * The block also echoes the BEVERAGE DIRECTION and the culinary
 * TRADITIONS of the gastronomy layer, and the task-84 venue
 * locality.
 *
 * Surfaces: buildFoodCuration(pieces, options) -> frozen block (the
 * runExperiential bundle pieces); renderFoodCuration(block) for the
 * brief. Pure module: no I/O, no clocks, no RNG (pinned by
 * server/test/foodCuration.test.js). Integrated into the activation
 * bundle as `bundle.foodZones` (options.foodZones = false disables,
 * options.foodZoneLimit tunes the cap).
 */

import { connectionScoreOf } from '../engine/ScoreNormalizer.js';

/** Block version. */
export const FOOD_ZONES_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const FOOD_DEFAULTS = Object.freeze({
  limit: 12,
  maxVendorsPerZone: 4,
});

/**
 * The F&B zone vocabulary (exported tuning contract). The array
 * order is the classification priority AND the documented map
 * layout order.
 */
export const ZONE_REGISTRY = Object.freeze([
  Object.freeze({
    kind: 'street_food',
    name: 'Street Food Row',
    words: Object.freeze([
      'street food', 'food truck', 'food stall', 'food cart',
      'diner', 'ramen shop', 'noodle shop', 'taco', 'kebab',
      'bao', 'grill', 'bbq',
    ]),
  }),
  Object.freeze({
    kind: 'food_hall',
    name: 'Food Hall Market',
    words: Object.freeze(['food hall', 'market hall', 'food court']),
  }),
  Object.freeze({
    kind: 'cafe',
    name: 'Cafe Court',
    words: Object.freeze([
      'coffeehouse', 'coffee house', 'cafe', 'café', 'espresso',
      'coffee', 'tea house', 'matcha', 'patisserie', 'bakery',
    ]),
  }),
  Object.freeze({
    kind: 'restaurant',
    name: 'Restaurant Lane',
    words: Object.freeze([
      'fine dining', 'steakhouse', 'delicatessen', 'trattoria',
      'brasserie', 'bistro', 'restaurant',
    ]),
  }),
  Object.freeze({
    kind: 'bar',
    name: 'Bar Terrace',
    words: Object.freeze([
      'cocktail', 'beer hall', 'brewery', 'wine bar', 'gastropub',
      'bar', 'pub', 'tavern', 'izakaya', 'speakeasy',
    ]),
  }),
]);

/** Machine-readable overflow / rejection reasons. */
export const FOOD_REASONS = Object.freeze({
  NO_ZONE_MATCH: 'no_zone_match',
  ZONE_FULL: 'zone_full',
  LIMIT_REACHED: 'limit_reached',
});

const normalizeToken = (value) =>
  value.normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

const wordRegex = (word) =>
  new RegExp(`\\b${normalizeToken(word).replace(/ /g, '[ -]')}\\b`);

/** Precompiled {kind, zoneName, entries: [{word, re}]} records. */
const ZONE_WORDS = Object.freeze(
  ZONE_REGISTRY.map((entry) => Object.freeze({
    kind: entry.kind,
    zoneName: entry.name,
    entries: Object.freeze(entry.words.map(
      (word) => Object.freeze({ word, re: wordRegex(word) })
    )),
  }))
);

/**
 * Classify one candidate: zone verdict or null (honest
 * unclassified). Returns the zone kind, its pinned display name and
 * the matched words (explainability).
 */
export const classifyZone = (strings) => {
  const haystack = strings.filter((s) => typeof s === 'string')
    .map(normalizeToken).join(' | ');
  if (haystack.length === 0) return null;
  for (const entry of ZONE_WORDS) {
    const fired = entry.entries
      .filter(({ re }) => re.test(haystack))
      .map(({ word }) => word);
    if (fired.length > 0) {
      return Object.freeze({
        kind: entry.kind,
        zoneName: entry.zoneName,
        matched: Object.freeze(fired),
      });
    }
  }
  return null;
};

/** The evidence strings of one candidate (name + markers + tags). */
const evidenceStrings = (entry) => [
  entry?.name ?? '',
  ...(Array.isArray(entry?.venueMarkers) ? entry.venueMarkers : []),
  ...(Array.isArray(entry?.traditionMarkers) ? entry.traditionMarkers : []),
  ...(Array.isArray(entry?.drinkMarkers) ? entry.drinkMarkers : []),
  ...(Array.isArray(entry?.tags)
    ? entry.tags.map((t) => t?.name).filter((n) => typeof n === 'string')
    : []),
];

const vendorItem = (entry, source, verdict) => {
  const score = connectionScoreOf(entry);
  return Object.freeze({
    name: entry.name,
    source,
    affinityPercent: typeof score === 'number' ? Math.round(score * 100) : null,
    audienceTested: false, // set by the builder against the audience leg
    markers: verdict.matched,
    note: `${verdict.kind} stall, markers: ${verdict.matched.join(', ')}`,
  });
};

/**
 * Build the F&B zone map.
 *
 * @param {object} pieces { entity, ranked, layers, audience, scene }
 *        — the runExperiential() bundle pieces (audience optional).
 * @param {object} [options] { limit (default 12, clamp 1..50),
 *        maxVendorsPerZone (default 4, clamp 1..20) }.
 * @returns {Readonly<object>} the frozen block.
 */
export function buildFoodCuration(pieces, options = {}) {
  if (!pieces || typeof pieces !== 'object' || !pieces.entity
    || typeof pieces.entity.name !== 'string') {
    throw new TypeError('buildFoodCuration: pieces must carry a named entity');
  }
  const limit = options.limit ?? FOOD_DEFAULTS.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('buildFoodCuration: limit must be an integer in 1..50');
  }
  const maxVendorsPerZone = options.maxVendorsPerZone ?? FOOD_DEFAULTS.maxVendorsPerZone;
  if (!Number.isInteger(maxVendorsPerZone) || maxVendorsPerZone < 1 || maxVendorsPerZone > 20) {
    throw new TypeError('buildFoodCuration: maxVendorsPerZone must be an integer in 1..20');
  }

  const ranked = Array.isArray(pieces.ranked) ? pieces.ranked : [];
  const gastronomy = pieces.layers?.gastronomy ?? null;
  const insightNames = new Set(
    (Array.isArray(pieces.audience?.top) ? pieces.audience.top : [])
      .map((row) => row?.name?.toLowerCase())
      .filter(Boolean)
  );

  // 1. Consideration: layer venues first, then ranked dining picks;
  //    name-deduplicated, classified, honestly capped.
  const byZone = new Map(); // kind -> vendor[]
  const unclassified = [];
  const overflow = [];
  let placed = 0;
  const seen = new Set();
  const consider = (entry, source) => {
    if (!entry || typeof entry.name !== 'string' || entry.name === '') return;
    if (seen.has(entry.name)) return;
    seen.add(entry.name);
    const verdict = classifyZone(evidenceStrings(entry));
    if (verdict === null) {
      unclassified.push(Object.freeze({
        name: entry.name, reason: FOOD_REASONS.NO_ZONE_MATCH,
      }));
      return;
    }
    if (placed >= limit) {
      overflow.push(Object.freeze({
        name: entry.name, zone: verdict.kind, reason: FOOD_REASONS.LIMIT_REACHED,
      }));
      return;
    }
    const zone = byZone.get(verdict.kind) ?? [];
    if (zone.length >= maxVendorsPerZone) {
      overflow.push(Object.freeze({
        name: entry.name, zone: verdict.kind, reason: FOOD_REASONS.ZONE_FULL,
      }));
      return;
    }
    placed += 1;
    const item = { ...vendorItem(entry, source, verdict) };
    if (insightNames.has(entry.name.toLowerCase())) item.audienceTested = true;
    zone.push(Object.freeze(item));
    byZone.set(verdict.kind, zone);
  };
  for (const venue of Array.isArray(gastronomy?.venues) ? gastronomy.venues : []) {
    consider(venue, 'layer_venue');
  }
  for (const entry of ranked.filter((row) => row?.domain === 'dining')) {
    consider(entry, 'ranked_pick');
  }

  // 2. The map: registry (= layout) order, empty zones excluded,
  //    vendors sorted audience-tested first, then affinity, then
  //    name — deterministic presentation.
  const zones = ZONE_REGISTRY
    .filter((zone) => (byZone.get(zone.kind) ?? []).length > 0)
    .map((zone) => {
      const vendors = [...byZone.get(zone.kind)].sort(
        (a, b) => Number(b.audienceTested) - Number(a.audienceTested)
          || (b.affinityPercent ?? -1) - (a.affinityPercent ?? -1)
          || a.name.localeCompare(b.name)
      );
      return Object.freeze({
        kind: zone.kind,
        name: zone.name,
        count: vendors.length,
        vendors: Object.freeze(vendors),
      });
    });

  const beverage = Object.freeze(
    (Array.isArray(gastronomy?.drinks) ? gastronomy.drinks : [])
      .map((tag) => tag?.name)
      .filter((name) => typeof name === 'string')
  );
  const traditions = Object.freeze(
    (Array.isArray(gastronomy?.traditions) ? gastronomy.traditions : [])
      .map((tag) => tag?.name)
      .filter((name) => typeof name === 'string')
  );

  return Object.freeze({
    version: FOOD_ZONES_VERSION,
    host: Object.freeze({
      name: pieces.entity.name,
      domain: pieces.entity.category ?? null,
    }),
    locality: pieces.scene?.location ?? null,
    zones: Object.freeze(zones),
    unclassified: Object.freeze(unclassified),
    overflow: Object.freeze(overflow),
    beverageDirection: beverage,
    traditions,
    summary: placed > 0
      ? `${zones.length} F&B zone(s) with ${placed} stall(s)` +
        `${pieces.scene?.location ? ` around ${pieces.scene.location}` : ''}.`
      : 'No classifiable F&B candidate in the dossier evidence — the gastronomic map stays theoretical.',
    stats: Object.freeze({
      considered: seen.size,
      placed,
      overflow: overflow.length,
      unclassified: unclassified.length,
      kindsCovered: zones.length,
      registrySize: ZONE_REGISTRY.length,
      audienceTested: zones.reduce(
        (sum, zone) => sum + zone.vendors.filter((v) => v.audienceTested).length, 0
      ),
    }),
  });
}

/**
 * Render the printable zone map (deterministic, zero emojis).
 */
export function renderFoodCuration(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.zones)) {
    throw new TypeError('renderFoodCuration: expected a buildFoodCuration() block');
  }
  const lines = [];
  lines.push(`F&B ZONE MAP — ${block.host.name}${block.host.domain ? ` (${block.host.domain})` : ''}`);
  lines.push(block.summary);
  for (const zone of block.zones) {
    lines.push(`   [${zone.kind}] ${zone.name} — ${zone.count} stall(s)`);
    for (const vendor of zone.vendors) {
      lines.push(
        `      - ${vendor.name}` +
          `${vendor.affinityPercent !== null ? ` (${vendor.affinityPercent}% affinity)` : ''}` +
          `${vendor.audienceTested ? ', audience-tested' : ''}`
      );
    }
  }
  if (block.beverageDirection.length > 0) {
    lines.push(`BEVERAGE DIRECTION: ${block.beverageDirection.join(', ')}`);
  }
  if (block.traditions.length > 0) {
    lines.push(`CULINARY TRADITIONS: ${block.traditions.join(', ')}`);
  }
  if (block.unclassified.length > 0) {
    lines.push(`UNCLASSIFIED (${block.unclassified.length}): ${block.unclassified.map((u) => u.name).join(', ')}`);
  }
  if (block.overflow.length > 0) {
    lines.push(`OVERFLOW (${block.overflow.length}): ${block.overflow.map((o) => `${o.name} [${o.reason}]`).join(', ')}`);
  }
  return lines.join('\n');
}

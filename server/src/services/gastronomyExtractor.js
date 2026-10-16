/**
 * Gastronomy extractor (task 54) — the GASTRONOMIC CONTEXT layer of the
 * dossier: from the initial (resolved) cultural anchor it searches
 *
 *   1. SPECIFIC DRINKS      — beverage tags (sake, cocktail, espresso,
 *                             whiskey, matcha …);
 *   2. CULINARY TRADITIONS  — cuisine tags (japanese, farm-to-table,
 *                             mediterranean, ukrainian …);
 *   3. VENUE TYPES          — establishment-type tags (izakaya,
 *                             speakeasy, bistro, coffeehouse …);
 *   plus VENUES              — the concrete place ENTITIES themselves
 *                             (the tangible carriers of the three tag
 *                             families), ranked and category-tagged.
 *
 * TWO PARALLEL LEGS feed one merged tag pool (isolation mirrors tasks
 * 51-53: a failing leg never aborts its sibling):
 *   places leg — cross-domain affinity into `urn:entity:place`
 *                (insights-verified; the dining vector of the anchor);
 *   tags leg   — `/v2/tags` entity-scoped catalog lookup (findTags)
 *                across the proven GASTRO_TAG_TYPES families
 *                (genre|category x place — the exact families the
 *                live-verified dining classification uses).
 *
 * Classification is PURE and table-driven: three EXPORTED marker
 * tables (tuning contracts, hyphen-folding like tasks 51-53) sort the
 * pool into drink/tradition/venue-type buckets; a tag may legitimately
 * inform several buckets. Entries record sources (place|anchor_tags),
 * carriers (how many neighbor places carry the tag) and weight
 * (carrier share of the entity pool). Venues are ranked venue-type
 * markers -> correlation (cross-domain affinity) -> popularity ->
 * name -> id, each with its matched markers across all three families
 * and the domain category via domainMapper.classifyEntity.
 *
 * All I/O is injectable (affinityFn/tagsFn) — fully testable with zero
 * network; no clocks/RNG (deterministic).
 */

import { getCrossDomainAffinities } from './crossDomainClient.js';
import { findTags } from './tasteTagsClient.js';
import { classifyEntity } from './domainMapper.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Typed error for gastronomy-context failures. */
export class GastronomyError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'GastronomyError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const GASTRONOMY_CODES = Object.freeze({
  NO_ANCHOR: 'no_anchor',
  ALL_LEGS_FAILED: 'all_legs_failed',
  PARTIAL_FAILURE: 'partial_failure',
});

/** Documented algorithm defaults. */
export const GASTRONOMY_DEFAULTS = Object.freeze({
  gastroLimit: 6,
  entityTake: 10,
  tagsTake: 30,
});

/** The two upstream legs. */
export const GASTRONOMY_LEGS = Object.freeze(['places', 'tags']);

/** Tag-type families requested from /v2/tags (proven place families). */
export const GASTRO_TAG_TYPES = Object.freeze([
  'urn:tag:genre:place',
  'urn:tag:category:place',
]);

const PLACE_URN = 'urn:entity:place';

/** Bucket marker tables (exported tuning contracts). */
export const DRINK_MARKERS = Object.freeze([
  'cocktail', 'wine', 'whiskey', 'whisky', 'beer', 'craft-beer', 'coffee',
  'espresso', 'tea', 'matcha', 'sake', 'spirits', 'mixology', 'vermouth',
  'gin', 'rum', 'vodka', 'champagne', 'cider',
]);

export const CULINARY_TRADITION_MARKERS = Object.freeze([
  'cuisine', 'italian', 'japanese', 'french', 'mexican', 'thai', 'indian',
  'korean', 'mediterranean', 'greek', 'spanish', 'chinese', 'vietnamese',
  'levantine', 'georgian', 'ukrainian', 'polish', 'turkish', 'lebanese',
  'peruvian', 'ethiopian', 'nordic', 'farm-to-table', 'street-food',
  'comfort-food',
]);

export const VENUE_TYPE_MARKERS = Object.freeze([
  'restaurant', 'bistro', 'izakaya', 'speakeasy', 'coffeehouse', 'cafe',
  'diner', 'brasserie', 'gastropub', 'tavern', 'trattoria', 'bar', 'pub',
  'bakery', 'patisserie', 'delicatessen', 'steakhouse', 'food-hall',
  'ramen-shop', 'noodle-shop',
]);

const BUCKETS = Object.freeze({
  drinks: DRINK_MARKERS,
  traditions: CULINARY_TRADITION_MARKERS,
  venueTypes: VENUE_TYPE_MARKERS,
});

const normalizeHaystack = (value) =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

/** Markers matched by one tag's name + id. */
export function matchTagMarkers(tag, markers) {
  if (!tag || typeof tag !== 'object') return [];
  const haystack = normalizeHaystack(`${tag.name ?? ''} ${tag.id ?? ''}`);
  return markers.filter((marker) => haystack.includes(marker));
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

function pageRows(page) {
  if (Array.isArray(page)) return page;
  if (page && typeof page === 'object') {
    if (Array.isArray(page.results)) return page.results;
    if (Array.isArray(page.results?.tags)) return page.results.tags;
  }
  return [];
}

/** Normalizes a place/catalog row (id + name required). */
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = nonEmptyString(row.id) ?? nonEmptyString(row.entity_id);
  const name = nonEmptyString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    subtype: nonEmptyString(row.subtype) ?? null,
    affinity: finiteNumber(row.affinity),
    popularity: finiteNumber(row.popularity),
    tags: Array.isArray(row.tags)
      ? row.tags
          .map((t) => ({
            id: nonEmptyString(t?.id) ?? nonEmptyString(t?.tag_id) ?? null,
            name: nonEmptyString(t?.name) ?? null,
            type: nonEmptyString(t?.type) ?? null,
          }))
          .filter((t) => t.id !== null || t.name !== null)
      : [],
  };
}

const describeError = (err) =>
  Object.freeze({
    code:
      typeof err?.code === 'string' && err.code.length > 0
        ? err.code
        : typeof err?.name === 'string' && err.name.length > 0
          ? err.name
          : 'unknown_error',
    message: String(err?.message ?? err).slice(0, 300),
  });

const defaultAffinity = (ids, urn, opts) => getCrossDomainAffinities(ids, urn, opts);
const defaultTags = (entityId, type, opts) => findTags(entityId, type, opts);

const byVenueThenCorrelation = (a, b) =>
  b.venueMarkers.length - a.venueMarkers.length ||
  (b.affinity ?? -1) - (a.affinity ?? -1) ||
  (b.popularity ?? -1) - (a.popularity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/**
 * Extracts the gastronomic context of an anchor.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the RESOLVED seed (task 47 shape).
 * @param {object} [options] gastroLimit/entityTake/tagsTake, strict,
 *        injectable affinityFn/tagsFn.
 * @returns {Readonly<object>} frozen record {anchor, drinks, traditions,
 *          venueTypes, venues, coverage, failures}.
 * @throws {GastronomyError} no_anchor | all_legs_failed |
 *         partial_failure (strict).
 */
export async function extractGastronomyContext(anchor, options = {}) {
  const {
    gastroLimit = GASTRONOMY_DEFAULTS.gastroLimit,
    entityTake = GASTRONOMY_DEFAULTS.entityTake,
    tagsTake = GASTRONOMY_DEFAULTS.tagsTake,
    strict = false,
    affinityFn = defaultAffinity,
    tagsFn = defaultTags,
  } = options;

  if (
    !anchor ||
    typeof anchor !== 'object' ||
    typeof anchor.id !== 'string' ||
    anchor.id.length === 0
  ) {
    throw new GastronomyError(
      'extractGastronomyContext: anchor must carry a non-empty string id ' +
        '(resolve the seed first)',
      { code: GASTRONOMY_CODES.NO_ANCHOR, details: { anchor } }
    );
  }

  const anchorName =
    typeof anchor.name === 'string' && anchor.name.trim().length > 0
      ? anchor.name.trim()
      : null;

  // Two legs in parallel, isolated.
  const [placesOutcome, tagsOutcome] = await Promise.allSettled([
    affinityFn([anchor.id], PLACE_URN, { take: entityTake }),
    tagsFn(anchor.id, [...GASTRO_TAG_TYPES], { take: tagsTake }),
  ]);

  const failures = [];
  const rowsOf = (outcome, leg) => {
    if (outcome.status === 'fulfilled') return pageRows(outcome.value);
    failures.push(Object.freeze({ leg, ...describeError(outcome.reason) }));
    return null;
  };
  const placeRows = rowsOf(placesOutcome, 'places');
  const catalogRows = rowsOf(tagsOutcome, 'tags');

  // Neighbor places: normalized, deduped by id.
  const venues = [];
  const seenIds = new Set();
  for (const row of placeRows ?? []) {
    const place = normalizeRow(row);
    if (place === null || seenIds.has(place.id)) continue;
    seenIds.add(place.id);
    venues.push(place);
  }
  const entityCount = venues.length;

  // Merged tag pool: place-carried tags + anchor catalog tags.
  const tagPool = new Map();
  const registerTag = (tag, source, carrierName = null) => {
    const key = tag.id ?? normalizeHaystack(tag.name);
    if (!key) return;
    let entry = tagPool.get(key);
    if (entry === undefined) {
      entry = {
        id: tag.id,
        name: tag.name,
        type: tag.type,
        sources: new Set(),
        carriers: 0,
      };
      tagPool.set(key, entry);
    }
    entry.sources.add(source);
    if (carrierName !== null) entry.carriers += 1;
  };
  for (const place of venues) {
    for (const tag of place.tags) registerTag(tag, 'place', place.name);
  }
  for (const row of catalogRows ?? []) {
    const tag = normalizeRow(row);
    if (tag !== null) registerTag(tag, 'anchor_tags');
  }

  // Classify the pool into the three mandated buckets.
  const buckets = { drinks: [], traditions: [], venueTypes: [] };
  for (const entry of tagPool.values()) {
    const tagShape = { id: entry.id, name: entry.name, type: entry.type };
    for (const [bucket, markers] of Object.entries(BUCKETS)) {
      const matched = matchTagMarkers(tagShape, markers);
      if (matched.length === 0) continue;
      buckets[bucket].push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        markers: matched,
        sources: Object.freeze([...entry.sources].sort()),
        carriers: entry.carriers,
        weight: entityCount > 0 ? entry.carriers / entityCount : 0,
      });
    }
  }

  const rankBucket = (list) =>
    Object.freeze(
      [...list]
        .sort(
          (a, b) =>
            b.carriers - a.carriers ||
            b.markers.length - a.markers.length ||
            String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
            String(a.id ?? '').localeCompare(String(b.id ?? ''))
        )
        .slice(0, gastroLimit)
        .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }))
    );

  // Venues: concrete carriers, venue-type markers first, then correlation.
  const rankedVenues = Object.freeze(
    venues
      .map((place) => {
        const haystack = normalizeHaystack(
          place.tags.map((t) => `${t.name ?? ''} ${t.id ?? ''}`).join(' ')
        );
        const markersOf = (table) => table.filter((m) => haystack.includes(m));
        return {
          ...place,
          venueMarkers: markersOf(VENUE_TYPE_MARKERS),
          traditionMarkers: markersOf(CULINARY_TRADITION_MARKERS),
          drinkMarkers: markersOf(DRINK_MARKERS),
        };
      })
      .sort(byVenueThenCorrelation)
      .map((place, index) =>
        Object.freeze({
          id: place.id,
          name: place.name,
          category: classifyEntity(place) ?? null,
          affinity: place.affinity,
          popularity: place.popularity,
          venueMarkers: Object.freeze(place.venueMarkers),
          traditionMarkers: Object.freeze(place.traditionMarkers),
          drinkMarkers: Object.freeze(place.drinkMarkers),
          rank: index + 1,
        })
      )
      .slice(0, gastroLimit)
  );

  const failedLegs = new Set(failures.map((f) => f.leg));
  if (failedLegs.size === GASTRONOMY_LEGS.length) {
    throw new GastronomyError(
      'every gastronomy leg failed — upstream outage',
      { code: GASTRONOMY_CODES.ALL_LEGS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new GastronomyError(
      `strict mode: ${failures.length} leg(s) failed — ${failures
        .map((f) => f.leg)
        .join(', ')}`,
      { code: GASTRONOMY_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  const drinks = rankBucket(buckets.drinks);
  const traditions = rankBucket(buckets.traditions);
  const venueTypes = rankBucket(buckets.venueTypes);

  return deepFreeze({
    anchor: { id: anchor.id, name: anchorName, domain: anchor.domain ?? anchor.category ?? null },
    drinks,
    traditions,
    venueTypes,
    venues: rankedVenues,
    coverage: {
      drinks: drinks.length > 0,
      traditions: traditions.length > 0,
      venueTypes: venueTypes.length > 0,
      venues: rankedVenues.length > 0,
      entities: entityCount,
      tags: tagPool.size,
    },
    failures: Object.freeze(failures),
  });
}

const gastronomyExtractor = {
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
};

export default gastronomyExtractor;

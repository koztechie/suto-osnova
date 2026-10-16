/**
 * Material culture extractor (task 53) — the MATERIAL LAYER of the
 * dossier: from the initial (resolved) cultural anchor it selects
 *
 *   1. ARCHITECTURE   — architectural style tags (brutalist, bauhaus,
 *                       art-deco …) carried by the anchor's taste
 *                       profile and its cross-domain neighbors;
 *   2. TEXTURES       — material/texture tags (velvet, concrete,
 *                       denim, linen …);
 *   3. CLOTHING STYLES— fashion style tags (streetwear, couture,
 *                       tailoring …);
 *   4. HOUSEHOLD OBJECTS — the NEIGHBOR ENTITIES themselves (places,
 *                       brands) whose tag profile carries household
 *                       markers (furniture, tableware, ceramics …) —
 *                       tangible carriers, not just tag names.
 *
 * THREE PARALLEL LEGS feed one merged tag pool (isolation mirrors
 * tasks 51-52: a failing leg never aborts its siblings):
 *   places leg  — cross-domain affinity into `urn:entity:place`
 *                 (insights-verified);
 *   brands leg  — cross-domain affinity into `urn:entity:brand`
 *                 (insights-verified);
 *   tags leg    — `/v2/tags` entity-scoped catalog lookup
 *                 (findTags) across the MATERIAL_TAG_TYPES families
 *                 (place/brand/media genre+category — media included
 *                 because a film anchor's style tags live there).
 *
 * Classification is PURE and table-driven: every merged tag is matched
 * against four EXPORTED marker tables (tuning contracts); a tag may
 * legitimately belong to several families. Family entries record
 * `sources` (place|brand|anchor_tags), `carriers` (how many neighbor
 * entities carry the tag) and `weight` (carrier share of the entity
 * pool) — the same statistical vocabulary as task 51's genre markers.
 * Objects are ranked household-marker-first, then correlation
 * (cross-domain affinity), popularity, name, id.
 *
 * All I/O is injectable (affinityFn/tagsFn) — fully testable with zero
 * network; no clocks/RNG (deterministic).
 */

import { getCrossDomainAffinities } from './crossDomainClient.js';
import { findTags } from './tasteTagsClient.js';
import { classifyEntity } from './domainMapper.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Typed error for material-culture failures. */
export class MaterialCultureError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'MaterialCultureError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const MATERIAL_CODES = Object.freeze({
  NO_ANCHOR: 'no_anchor',
  ALL_LEGS_FAILED: 'all_legs_failed',
  PARTIAL_FAILURE: 'partial_failure',
});

/** Documented algorithm defaults. */
export const MATERIAL_DEFAULTS = Object.freeze({
  materialLimit: 6,
  entityTake: 10,
  tagsTake: 30,
});

/** The three upstream legs. */
export const MATERIAL_LEGS = Object.freeze(['places', 'brands', 'tags']);

/** The four output families. */
export const MATERIAL_FAMILIES = Object.freeze([
  'architecture',
  'textures',
  'clothingStyles',
  'objects',
]);

/** Tag-type families requested from /v2/tags (tuning contract). */
export const MATERIAL_TAG_TYPES = Object.freeze([
  'urn:tag:genre:place',
  'urn:tag:category:place',
  'urn:tag:genre:brand',
  'urn:tag:category:brand',
  'urn:tag:genre:media',
  'urn:tag:category:media',
]);

const PLACE_URN = 'urn:entity:place';
const BRAND_URN = 'urn:entity:brand';

/** Family marker tables (exported tuning contracts). */
export const ARCHITECTURE_MARKERS = Object.freeze([
  'architecture', 'architectural', 'architect', 'brutalist', 'bauhaus',
  'gothic', 'baroque', 'modernist', 'modernism', 'art-nouveau', 'art-deco',
  'minimalism', 'postmodern', 'vernacular',
]);

export const TEXTURE_MARKERS = Object.freeze([
  'texture', 'textured', 'textile', 'fabric', 'velvet', 'linen', 'silk',
  'denim', 'leather', 'wool', 'cotton', 'marble', 'concrete', 'grain',
  'wooden', 'wood', 'suede', 'corduroy', 'tweed',
]);

export const CLOTHING_MARKERS = Object.freeze([
  'fashion', 'streetwear', 'couture', 'apparel', 'wardrobe', 'sportswear',
  'formalwear', 'casualwear', 'knitwear', 'tailoring',
]);

export const HOUSEHOLD_MARKERS = Object.freeze([
  'furniture', 'homeware', 'home-decor', 'decor', 'interior', 'kitchen',
  'tableware', 'ceramic', 'pottery', 'lamp', 'chair', 'household',
  'dishes', 'glassware', 'bedding',
]);

const FAMILY_MARKERS = Object.freeze({
  architecture: ARCHITECTURE_MARKERS,
  textures: TEXTURE_MARKERS,
  clothingStyles: CLOTHING_MARKERS,
  objects: HOUSEHOLD_MARKERS,
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

/** Normalizes a neighbor entity row (id + name required). */
function normalizeEntityRow(row) {
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

const byHouseholdThenCorrelation = (a, b) =>
  b.householdMarkers.length - a.householdMarkers.length ||
  (b.affinity ?? -1) - (a.affinity ?? -1) ||
  (b.popularity ?? -1) - (a.popularity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/**
 * Extracts the material-culture profile of an anchor.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the RESOLVED seed (task 47 shape).
 * @param {object} [options] materialLimit/entityTake/tagsTake, strict,
 *        injectable affinityFn/tagsFn.
 * @returns {Readonly<object>} frozen record {anchor, architecture,
 *          textures, clothingStyles, objects, coverage, failures}.
 * @throws {MaterialCultureError} no_anchor | all_legs_failed |
 *         partial_failure (strict).
 */
export async function extractMaterialProfile(anchor, options = {}) {
  const {
    materialLimit = MATERIAL_DEFAULTS.materialLimit,
    entityTake = MATERIAL_DEFAULTS.entityTake,
    tagsTake = MATERIAL_DEFAULTS.tagsTake,
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
    throw new MaterialCultureError(
      'extractMaterialProfile: anchor must carry a non-empty string id ' +
        '(resolve the seed first)',
      { code: MATERIAL_CODES.NO_ANCHOR, details: { anchor } }
    );
  }

  const anchorName =
    typeof anchor.name === 'string' && anchor.name.trim().length > 0
      ? anchor.name.trim()
      : null;

  // Three legs in parallel, isolated.
  const [placesOutcome, brandsOutcome, tagsOutcome] = await Promise.allSettled([
    affinityFn([anchor.id], PLACE_URN, { take: entityTake }),
    affinityFn([anchor.id], BRAND_URN, { take: entityTake }),
    tagsFn(anchor.id, [...MATERIAL_TAG_TYPES], { take: tagsTake }),
  ]);

  const failures = [];
  const rowsOf = (outcome, leg) => {
    if (outcome.status === 'fulfilled') return pageRows(outcome.value);
    failures.push(Object.freeze({ leg, ...describeError(outcome.reason) }));
    return null;
  };
  const placeRows = rowsOf(placesOutcome, 'places');
  const brandRows = rowsOf(brandsOutcome, 'brands');
  const anchorTagRows = rowsOf(tagsOutcome, 'tags');

  // Neighbor entities: normalized, deduped by id (leg order wins),
  // correlated with the anchor via cross-domain affinity.
  const entities = [];
  const seenIds = new Set();
  for (const row of [...(placeRows ?? []), ...(brandRows ?? [])]) {
    const entity = normalizeEntityRow(row);
    if (entity === null || seenIds.has(entity.id)) continue;
    seenIds.add(entity.id);
    entities.push(entity);
  }

  // Merged tag pool: entity tags (sources place/brand) + anchor catalog.
  const tagPool = new Map();
  const registerTag = (tag, source, carrierName = null) => {
    const key = tag.id ?? normalizeHaystack(tag.name);
    if (!key) return null;
    let entry = tagPool.get(key);
    if (entry === undefined) {
      entry = {
        id: tag.id,
        name: tag.name,
        type: tag.type,
        sources: new Set(),
        carriers: 0,
        carrierNames: new Set(),
      };
      tagPool.set(key, entry);
    }
    entry.sources.add(source);
    if (carrierName !== null) {
      entry.carriers += 1;
      entry.carrierNames.add(carrierName);
    }
    return entry;
  };
  for (const entity of entities) {
    const source = entity.subtype === PLACE_URN ? 'place' : 'brand';
    for (const tag of entity.tags) {
      registerTag(tag, source, entity.name);
    }
  }
  for (const row of anchorTagRows ?? []) {
    // Catalog tags arrive entity-shaped ({id, name, type}); registered
    // without carrier counting (anchor-scoped, not carried by anyone).
    const tag = normalizeEntityRow(row);
    if (tag !== null) registerTag(tag, 'anchor_tags');
  }

  const entityCount = entities.length;

  // Classify the pool into the four families.
  const familyBuckets = { architecture: [], textures: [], clothingStyles: [] };
  for (const entry of tagPool.values()) {
    const tagShape = { id: entry.id, name: entry.name, type: entry.type };
    for (const family of ['architecture', 'textures', 'clothingStyles']) {
      const markers = matchTagMarkers(tagShape, FAMILY_MARKERS[family]);
      if (markers.length === 0) continue;
      familyBuckets[family].push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        markers,
        sources: Object.freeze([...entry.sources].sort()),
        carriers: entry.carriers,
        weight: entityCount > 0 ? entry.carriers / entityCount : 0,
      });
    }
  }

  const rankFamily = (list) =>
    Object.freeze(
      [...list]
        .sort(
          (a, b) =>
            b.carriers - a.carriers ||
            b.markers.length - a.markers.length ||
            String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
            String(a.id ?? '').localeCompare(String(b.id ?? ''))
        )
        .slice(0, materialLimit)
        .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }))
    );

  // Objects: neighbor ENTITIES with household markers.
  const objects = Object.freeze(
    entities
      .map((entity) => ({
        ...entity,
        householdMarkers: matchTagMarkers(
          { name: entity.tags.map((t) => t.name).join(' '), id: entity.tags.map((t) => t.id).join(' ') },
          HOUSEHOLD_MARKERS
        ),
      }))
      .filter((entity) => entity.householdMarkers.length > 0)
      .sort(byHouseholdThenCorrelation)
      .slice(0, materialLimit)
      .map((entity, index) =>
        Object.freeze({
          id: entity.id,
          name: entity.name,
          subtype: entity.subtype,
          category: classifyEntity(entity) ?? null,
          affinity: entity.affinity,
          popularity: entity.popularity,
          householdMarkers: Object.freeze(entity.householdMarkers),
          rank: index + 1,
        })
      )
  );

  const failedLegs = new Set(failures.map((f) => f.leg));
  if (failedLegs.size === MATERIAL_LEGS.length) {
    throw new MaterialCultureError(
      'every material-culture leg failed — upstream outage',
      { code: MATERIAL_CODES.ALL_LEGS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new MaterialCultureError(
      `strict mode: ${failures.length} leg(s) failed — ${failures
        .map((f) => f.leg)
        .join(', ')}`,
      { code: MATERIAL_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  const architecture = rankFamily(familyBuckets.architecture);
  const textures = rankFamily(familyBuckets.textures);
  const clothingStyles = rankFamily(familyBuckets.clothingStyles);

  return deepFreeze({
    anchor: { id: anchor.id, name: anchorName, domain: anchor.domain ?? anchor.category ?? null },
    architecture,
    textures,
    clothingStyles,
    objects,
    coverage: {
      architecture: architecture.length > 0,
      textures: textures.length > 0,
      clothingStyles: clothingStyles.length > 0,
      objects: objects.length > 0,
      entities: entityCount,
      tags: tagPool.size,
    },
    failures: Object.freeze(failures),
  });
}

const materialCultureExtractor = {
  extractMaterialProfile,
  matchTagMarkers,
  MaterialCultureError,
  MATERIAL_CODES,
  MATERIAL_DEFAULTS,
  MATERIAL_LEGS,
  MATERIAL_FAMILIES,
  MATERIAL_TAG_TYPES,
  ARCHITECTURE_MARKERS,
  TEXTURE_MARKERS,
  CLOTHING_MARKERS,
  HOUSEHOLD_MARKERS,
};

export default materialCultureExtractor;

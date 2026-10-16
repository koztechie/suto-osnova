/**
 * Visual context extractor (task 55) — the VISUAL-CINEMATOGRAPHIC
 * CONTEXT layer of the dossier: from the initial (resolved) cultural
 * anchor it identifies
 *
 *   1. CINEMATOGRAPHY TECHNIQUES — operator craft tags (deep focus,
 *                                  long take, dutch angle, anamorphic,
 *                                  chiaroscuro, handheld …);
 *   2. COLOR SOLUTIONS           — color-grading tags (monochrome,
 *                                  technicolor, teal-orange, sepia,
 *                                  desaturated, neon …);
 *   3. ART SCHOOLS               — movement/school tags (german
 *                                  expressionism, surrealism, film
 *                                  noir, nouvelle vague, bauhaus …);
 *   plus FILMS                    — the concrete movie ENTITIES
 *                                  themselves (the tangible carriers
 *                                  of the three tag families), ranked
 *                                  and category-tagged.
 *
 * TWO PARALLEL LEGS feed one merged tag pool (isolation mirrors tasks
 * 51-54: a failing leg never aborts its sibling):
 *   films leg — cross-domain affinity into `urn:entity:movie`
 *               (insights-verified: the correlated film neighbors of
 *               the anchor);
 *   tags leg  — `/v2/tags` entity-scoped catalog lookup (findTags)
 *               across the exported VISUAL_TAG_TYPES families
 *               (genre|category x media — film style tags live there,
 *               live-verified in task 53 — plus place families, which
 *               carry the architecture-adjacent art schools).
 *
 * Classification is PURE and table-driven: three EXPORTED marker
 * tables (tuning contracts, hyphen-folding and TABLE-ORDER marker
 * lists like tasks 51-54) sort the pool into technique/color/school
 * buckets; a tag may legitimately inform several buckets. Entries
 * record sources (film|anchor_tags), carriers (how many neighbor
 * films carry the tag) and weight (carrier share of the entity pool).
 * Films are ranked total-visual-markers -> correlation ->
 * popularity -> name -> id.
 *
 * All I/O is injectable (affinityFn/tagsFn) — fully testable with zero
 * network; no clocks/RNG (deterministic).
 */

import { getCrossDomainAffinities } from './crossDomainClient.js';
import { findTags } from './tasteTagsClient.js';
import { classifyEntity } from './domainMapper.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Typed error for visual-context failures. */
export class VisualContextError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'VisualContextError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const VISUAL_CODES = Object.freeze({
  NO_ANCHOR: 'no_anchor',
  ALL_LEGS_FAILED: 'all_legs_failed',
  PARTIAL_FAILURE: 'partial_failure',
});

/** Documented algorithm defaults. */
export const VISUAL_DEFAULTS = Object.freeze({
  visualLimit: 6,
  entityTake: 10,
  tagsTake: 30,
});

/** The two upstream legs. */
export const VISUAL_LEGS = Object.freeze(['films', 'tags']);

/** Tag-type families requested from /v2/tags (tuning contract). */
export const VISUAL_TAG_TYPES = Object.freeze([
  'urn:tag:genre:media',
  'urn:tag:category:media',
  'urn:tag:genre:place',
  'urn:tag:category:place',
]);

const MOVIE_URN = 'urn:entity:movie';

/** Bucket marker tables (exported tuning contracts). */
export const CINEMATOGRAPHY_MARKERS = Object.freeze([
  'cinematography', 'deep-focus', 'long-take', 'handheld', 'anamorphic',
  'widescreen', 'chiaroscuro', 'backlight', 'dutch-angle', 'tracking-shot',
  'steadicam', 'slow-cinema', 'pov-shot',
]);

export const COLOR_MARKERS = Object.freeze([
  'monochrome', 'grayscale', 'desaturated', 'pastel', 'neon', 'sepia',
  'technicolor', 'high-contrast', 'duotone', 'vivid', 'muted',
  'teal-orange', 'color-grading',
]);

export const ART_SCHOOL_MARKERS = Object.freeze([
  'impressionism', 'expressionism', 'surrealism', 'cubism', 'bauhaus',
  'brutalism', 'romanticism', 'realism', 'nouvelle-vague', 'french-new-wave',
  'german-expressionism', 'pop-art', 'art-nouveau', 'art-deco',
  'avant-garde', 'futurism', 'dadaism', 'baroque', 'gothic',
  'renaissance', 'postmodernism', 'film-noir',
]);

const BUCKETS = Object.freeze({
  cinematography: CINEMATOGRAPHY_MARKERS,
  colorSolutions: COLOR_MARKERS,
  artSchools: ART_SCHOOL_MARKERS,
});

const normalizeHaystack = (value) =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

/** Markers matched by one tag's name + id (TABLE order preserved). */
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

/** Normalizes a film/catalog row (id + name required). */
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

const totalMarkers = (film) =>
  film.cinematographyMarkers.length + film.colorMarkers.length + film.schoolMarkers.length;

const byVisualThenCorrelation = (a, b) =>
  totalMarkers(b) - totalMarkers(a) ||
  (b.affinity ?? -1) - (a.affinity ?? -1) ||
  (b.popularity ?? -1) - (a.popularity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/**
 * Extracts the visual-cinematographic context of an anchor.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the RESOLVED seed (task 47 shape).
 * @param {object} [options] visualLimit/entityTake/tagsTake, strict,
 *        injectable affinityFn/tagsFn.
 * @returns {Readonly<object>} frozen record {anchor, cinematography,
 *          colorSolutions, artSchools, films, coverage, failures}.
 * @throws {VisualContextError} no_anchor | all_legs_failed |
 *         partial_failure (strict).
 */
export async function extractVisualContext(anchor, options = {}) {
  const {
    visualLimit = VISUAL_DEFAULTS.visualLimit,
    entityTake = VISUAL_DEFAULTS.entityTake,
    tagsTake = VISUAL_DEFAULTS.tagsTake,
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
    throw new VisualContextError(
      'extractVisualContext: anchor must carry a non-empty string id ' +
        '(resolve the seed first)',
      { code: VISUAL_CODES.NO_ANCHOR, details: { anchor } }
    );
  }

  const anchorName =
    typeof anchor.name === 'string' && anchor.name.trim().length > 0
      ? anchor.name.trim()
      : null;

  // Two legs in parallel, isolated.
  const [filmsOutcome, tagsOutcome] = await Promise.allSettled([
    affinityFn([anchor.id], MOVIE_URN, { take: entityTake }),
    tagsFn(anchor.id, [...VISUAL_TAG_TYPES], { take: tagsTake }),
  ]);

  const failures = [];
  const rowsOf = (outcome, leg) => {
    if (outcome.status === 'fulfilled') return pageRows(outcome.value);
    failures.push(Object.freeze({ leg, ...describeError(outcome.reason) }));
    return null;
  };
  const filmRows = rowsOf(filmsOutcome, 'films');
  const catalogRows = rowsOf(tagsOutcome, 'tags');

  // Neighbor films: normalized, deduped by id.
  const films = [];
  const seenIds = new Set();
  for (const row of filmRows ?? []) {
    const film = normalizeRow(row);
    if (film === null || seenIds.has(film.id)) continue;
    seenIds.add(film.id);
    films.push(film);
  }
  const entityCount = films.length;

  // Merged tag pool: film-carried tags + anchor catalog tags.
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
  for (const film of films) {
    for (const tag of film.tags) registerTag(tag, 'film', film.name);
  }
  for (const row of catalogRows ?? []) {
    const tag = normalizeRow(row);
    if (tag !== null) registerTag(tag, 'anchor_tags');
  }

  // Classify the pool into the three mandated buckets.
  const buckets = { cinematography: [], colorSolutions: [], artSchools: [] };
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
        .slice(0, visualLimit)
        .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }))
    );

  // Films: concrete carriers, most visual markers first, then correlation.
  const rankedFilms = Object.freeze(
    films
      .map((film) => {
        const markersOf = (table) =>
          film.tags
            .flatMap((t) => matchTagMarkers(t, table))
            .filter((marker, index, all) => all.indexOf(marker) === index);
        return {
          ...film,
          cinematographyMarkers: markersOf(CINEMATOGRAPHY_MARKERS),
          colorMarkers: markersOf(COLOR_MARKERS),
          schoolMarkers: markersOf(ART_SCHOOL_MARKERS),
        };
      })
      .sort(byVisualThenCorrelation)
      .map((film, index) =>
        Object.freeze({
          id: film.id,
          name: film.name,
          category: classifyEntity(film) ?? null,
          affinity: film.affinity,
          popularity: film.popularity,
          cinematographyMarkers: Object.freeze(film.cinematographyMarkers),
          colorMarkers: Object.freeze(film.colorMarkers),
          schoolMarkers: Object.freeze(film.schoolMarkers),
          rank: index + 1,
        })
      )
      .slice(0, visualLimit)
  );

  const failedLegs = new Set(failures.map((f) => f.leg));
  if (failedLegs.size === VISUAL_LEGS.length) {
    throw new VisualContextError(
      'every visual-context leg failed — upstream outage',
      { code: VISUAL_CODES.ALL_LEGS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new VisualContextError(
      `strict mode: ${failures.length} leg(s) failed — ${failures
        .map((f) => f.leg)
        .join(', ')}`,
      { code: VISUAL_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  const cinematography = rankBucket(buckets.cinematography);
  const colorSolutions = rankBucket(buckets.colorSolutions);
  const artSchools = rankBucket(buckets.artSchools);

  return deepFreeze({
    anchor: { id: anchor.id, name: anchorName, domain: anchor.domain ?? anchor.category ?? null },
    cinematography,
    colorSolutions,
    artSchools,
    films: rankedFilms,
    coverage: {
      cinematography: cinematography.length > 0,
      colorSolutions: colorSolutions.length > 0,
      artSchools: artSchools.length > 0,
      films: rankedFilms.length > 0,
      entities: entityCount,
      tags: tagPool.size,
    },
    failures: Object.freeze(failures),
  });
}

const visualContextExtractor = {
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
};

export default visualContextExtractor;

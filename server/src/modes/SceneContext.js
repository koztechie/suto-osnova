/**
 * SceneContext (task 84) — the ERA and GEOGRAPHIC LOCATION parameters
 * of a scene, integrated end to end: validated once, applied
 * deterministically in the WorldbuilderMode math chain, echoed in the
 * bundle and rendered into the scene dossier header.
 *
 * WHY LOCAL (the anti-fragility stance): the Qloo transports used
 * here have NO live-verified era/geography query parameters — this
 * project only wires contracts proven against the real API (the
 * recorded quirks: filter.type URNs, /search album, popularity
 * zeroes). Inventing `filter.geohash`/`start_year` call shapes would
 * be a hallucinated integration. The context therefore acts where it
 * is PROVABLY honest:
 *   1. as a DETERMINISTIC SELECTION BIAS — candidates whose name or
 *      tags carry the era/location tokens receive a small documented
 *      affinity boost BEFORE the adaptive threshold (the dossier
 *      prefers period- and place-fitting picks);
 *   2. as OUTPUT FRAMING — the normalized context is echoed in the
 *      bundle and rendered as the scene line of the dossier.
 * `contextParams()` reserves the passthrough shape for the day a
 * transport param is live-verified — it currently returns an empty
 * object BY CONTRACT (never a guess).
 *
 * INGRESS (tolerant, the SeedResolver discipline): {era?, location?,
 * geohash?, startYear?, endYear?}; strings are NFC-normalized,
 * trimmed and whitespace-collapsed; bounds: era 2..40, location
 * 2..80 code points; geohash ^[0-9bcdefghjkmnpqrstuvwxyz]{4,12}$;
 * years are integers 1800..2100 with startYear <= endYear. Absent or
 * all-empty input -> null (a scene without context is normal).
 *
 * ERROR SPLIT (the house rule): wrong TYPE -> TypeError; a
 * well-formed VALUE that violates bounds/format -> typed
 * SceneContextError with machine-readable codes.
 *
 * DETERMINISM: pure, no clocks, no RNG; identical input ->
 * deep-equal normalized context and identical boost outcomes (pinned
 * by server/test/sceneContextIntegration.test.js).
 */

/** Documented defaults (exported tuning contract). */
export const CONTEXT_DEFAULTS = Object.freeze({
  boost: 0.05,
  eraMin: 2,
  eraMax: 40,
  locationMin: 2,
  locationMax: 80,
});

/** Machine-readable failure codes. */
export const CONTEXT_CODES = Object.freeze({
  INVALID_ERA: 'invalid_era',
  INVALID_LOCATION: 'invalid_location',
  INVALID_GEOHASH: 'invalid_geohash',
  INVALID_YEARS: 'invalid_years',
});

const GEOHASH_PATTERN = /^[0-9bcdefghjkmnpqrstuvwxyz]{4,12}$/;
const YEAR_MIN = 1800;
const YEAR_MAX = 2100;

/** Typed error: a well-formed context value the contract rejects. */
export class SceneContextError extends Error {
  constructor(message, { code, details, cause } = undefined) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SceneContextError';
    this.code = code;
    this.details = details;
  }
}

const normalizeText = (value) =>
  value.normalize('NFC').replace(/\s+/g, ' ').trim();

const codePointLength = (value) => [...value].length;

/**
 * Validate + normalize a scene context ingress. Returns the frozen
 * normalized context, or null when no parameter was supplied.
 */
export function parseSceneContext(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('parseSceneContext: expected {era?, location?, ...} or null');
  }
  for (const key of ['era', 'location', 'geohash']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      throw new TypeError(`parseSceneContext: ${key} must be a string when given`);
    }
  }
  for (const key of ['startYear', 'endYear']) {
    if (input[key] !== undefined && !Number.isInteger(input[key])) {
      throw new TypeError(`parseSceneContext: ${key} must be an integer when given`);
    }
  }

  let era = null;
  if (typeof input.era === 'string') {
    era = normalizeText(input.era);
    const length = codePointLength(era);
    if (length === 0 || length < CONTEXT_DEFAULTS.eraMin || length > CONTEXT_DEFAULTS.eraMax) {
      throw new SceneContextError(
        `era must span ${CONTEXT_DEFAULTS.eraMin}..${CONTEXT_DEFAULTS.eraMax} code points`,
        { code: CONTEXT_CODES.INVALID_ERA, details: { era: input.era } }
      );
    }
  }

  let location = null;
  if (typeof input.location === 'string') {
    location = normalizeText(input.location);
    const length = codePointLength(location);
    if (length === 0 || length < CONTEXT_DEFAULTS.locationMin
      || length > CONTEXT_DEFAULTS.locationMax) {
      throw new SceneContextError(
        `location must span ${CONTEXT_DEFAULTS.locationMin}..${CONTEXT_DEFAULTS.locationMax} code points`,
        { code: CONTEXT_CODES.INVALID_LOCATION, details: { location: input.location } }
      );
    }
  }

  let geohash = null;
  if (typeof input.geohash === 'string') {
    geohash = input.geohash.trim().toLowerCase();
    if (!GEOHASH_PATTERN.test(geohash)) {
      throw new SceneContextError(
        'geohash must match ^[0-9bcdefghjkmnpqrstuvwxyz]{4,12}$',
        { code: CONTEXT_CODES.INVALID_GEOHASH, details: { geohash: input.geohash } }
      );
    }
  }

  const { startYear, endYear } = input;
  if (startYear !== undefined || endYear !== undefined) {
    for (const [name, year] of [['startYear', startYear], ['endYear', endYear]]) {
      if (year !== undefined && (year < YEAR_MIN || year > YEAR_MAX)) {
        throw new SceneContextError(
          `${name} must be an integer in ${YEAR_MIN}..${YEAR_MAX}`,
          { code: CONTEXT_CODES.INVALID_YEARS, details: { [name]: year } }
        );
      }
    }
    if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
      throw new SceneContextError(
        'startYear must not exceed endYear',
        { code: CONTEXT_CODES.INVALID_YEARS, details: { startYear, endYear } }
      );
    }
  }

  if (era === null && location === null && geohash === null
    && startYear === undefined && endYear === undefined) {
    return null; // an all-empty context is no context
  }

  return Object.freeze({
    era,
    location,
    geohash,
    startYear: startYear ?? null,
    endYear: endYear ?? null,
  });
}

/**
 * Deterministic matching tokens for one context: era words expand to
 * decade forms ("1970s" -> 1970s, 1970, 70s), years derive the decade
 * of the start, location stays whole (case-insensitive substring).
 */
export function contextTokens(context) {
  if (context === null || context === undefined) return Object.freeze([]);
  const tokens = new Set();
  if (context.era !== null) {
    const era = context.era.toLowerCase();
    tokens.add(era);
    const decade = era.match(/^(\d{4})s$/);
    if (decade) {
      tokens.add(decade[1]);
      tokens.add(`${decade[1].slice(2)}s`);
    }
  }
  if (context.startYear !== null) {
    tokens.add(String(context.startYear));
    tokens.add(`${String(context.startYear).slice(0, 3)}0s`);
    tokens.add(`${String(context.startYear).slice(2)}s`);
  }
  if (context.endYear !== null) tokens.add(String(context.endYear));
  return Object.freeze([...tokens].sort());
}

const haystackOf = (row) => {
  const parts = [row?.name ?? ''];
  for (const tag of Array.isArray(row?.tags) ? row.tags : []) {
    if (typeof tag?.name === 'string') parts.push(tag.name);
  }
  return parts.join(' ').toLowerCase();
};

/**
 * Annotate + boost candidates against the context (the deterministic
 * selection bias). Each row gains `affinityBase` (the pre-boost
 * value, always preserved) and `contextMatch` {era, location} (null
 * when that dimension is absent from the context). Boost applies per
 * MATCHED DIMENSION (era and location can both hit), capped at 1.
 * Rows are never dropped — bias, not censorship.
 */
export function applyContextBoost(rows, context, options = {}) {
  const boost = options.boost ?? CONTEXT_DEFAULTS.boost;
  if (typeof boost !== 'number' || !Number.isFinite(boost) || boost < 0 || boost > 0.5) {
    throw new TypeError('applyContextBoost: boost must be a finite number in 0..0.5');
  }
  if (!Array.isArray(rows)) {
    throw new TypeError('applyContextBoost: rows must be an array');
  }
  const parsed = context === null || context === undefined
    ? null
    : (Object.isFrozen(context) && 'era' in context ? context : parseSceneContext(context));
  if (parsed === null) {
    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  const eraTokens = parsed.era !== null ? contextTokens({ ...parsed, location: null, startYear: null, endYear: null }) : [];
  const locationToken = parsed.location !== null ? parsed.location.toLowerCase() : null;

  return Object.freeze(rows.map((row) => {
    const haystack = haystackOf(row);
    const eraMatch = eraTokens.length > 0
      ? eraTokens.some((token) => haystack.includes(token))
      : null;
    const locationMatch = locationToken !== null
      ? haystack.includes(locationToken)
      : null;
    const dimensions = (eraMatch === true ? 1 : 0) + (locationMatch === true ? 1 : 0);
    const base = typeof row?.affinity === 'number' ? row.affinity : null;
    const affinity = base === null ? null : Math.min(1, base + boost * dimensions);
    return Object.freeze({
      ...row,
      affinityBase: base,
      affinity,
      contextMatch: Object.freeze({ era: eraMatch, location: locationMatch }),
    });
  }));
}

/**
 * The reserved passthrough of context parameters for Qloo transports.
 * BY CONTRACT this returns an empty object until an era/geo param is
 * live-verified against the real API — never a guess.
 */
export function contextParams(_context) {
  return Object.freeze({});
}

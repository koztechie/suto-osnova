/**
 * Modular client for cross-domain taste correlations — Qloo Insights
 * (`GET /v2/insights`): given source entity ids ("signals") and a target
 * domain, return affinity-scored entities of that domain plus per-result
 * attribution showing HOW MUCH each source entity contributed.
 *
 * This is the canonical Qloo cross-domain mechanic: an artist's audience
 * taste mapped onto movies, places, books, podcasts … . The signature
 * `getCrossDomainAffinities(entityIds, targetDomain)` maps onto the
 * documented parameters:
 *   - `signal.interests.entities` <- entityIds (comma-joined UUIDs)
 *   - `filter.type`                <- targetDomain (entity-type URN)
 *
 * Contract verified TWO ways and reconciled:
 *   1. the official OpenAPI spec for `GET /v2/insights`;
 *   2. live probes against the Qloo hackathon host (2026-10-14), because
 *      the sandbox diverges from the spec in places.
 *
 * Documented contract (OpenAPI):
 * - `filter.type` is REQUIRED; `take` default 20 / max 50; `page` (1..100,
 *   recommended pagination); `offset` (special case); `sort_by`
 *   (affinity|distance|rating|quality); `bias.trends`;
 *   `signal.interests.entities.weight` (number or very_low…very_high);
 *   `feature.explainability` (default false).
 * - Response: `{ success, results: { entities: [...], duration } }`.
 *
 * Live-verified sandbox realities (not in / diverging from the spec):
 * - Missing `filter.type` -> 400 "filter.type is required".
 * - The OpenAPI enum is INCOMPLETE: `urn:entity:destination` is accepted
 *   (200) although not listed, while `urn:entity:audience` (deprecated)
 *   and `urn:entity:video_game` (underscored!) are rejected with 400.
 *   The supported spelling is `urn:entity:videogame`. The target registry
 *   below therefore prefers live-verified values over the spec enum.
 * - `urn:heatmap` requires a location and returns a different payload
 *   shape (heatmap points, not entities) — rejected client-side here so
 *   it can never poison normalization.
 * - Per-result explainability lives at
 *   `query.explainability["signal.interests.entities"]` as
 *   `[{ entity_id, score }]`; the aggregate lives at the top-level
 *   `query.explainability` as `effect_on_top{3,5,10}_recs` /
 *   `effect_on_all_recs` lists of `{ entity_id, avg_score }`.
 * - `query.affinity_rank` is documented but absent on the sandbox — the
 *   normalizer tolerates its absence.
 *
 * Why a dedicated target-type registry instead of reusing the search
 * module's `resolveDomain`: the two endpoints accept DIFFERENT type sets
 * and spellings (insights: `videogame`; search guide: `video_game`;
 * insights adds `destination`/`locality`, rejects `audience`). Each module
 * owns its endpoint's truth; sharing a registry would couple them to one
 * endpoint's semantics.
 *
 * Transport (X-Api-Key, rate limiting, retries, two-tier cache with the
 * general volatile TTL, single-flight) is inherited from `qlooClient` —
 * this module performs zero direct `fetch` calls.
 */

import { qlooClient } from './qlooClient.js';

/** Endpoint path (v2 Insights). */
export const INSIGHTS_PATH = '/v2/insights';

const DEFAULT_TAKE = 20; // documented default
const MAX_TAKE = 50; // documented maximum
const MAX_PAGE = 100; // documented page ceiling
const MAX_ENTITY_ID_LENGTH = 128;
/** Client-side safety rail: far beyond practical signal counts. */
const MAX_SIGNAL_ENTITIES = 100;

/** Full entity-type URN, e.g. `urn:entity:movie`. */
const ENTITY_TYPE_URN = /^urn:entity:[a-z0-9_]+$/;

/**
 * Friendly domain name -> Insights-filter.type URN. Values marked (live)
 * were verified against the hackathon host; aliases mirror the search
 * module so callers see one friendly vocabulary across the codebase.
 */
export const TARGET_DOMAINS = Object.freeze({
  actor: 'urn:entity:person', // deprecated fold -> Person
  artist: 'urn:entity:artist', // live
  author: 'urn:entity:person', // deprecated fold -> Person
  book: 'urn:entity:book', // live
  brand: 'urn:entity:brand',
  destination: 'urn:entity:destination', // live; NOT in the OpenAPI enum
  director: 'urn:entity:person', // deprecated fold -> Person
  film: 'urn:entity:movie', // alias
  game: 'urn:entity:videogame', // live; NOTE: no underscore
  locality: 'urn:entity:locality', // partially supported per spec
  movie: 'urn:entity:movie', // live
  music: 'urn:entity:artist', // alias
  person: 'urn:entity:person',
  place: 'urn:entity:place', // live
  podcast: 'urn:entity:podcast',
  series: 'urn:entity:tv_show', // alias
  television: 'urn:entity:tv_show', // alias
  travel: 'urn:entity:destination', // alias
  tv: 'urn:entity:tv_show', // alias
  tv_show: 'urn:entity:tv_show',
  videogame: 'urn:entity:videogame', // live
  video_game: 'urn:entity:videogame', // alias for the search-guide spelling
});

/** Query parameters this module owns; `extra` may not shadow them. */
const RESERVED_PARAMS = new Set([
  'filter.type',
  'signal.interests.entities',
  'signal.interests.entities.weight',
  'feature.explainability',
  'sort_by',
  'bias.trends',
  'take',
  'page',
  'offset',
]);

const TREND_WEIGHTS = Object.freeze([
  'very_low',
  'low',
  'mid',
  'medium',
  'high',
  'very_high',
]);
const SORT_MODES = Object.freeze(['affinity', 'distance', 'rating', 'quality']);

/** Error for client-side validation and malformed upstream payloads. */
export class CrossDomainAffinityError extends Error {
  constructor(message, { code = 'VALIDATION', details } = {}) {
    super(message);
    this.name = 'CrossDomainAffinityError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Validates and normalizes the signal entity ids.
 * Accepts a single id, a comma-separated string, or an array; ids are
 * trimmed, deduplicated (order preserved) and structurally validated —
 * no whitespace/commas (a comma would silently split into two ids) and a
 * sane length cap. Qloo ids are usually UUIDs but may be other opaque
 * tokens, so no strict UUID pattern is enforced (anti-fragile).
 *
 * @throws {CrossDomainAffinityError} code `INVALID_ENTITY_IDS`.
 */
export function resolveEntityIds(entityIds) {
  const list = Array.isArray(entityIds) ? entityIds : [entityIds];
  const resolved = [];

  for (const entry of list) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'string') {
      throw new CrossDomainAffinityError(
        'entityIds must be strings (a single id, a comma-separated string, ' +
          'or an array of ids)',
        { code: 'INVALID_ENTITY_IDS', details: { entityIds: entry } }
      );
    }
    for (const part of entry.split(',')) {
      const id = part.trim();
      if (id.length === 0) continue; // tolerate "a,,b" gracefully
      if (id.length > MAX_ENTITY_ID_LENGTH || /\s/.test(id)) {
        throw new CrossDomainAffinityError(
          `Invalid entity id "${part.trim().slice(0, 40)}…": ids must be ` +
            `tokens without whitespace, at most ${MAX_ENTITY_ID_LENGTH} characters`,
          { code: 'INVALID_ENTITY_IDS', details: { entityId: part } }
        );
      }
      resolved.push(id);
    }
  }

  if (resolved.length === 0) {
    throw new CrossDomainAffinityError(
      'entityIds must resolve to at least one entity id',
      { code: 'INVALID_ENTITY_IDS', details: { entityIds } }
    );
  }
  if (resolved.length > MAX_SIGNAL_ENTITIES) {
    throw new CrossDomainAffinityError(
      `entityIds: at most ${MAX_SIGNAL_ENTITIES} signal entities are allowed ` +
        `(got ${resolved.length})`,
      { code: 'INVALID_ENTITY_IDS', details: { count: resolved.length } }
    );
  }

  // Deduplicate, preserving order: a repeated id would double its weight
  // in the affinity blend without the caller intending it.
  return [...new Set(resolved)];
}

/**
 * Resolves a target domain into an Insights `filter.type` URN.
 * Accepts friendly names ("movie", "film"), aliases ("tv", "music"),
 * deprecated folds ("actor" -> person), and raw `urn:entity:*`
 * pass-through (so a future type never blocks a valid call). Unknown
 * names are rejected fast — they would only ever produce an upstream 400
 * while burning a rate-limited round-trip. `urn:heatmap` and the
 * deprecated `urn:entity:audience` are rejected up front — they cannot
 * produce entity affinities.
 *
 * @throws {CrossDomainAffinityError} code `INVALID_TARGET_DOMAIN`.
 */
export function resolveTargetDomain(domain) {
  if (typeof domain !== 'string' || domain.trim().length === 0) {
    throw new CrossDomainAffinityError(
      'targetDomain must be a non-empty string (e.g. "movie" or "urn:entity:movie")',
      { code: 'INVALID_TARGET_DOMAIN', details: { domain } }
    );
  }
  const raw = domain.trim().toLowerCase();

  if (raw === 'urn:heatmap' || raw.startsWith('urn:heatmap:')) {
    throw new CrossDomainAffinityError(
      'urn:heatmap is not an entity domain: heatmaps require a location and ' +
        'return geospatial points, not affinity entities. Use the insights ' +
        'heatmap flow instead of getCrossDomainAffinities.',
      { code: 'INVALID_TARGET_DOMAIN', details: { domain } }
    );
  }
  if (raw === 'urn:entity:audience') {
    throw new CrossDomainAffinityError(
      'urn:entity:audience is deprecated and rejected by the API (verified ' +
        'live). Use a concrete entity domain instead.',
      { code: 'INVALID_TARGET_DOMAIN', details: { domain } }
    );
  }

  if (ENTITY_TYPE_URN.test(raw)) return raw; // raw URN pass-through

  const key = raw.replace(/[\s-]+/g, '_');
  const urn = TARGET_DOMAINS[key];
  if (urn) return urn;

  // NO single-word shorthand fallback on purpose: "spaceship" or "genre"
  // must fail fast with guidance instead of being silently forwarded as
  // urn:entity:spaceship (burning a quota round-trip for a guaranteed 400).
  // New or exotic domains are always reachable via the raw-URN pass-through.
  throw new CrossDomainAffinityError(
    `Unknown target domain "${domain}". Use a raw URN (urn:entity:…) ` +
      `or one of: ${Object.keys(TARGET_DOMAINS).sort().join(', ')}`,
    { code: 'INVALID_TARGET_DOMAIN', details: { domain } }
  );
}

/** Validates the signal weight (documented: number >= 0 or weight word). */
function validateWeight(weight) {
  if (weight === undefined) return undefined;
  if (typeof weight === 'number') {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new CrossDomainAffinityError(
        'weight must be a non-negative number or one of: ' +
          TREND_WEIGHTS.join(', '),
        { code: 'INVALID_WEIGHT', details: { weight } }
      );
    }
    return weight;
  }
  if (typeof weight === 'string' && TREND_WEIGHTS.includes(weight)) {
    return weight;
  }
  throw new CrossDomainAffinityError(
    'weight must be a non-negative number or one of: ' + TREND_WEIGHTS.join(', '),
    { code: 'INVALID_WEIGHT', details: { weight } }
  );
}

/**
 * Validates pagination and presentation options.
 * `take` outside the documented 1..50 is CLAMPED (forgiving for LLM/tool
 * callers); wrong types THROW (a type error is a bug). Pagination prefers
 * the documented `page` (1..100); `offset` remains available.
 */
function validateOptions({
  take,
  page,
  offset,
  weight,
  explainability,
  sortBy,
  biasTrends,
  extra,
} = {}) {
  let normalizedTake = DEFAULT_TAKE;
  if (take !== undefined) {
    if (typeof take !== 'number' || !Number.isFinite(take)) {
      throw new CrossDomainAffinityError('take must be a number', {
        code: 'INVALID_TAKE',
        details: { take },
      });
    }
    normalizedTake = Math.min(MAX_TAKE, Math.max(1, Math.trunc(take)));
  }

  let normalizedPage;
  if (page !== undefined) {
    if (
      typeof page !== 'number' ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > MAX_PAGE
    ) {
      throw new CrossDomainAffinityError(
        `page must be an integer between 1 and ${MAX_PAGE}`,
        { code: 'INVALID_PAGE', details: { page } }
      );
    }
    normalizedPage = page;
  }

  let normalizedOffset;
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
      throw new CrossDomainAffinityError('offset must be a non-negative number', {
        code: 'INVALID_OFFSET',
        details: { offset },
      });
    }
    normalizedOffset = Math.trunc(offset);
  }

  const normalizedWeight = validateWeight(weight);

  // Explainability defaults to ON for this client: attribution of each
  // source entity's contribution IS the "correlation" the caller asked
  // for. Explicit `false` omits the parameter (the server default is
  // false, so omitting is equivalent but sends fewer bytes).
  let sendExplainability = true;
  if (explainability !== undefined) {
    if (typeof explainability !== 'boolean') {
      throw new CrossDomainAffinityError('explainability must be a boolean', {
        code: 'INVALID_FEATURE_FLAG',
        details: { explainability },
      });
    }
    sendExplainability = explainability;
  }

  let normalizedSortBy;
  if (sortBy !== undefined) {
    if (typeof sortBy !== 'string' || !SORT_MODES.includes(sortBy)) {
      throw new CrossDomainAffinityError(
        `sortBy must be one of: ${SORT_MODES.join(', ')}`,
        { code: 'INVALID_SORT_BY', details: { sortBy } }
      );
    }
    normalizedSortBy = sortBy;
  }

  let normalizedBiasTrends;
  if (biasTrends !== undefined) {
    if (typeof biasTrends !== 'string' || !TREND_WEIGHTS.includes(biasTrends)) {
      throw new CrossDomainAffinityError(
        `biasTrends must be one of: ${TREND_WEIGHTS.join(', ')}`,
        { code: 'INVALID_BIAS_TRENDS', details: { biasTrends } }
      );
    }
    normalizedBiasTrends = biasTrends;
  }

  const extraParams = {};
  if (extra !== undefined) {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw new CrossDomainAffinityError('extra must be a plain object', {
        code: 'INVALID_EXTRA',
        details: { extra },
      });
    }
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_PARAMS.has(key)) {
        throw new CrossDomainAffinityError(
          `extra.${key} is reserved; pass it as a dedicated argument`,
          { code: 'RESERVED_PARAM', details: { param: key } }
        );
      }
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        throw new CrossDomainAffinityError(
          `extra.${key} must be a string, number or boolean ` +
            '(join lists into a comma-separated string yourself)',
          { code: 'INVALID_EXTRA', details: { param: key, value } }
        );
      }
      extraParams[key] = value;
    }
  }

  return {
    take: normalizedTake,
    page: normalizedPage,
    offset: normalizedOffset,
    weight: normalizedWeight,
    sendExplainability,
    sortBy: normalizedSortBy,
    biasTrends: normalizedBiasTrends,
    extraParams,
  };
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;
const asObject = (value) => (value && typeof value === 'object' ? value : {});

/**
 * Normalizes the per-result explainability into a compact
 * `{ [entityId]: score }` attribution map. Tolerates the documented list
 * form `[{ entity_id, score }]` and an object-map form.
 */
function normalizeExplainability(explainability) {
  const entry = asObject(explainability)['signal.interests.entities'];
  if (!entry) return null;

  if (Array.isArray(entry)) {
    const map = {};
    for (const item of entry) {
      const obj = asObject(item);
      const id = nonEmptyString(obj.entity_id) ?? nonEmptyString(obj.id);
      const score = finiteNumber(obj.score);
      if (id && score !== null) map[id] = score;
    }
    return Object.keys(map).length > 0 ? map : null;
  }
  if (typeof entry === 'object') {
    const map = {};
    for (const [id, score] of Object.entries(entry)) {
      if (nonEmptyString(id) && finiteNumber(score) !== null) map[id] = score;
    }
    return Object.keys(map).length > 0 ? map : null;
  }
  return null;
}

/**
 * Normalizes the top-level aggregate explainability into a
 * signal-path-keyed format:
 *   `{ 'signal.interests.entities': { top3: [{entityId, avgScore}], …,
 *                                     warning? }, … }`
 * mirroring the wire format (`query.explainability` is keyed by signal
 * path). Keying avoids collisions on mixed requests where several
 * signal paths each carry their own `effect_on_topN_recs` lists, and
 * stays correct if the backend later attributes demographic signals
 * too (verified live 2026-10-14: only `signal.interests.entities` is
 * computed today). Tolerant: unknown shapes are skipped, never thrown.
 * Exported for reuse by sibling insights clients (audience analysis) so
 * every insights caller sees one aggregate format.
 */
export function normalizeAggregateExplainability(payload) {
  const root = asObject(asObject(payload.query).explainability);
  const normalized = {};

  for (const [signalPath, rawEntry] of Object.entries(root)) {
    const entry = asObject(rawEntry);
    const scopes = {};
    for (const [key, value] of Object.entries(entry)) {
      const match = /^effect_on_(top\d+|all)_recs$/.exec(key);
      if (!Array.isArray(value)) continue;
      const scope = match ? match[1] : key;
      scopes[scope] = value
        .map((item) => {
          const obj = asObject(item);
          return {
            entityId:
              nonEmptyString(obj.entity_id) ?? nonEmptyString(obj.id) ?? null,
            avgScore: finiteNumber(obj.avg_score),
          };
        })
        .filter((item) => item.entityId !== null);
    }
    if (nonEmptyString(entry.warning)) scopes.warning = entry.warning;
    if (Object.keys(scopes).length > 0) normalized[signalPath] = scopes;
  }

  // Docs: "a warning is returned under query.explainability.warning" —
  // a root-level sibling of the signal paths; preserved verbatim.
  if (nonEmptyString(root.warning)) normalized.warning = root.warning;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Normalizes one affinity entity. Reuses the field vocabulary of the
 * search client (`id`, `name`, `subtype`, `affinity`, …) so callers can
 * treat results from both endpoints uniformly, and adds the
 * cross-domain specifics: `affinityRank`, `explain` and `measurements`.
 * Returns null when the item is too malformed (no id or no name).
 */
export function normalizeAffinityEntity(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = nonEmptyString(raw.entity_id) ?? nonEmptyString(raw.id);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const props = asObject(raw.properties);
  const geocode = asObject(props.geocode);
  const queryMeta = asObject(raw.query);
  const types = Array.isArray(raw.types)
    ? raw.types.filter((t) => typeof t === 'string')
    : [];

  return {
    id,
    name,
    type: nonEmptyString(raw.type) ?? 'urn:entity',
    subtype:
      nonEmptyString(raw.subtype) ?? (types.length > 0 ? types[0] : null),
    popularity: finiteNumber(raw.popularity),
    affinity: finiteNumber(queryMeta.affinity),
    // Documented but absent on the current sandbox — kept for forward
    // compatibility with production builds.
    affinityRank: finiteNumber(queryMeta.affinity_rank),
    // Per-result attribution: which source signals produced this result.
    explain: normalizeExplainability(queryMeta.explainability),
    measurements: asObject(queryMeta.measurements),
    description: nonEmptyString(props.description),
    imageUrl: nonEmptyString(props.image?.url),
    releaseYear: finiteNumber(props.release_year),
    releaseDate: nonEmptyString(props.release_date),
    duration: finiteNumber(props.duration),
    contentRating: nonEmptyString(props.content_rating),
    city: nonEmptyString(geocode.name) ?? nonEmptyString(geocode.city),
    countryCode: nonEmptyString(geocode.country_code),
    address: nonEmptyString(props.address),
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .map((t) => {
            const obj = asObject(t);
            const tagId = nonEmptyString(obj.id) ?? nonEmptyString(obj.tag_id);
            const tagName = nonEmptyString(obj.name);
            if (!tagId && !tagName) return null;
            return { id: tagId, name: tagName, type: nonEmptyString(obj.type) };
          })
          .filter(Boolean)
      : [],
  };
}

/** Extracts the entity list from the shapes observed/documented. */
function extractRawEntities(payload) {
  if (Array.isArray(payload.results?.entities)) return payload.results.entities;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.entities)) return payload.entities;
  return [];
}

/**
 * Validates and normalizes an insights payload.
 * Throws `CrossDomainAffinityError` for non-object payloads or
 * `success: false`; a missing entity list is tolerated as "no matches".
 */
function normalizeInsightsPayload(payload, context) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CrossDomainAffinityError(
      'Qloo insights response was not a JSON object',
      { code: 'MALFORMED_RESPONSE', details: { payload } }
    );
  }
  if (payload.success === false) {
    throw new CrossDomainAffinityError(
      'Qloo reported success=false for the insights query',
      { code: 'UPSTREAM_ERROR', details: { payload } }
    );
  }

  const results = extractRawEntities(payload)
    .map(normalizeAffinityEntity)
    .filter(Boolean);

  return {
    sourceEntityIds: context.sourceEntityIds,
    targetType: context.targetType,
    take: context.take,
    page: context.page,
    offset: context.offset,
    count: results.length,
    // Aggregate attribution across the top-N result subsets, keyed by
    // signal path (null when explainability was not requested or could
    // not be computed — e.g. audience-only queries on the sandbox).
    explainability: normalizeAggregateExplainability(payload),
    results,
  };
}

/**
 * Computes cross-domain taste affinities: entities of `targetDomain` that
 * best match the combined taste profile of `entityIds`, each with an
 * affinity score and (by default) per-signal attribution.
 *
 * @param {string|string[]} entityIds  Source signal entity id(s): a single
 *                                    id, a comma-separated string, or an
 *                                    array. Deduplicated; 1..100 ids.
 * @param {string} targetDomain       Target domain: friendly name ("movie",
 *                                    "film", "tv", "music"), a deprecated
 *                                    fold ("actor" -> person), or a raw
 *                                    `urn:entity:*` URN. `urn:heatmap` and
 *                                    the deprecated `urn:entity:audience`
 *                                    are rejected.
 * @param {object} [options]
 * @param {number} [options.take=20]      Page size; clamped to 1..50 (documented).
 * @param {number} [options.page]         1-based page number (1..100).
 * @param {number} [options.offset]       Special-case alternative to `page`.
 * @param {number|string} [options.weight] signal.interests.entities.weight:
 *                                        number >= 0 or very_low…very_high.
 * @param {boolean} [options.explainability=true]  Per-result + aggregate
 *                                        attribution; pass false to omit.
 * @param {string} [options.sortBy]       affinity|distance|rating|quality.
 * @param {string} [options.biasTrends]   off…very_high (trend influence).
 * @param {object} [options.extra]        Extra scalar query params; may not
 *                                        shadow this module's params.
 * @returns {Promise<{sourceEntityIds: string[], targetType: string,
 *                    take: number, page: number|null, offset: number|null,
 *                    count: number,
 *                    explainability: Record<string, object>|null,
 *                    results: Array<object>}>}
 * @throws {CrossDomainAffinityError} synchronously on invalid input (before
 *         any network call, so a bad call never burns key quota); rejects
 *         with `QlooApiError` on upstream failures.
 */
export function getCrossDomainAffinities(entityIds, targetDomain, options = {}) {
  // Validation is synchronous and happens BEFORE any I/O: a bad call can
  // never consume hackathon key quota or wait on the rate limiter.
  const sourceEntityIds = resolveEntityIds(entityIds);
  const targetType = resolveTargetDomain(targetDomain);
  const {
    take,
    page,
    offset,
    weight,
    sendExplainability,
    sortBy,
    biasTrends,
    extraParams,
  } = validateOptions(options);

  const params = {
    // Required target-domain selector (verified live: missing -> 400).
    'filter.type': targetType,
    // The cross-domain signal itself.
    'signal.interests.entities': sourceEntityIds.join(','),
    take,
    ...extraParams,
  };
  if (weight !== undefined) params['signal.interests.entities.weight'] = weight;
  // Default: ON (sent as true). Explicit false: omitted — the server
  // default is false, so this is equivalent without extra bytes.
  if (sendExplainability) params['feature.explainability'] = true;
  if (sortBy !== undefined) params.sort_by = sortBy;
  if (biasTrends !== undefined) params['bias.trends'] = biasTrends;
  // Documented pagination: `page` preferred; `offset` is the documented
  // special-case alternative — only the provided one is sent.
  if (page !== undefined) params.page = page;
  if (offset !== undefined) params.offset = offset;

  return qlooClient
    .get(INSIGHTS_PATH, params)
    .then((payload) =>
      normalizeInsightsPayload(payload, {
        sourceEntityIds,
        targetType,
        take,
        page: page ?? null,
        offset: offset ?? null,
      })
    );
}

const crossDomainClient = {
  getCrossDomainAffinities,
  resolveEntityIds,
  resolveTargetDomain,
  normalizeAffinityEntity,
  TARGET_DOMAINS,
  INSIGHTS_PATH,
};

export default crossDomainClient;

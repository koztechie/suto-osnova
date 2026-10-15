/**
 * Modular client for CONSUMER AUDIENCE analysis on the Qloo Taste AI API.
 *
 * Qloo's audience taxonomy (life stages, hobbies, spending habits,
 * political preferences, professional categories …) are precomputed taste
 * SEGMENTS identified by URNs like
 * `urn:audience:hobbies_and_interests:outdoors`. Passing them to the
 * Insights API as `signal.demographics.audiences` ranks target-domain
 * entities by affinity to the audience profile — personalization without
 * any behavioral data of a specific user.
 *
 * This module owns two tightly-coupled endpoints (bound together by
 * Qloo's own recipes):
 *
 * 1. `getAudienceInsights(parameters)` -> `GET /v2/insights` with
 *    demographic signals (`signal.demographics.audiences|age|gender` +
 *    weights), optionally COMBINED with taste signals
 *    (`signal.interests.entities|tags`) and `signal.location.query`.
 * 2. `searchAudiences(query, options)` -> `GET /v2/audiences` — the
 *    documented way to DISCOVER valid audience URNs before using them as
 *    signals ("Find an audience ID by keyword" recipe).
 *
 * Contract verified TWO ways and reconciled:
 *   1. official Qloo docs (Insights API, Parameter Reference, audience
 *      recipes);
 *   2. live probes against the Qloo hackathon host (2026-10-14), because
 *      the sandbox diverges from the docs in places.
 *
 * Live-verified realities baked into this client:
 * - Insights requires at least one valid SIGNAL OR FILTER
 *   ("at least one valid signal or filter is required for entity
 *   insights", 400) — checked client-side BEFORE any network call.
 * - An audience-only request is valid (audiences are a primary signal).
 * - A malformed audience value (`outdoors` instead of the URN) is
 *   ACCEPTED by the gateway and silently produces unrelated results —
 *   this client validates the `urn:audience:*` shape up front so garbage
 *   can never masquerade as an answer.
 * - Invalid `signal.demographics.age` -> 400 listing the enum; validated
 *   client-side against the live list
 *   (24_and_younger|25_to_29|30_to_34|35_to_44|35_and_younger|36_to_55|
 *   45_to_54|55_and_older). `gender` is male|female.
 * - Explainability: with a DEMOGRAPHIC-ONLY signal the sandbox returns
 *   no attribution blocks at all (verified live), so both the per-result
 *   `explain` and the aggregate come back null — honestly, without
 *   invented numbers. On mixed requests (audience + entity signals) the
 *   attribution appears under `signal.interests.entities` only; the
 *   aggregate normalizer is signal-path-keyed, so it is already correct
 *   for a future demographics path.
 * - `/v2/audiences` REQUIRES a selector (same gateway pattern as
 *   /v2/tags): `filter.query`, `filter.audience.types`,
 *   `filter.parents.types`, `filter.results.audiences`, `filter.tags`,
 *   `filter.popularity.min/max` — else 400. `searchAudiences` always
 *   sends `filter.query`, so a well-formed call can never hit that 400.
 * - The documented `/v2/audience/types` route returns 404 on the
 *   hackathon host; not used here.
 *
 * Transport (X-Api-Key, rate limiting, retries, two-tier cache,
 * single-flight) is inherited from `qlooClient`. Entity/insights
 * normalization is REUSED from `crossDomainClient` so every insights
 * caller sees one result format; audience discovery results get the
 * long-lived reference-data TTL (24h) while insights stay volatile.
 */

import { qlooClient } from './qlooClient.js';
import {
  INSIGHTS_PATH,
  resolveEntityIds,
  resolveTargetDomain,
  normalizeAffinityEntity,
  normalizeAggregateExplainability,
  CrossDomainAffinityError,
} from './crossDomainClient.js';

/** Find-Audiences endpoint (audience URN discovery). */
export const AUDIENCES_PATH = '/v2/audiences';

const DEFAULT_TAKE = 20; // documented default on sibling endpoints
const MAX_TAKE = 50; // documented maximum on sibling endpoints
const MAX_PAGE = 100;
const MAX_QUERY_LENGTH = 200;
/** Client-side safety rails: far beyond practical usage. */
const MAX_AUDIENCES = 100;
const MAX_TAG_IDS = 100;

/** Full audience URN, e.g. `urn:audience:hobbies_and_interests:outdoors`. */
const AUDIENCE_URN = /^urn:audience:[a-z0-9_]+(:[a-z0-9_]+)+$/;
/** Shorthand: type:value without the prefix, e.g. `hobbies_and_interests:outdoors`. */
const AUDIENCE_SHORTHAND = /^[a-z0-9_]+(:[a-z0-9_]+)+$/;
/** Full tag URN, e.g. `urn:tag:genre:media:horror`. */
const TAG_URN = /^urn:tag:[a-z0-9_]+(:[a-z0-9_]+)+$/;
const TAG_SHORTHAND = /^[a-z0-9_]+(:[a-z0-9_]+)+$/;

/**
 * Demographic enums exactly as verified live (the 400 error enumerates
 * them; age matches the official Parameter Reference).
 */
export const AGE_RANGES = Object.freeze([
  '24_and_younger',
  '25_to_29',
  '30_to_34',
  '35_to_44',
  '35_and_younger',
  '36_to_55',
  '45_to_54',
  '55_and_older',
]);
export const GENDERS = Object.freeze(['male', 'female']);

const TREND_WEIGHTS = Object.freeze([
  'very_low',
  'low',
  'mid',
  'medium',
  'high',
  'very_high',
]);

/** Parameters owned by getAudienceInsights; `extra` may not shadow them. */
const INSIGHTS_RESERVED = new Set([
  'filter.type',
  'signal.demographics.audiences',
  'signal.demographics.audiences.weight',
  'signal.demographics.age',
  'signal.demographics.age.weight',
  'signal.demographics.gender',
  'signal.demographics.gender.weight',
  'signal.interests.entities',
  'signal.interests.tags',
  'signal.interests.tags.weight',
  'signal.location.query',
  'feature.explainability',
  'take',
  'page',
  'offset',
]);

/** Parameters owned by searchAudiences; `extra` may not shadow them. */
const AUDIENCES_RESERVED = new Set(['filter.query', 'take']);

/** Error for client-side validation and malformed upstream payloads. */
export class AudienceInsightsError extends Error {
  constructor(message, { code = 'VALIDATION', details } = {}) {
    super(message);
    this.name = 'AudienceInsightsError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Validates and normalizes audience input into `urn:audience:*` URNs.
 * Accepts a single value, a comma-separated string, or an array. Each
 * entry may be a full URN or a `type:value` shorthand. SINGLE WORDS ARE
 * REJECTED ON PURPOSE: the live gateway silently accepts them and returns
 * unrelated results, so failing fast here is the only way to keep garbage
 * out of an analysis. Use `searchAudiences` to discover valid URNs.
 *
 * @throws {AudienceInsightsError} code `INVALID_AUDIENCES`.
 */
export function resolveAudiences(audiences) {
  const list = Array.isArray(audiences) ? audiences : [audiences];
  const resolved = [];

  for (const entry of list) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'string') {
      throw new AudienceInsightsError(
        'audiences must be strings (urn:audience:type:value, a ' +
          'comma-separated string, or an array of them)',
        { code: 'INVALID_AUDIENCES', details: { audiences: entry } }
      );
    }
    for (const part of entry.split(',')) {
      const value = part.trim().toLowerCase();
      if (value.length === 0) continue; // tolerate "a,,b" gracefully

      if (AUDIENCE_URN.test(value)) {
        resolved.push(value);
      } else if (value.startsWith('urn:audience:')) {
        throw new AudienceInsightsError(
          `Invalid audience "${part.trim()}": looks like an audience URN but ` +
            'does not match urn:audience:<type>:<value>',
          { code: 'INVALID_AUDIENCES', details: { audience: part } }
        );
      } else if (AUDIENCE_SHORTHAND.test(value)) {
        resolved.push(`urn:audience:${value}`);
      } else {
        throw new AudienceInsightsError(
          `Invalid audience "${part.trim()}". Use the URN form ` +
            '(urn:audience:hobbies_and_interests:outdoors) or the ' +
            'type:value shorthand (hobbies_and_interests:outdoors); single ' +
            'words are silently misinterpreted by the API, so they are ' +
            'rejected here — discover valid URNs via searchAudiences',
          { code: 'INVALID_AUDIENCES', details: { audience: part } }
        );
      }
    }
  }

  if (resolved.length === 0) {
    throw new AudienceInsightsError(
      'audiences must resolve to at least one urn:audience:* value',
      { code: 'INVALID_AUDIENCES', details: { audiences } }
    );
  }
  if (resolved.length > MAX_AUDIENCES) {
    throw new AudienceInsightsError(
      `audiences: at most ${MAX_AUDIENCES} audience segments are allowed ` +
        `(got ${resolved.length})`,
      { code: 'INVALID_AUDIENCES', details: { count: resolved.length } }
    );
  }
  return [...new Set(resolved)];
}

/**
 * Validates tag ids for `signal.interests.tags` (full `urn:tag:*` URNs or
 * `kind:domain:value` shorthands). Single words are rejected (ambiguous).
 *
 * @throws {AudienceInsightsError} code `INVALID_TAG_IDS`.
 */
export function resolveTagIds(tagIds) {
  const list = Array.isArray(tagIds) ? tagIds : [tagIds];
  const resolved = [];

  for (const entry of list) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'string') {
      throw new AudienceInsightsError('each tag id must be a string', {
        code: 'INVALID_TAG_IDS',
        details: { tagIds: entry },
      });
    }
    for (const part of entry.split(',')) {
      const value = part.trim().toLowerCase();
      if (value.length === 0) continue;

      if (TAG_URN.test(value)) {
        resolved.push(value);
      } else if (value.startsWith('urn:')) {
        throw new AudienceInsightsError(
          `Invalid tag id "${part.trim()}": looks like a URN but does not ` +
            'match urn:tag:<kind>:<domain>[:<value>]',
          { code: 'INVALID_TAG_IDS', details: { tagIds: part } }
        );
      } else if (TAG_SHORTHAND.test(value)) {
        resolved.push(`urn:tag:${value}`);
      } else {
        throw new AudienceInsightsError(
          `Invalid tag id "${part.trim()}". Use urn:tag:genre:media:horror ` +
            'or the kind:domain:value shorthand',
          { code: 'INVALID_TAG_IDS', details: { tagIds: part } }
        );
      }
    }
  }

  if (resolved.length > MAX_TAG_IDS) {
    throw new AudienceInsightsError(
      `tagIds: at most ${MAX_TAG_IDS} tags are allowed (got ${resolved.length})`,
      { code: 'INVALID_TAG_IDS', details: { count: resolved.length } }
    );
  }
  return [...new Set(resolved)];
}

/** Validates a signal weight (documented: number >= 0 or a weight word). */
function validateWeight(value, optionName) {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new AudienceInsightsError(
        `${optionName} must be a non-negative number or one of: ` +
          TREND_WEIGHTS.join(', '),
        { code: 'INVALID_WEIGHT', details: { [optionName]: value } }
      );
    }
    return value;
  }
  if (typeof value === 'string' && TREND_WEIGHTS.includes(value)) {
    return value;
  }
  throw new AudienceInsightsError(
    `${optionName} must be a non-negative number or one of: ` +
      TREND_WEIGHTS.join(', '),
    { code: 'INVALID_WEIGHT', details: { [optionName]: value } }
  );
}

/** Validates one or more age ranges against the live enum. */
function resolveAgeRanges(age) {
  const list = Array.isArray(age) ? age : [age];
  const resolved = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !AGE_RANGES.includes(entry.trim())) {
      throw new AudienceInsightsError(
        `age must be one of: ${AGE_RANGES.join(', ')}`,
        { code: 'INVALID_AGE', details: { age: entry } }
      );
    }
    resolved.push(entry.trim());
  }
  return [...new Set(resolved)];
}

/** Validates gender against the documented enum. */
function resolveGender(gender) {
  if (typeof gender !== 'string' || !GENDERS.includes(gender.trim())) {
    throw new AudienceInsightsError(`gender must be one of: ${GENDERS.join(', ')}`, {
      code: 'INVALID_GENDER',
      details: { gender },
    });
  }
  return gender.trim();
}

const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;
const asObject = (value) => (value && typeof value === 'object' ? value : {});

/** Clamps/validates take (documented 1..50 pattern on Qloo GET routes). */
function resolveTake(take) {
  if (take === undefined) return DEFAULT_TAKE;
  if (typeof take !== 'number' || !Number.isFinite(take)) {
    throw new AudienceInsightsError('take must be a number', {
      code: 'INVALID_TAKE',
      details: { take },
    });
  }
  return Math.min(MAX_TAKE, Math.max(1, Math.trunc(take)));
}

function resolvePage(page) {
  if (page === undefined) return undefined;
  if (
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_PAGE
  ) {
    throw new AudienceInsightsError(
      `page must be an integer between 1 and ${MAX_PAGE}`,
      { code: 'INVALID_PAGE', details: { page } }
    );
  }
  return page;
}

function resolveOffset(offset) {
  if (offset === undefined) return undefined;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
    throw new AudienceInsightsError('offset must be a non-negative number', {
      code: 'INVALID_OFFSET',
      details: { offset },
    });
  }
  return Math.trunc(offset);
}

/** Validates the free-text query used by searchAudiences. */
function resolveQuery(query) {
  if (typeof query !== 'string') {
    throw new AudienceInsightsError('query must be a string', {
      code: 'INVALID_QUERY',
      details: { query },
    });
  }
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
    throw new AudienceInsightsError(
      `query must be 1..${MAX_QUERY_LENGTH} characters after trimming`,
      { code: 'INVALID_QUERY', details: { query } }
    );
  }
  return trimmed;
}

/** Validates a scalar-only extra bag against a reserved-parameter set. */
function collectExtra(extra, reservedSet) {
  const extraParams = {};
  if (extra === undefined) return extraParams;
  if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
    throw new AudienceInsightsError('extra must be a plain object', {
      code: 'INVALID_EXTRA',
      details: { extra },
    });
  }
  for (const [key, value] of Object.entries(extra)) {
    if (reservedSet.has(key)) {
      throw new AudienceInsightsError(
        `extra.${key} is reserved; pass it as a dedicated argument`,
        { code: 'RESERVED_PARAM', details: { param: key } }
      );
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new AudienceInsightsError(
        `extra.${key} must be a string, number or boolean ` +
          '(join lists into a comma-separated string yourself)',
        { code: 'INVALID_EXTRA', details: { param: key, value } }
      );
    }
    extraParams[key] = value;
  }
  return extraParams;
}

/**
 * Computes consumer-audience insights: entities of a target domain ranked
 * by affinity to a DEMOGRAPHIC profile (audience segments, age range,
 * gender), optionally blended with taste signals (entity/tag ids) and a
 * geolocation bias.
 *
 * All validation is synchronous and happens BEFORE any I/O, so an
 * invalid call never consumes hackathon key quota.
 *
 * @param {object} parameters
 * @param {string} parameters.targetDomain    Required target domain (reuse of
 *                                           the cross-domain vocabulary:
 *                                           "movie", "place", "urn:entity:…";
 *                                           heatmap/audience rejected).
 * @param {string|string[]} [parameters.audiences] Audience URNs
 *                                           (`urn:audience:type:value`) or
 *                                           `type:value` shorthands; single
 *                                           words REJECTED (the gateway
 *                                           silently misreads them).
 * @param {string|string[]} [parameters.entityIds] Taste signal entities to
 *                                           blend in (UUIDs).
 * @param {string|string[]} [parameters.tagIds]  Taste signal tags
 *                                           (`urn:tag:…` or shorthands).
 * @param {string} [parameters.location]      signal.location.query — a
 *                                           locality name ("Denver").
 * @param {string|string[]} [parameters.age]  One or more of AGE_RANGES.
 * @param {string} [parameters.gender]        'male' | 'female'.
 * @param {number|string} [parameters.audienceWeight] 0..| very_low…very_high.
 * @param {number|string} [parameters.ageWeight]      same shape.
 * @param {number|string} [parameters.genderWeight]   same shape.
 * @param {number|string} [parameters.tagWeight]      signal.interests.tags.weight.
 * @param {boolean} [parameters.explainability=true]  Per-result + aggregate
 *                                           attribution; false omits the param.
 * @param {number} [parameters.take=20]       Clamped to 1..50 (documented).
 * @param {number} [parameters.page]          1..100 (documented pagination).
 * @param {number} [parameters.offset]        Special-case alternative to page.
 * @param {object} [parameters.extra]         Extra scalar query params; may
 *                                           not shadow this module's params.
 * @returns {Promise<{targetType: string, audiences: string[], age: string[]|null,
 *                    gender: string|null, take: number, page: number|null,
 *                    offset: number|null, count: number,
 *                    explainability: Record<string, object>|null,
 *                    results: Array<object>}>}
 * @throws {AudienceInsightsError} synchronously on invalid input; rejects
 *         with `QlooApiError` on upstream failures.
 */
export function getAudienceInsights(parameters = {}) {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new AudienceInsightsError('parameters must be a plain object', {
      code: 'INVALID_PARAMETERS',
      details: { parameters },
    });
  }

  const {
    targetDomain,
    audiences,
    entityIds,
    tagIds,
    location,
    age,
    gender,
    audienceWeight,
    ageWeight,
    genderWeight,
    tagWeight,
    explainability,
    take,
    page,
    offset,
    extra,
  } = parameters;

  // --- synchronous validation (no I/O) -------------------------------------
  let targetType;
  try {
    targetType = resolveTargetDomain(targetDomain);
  } catch (err) {
    // Re-wrap cross-module errors into this client's error type while
    // preserving the message and the precise code.
    throw new AudienceInsightsError(err.message, {
      code: err instanceof CrossDomainAffinityError ? err.code : 'INVALID_TARGET_DOMAIN',
      details: err.details,
    });
  }

  const audienceUrns = audiences !== undefined ? resolveAudiences(audiences) : [];
  let signalEntityIds = [];
  if (entityIds !== undefined) {
    try {
      signalEntityIds = resolveEntityIds(entityIds);
    } catch (err) {
      throw new AudienceInsightsError(err.message, {
        code: err instanceof CrossDomainAffinityError ? err.code : 'INVALID_ENTITY_IDS',
        details: err.details,
      });
    }
  }
  const signalTagIds = tagIds !== undefined ? resolveTagIds(tagIds) : [];

  let locationQuery;
  if (location !== undefined) {
    if (typeof location !== 'string' || location.trim().length === 0) {
      throw new AudienceInsightsError(
        'location must be a non-empty locality name (e.g. "Denver")',
        { code: 'INVALID_LOCATION', details: { location } }
      );
    }
    locationQuery = location.trim();
  }

  const ageRanges = age !== undefined ? resolveAgeRanges(age) : null;
  const genderValue = gender !== undefined ? resolveGender(gender) : null;
  const weights = {
    audiences: validateWeight(audienceWeight, 'audienceWeight'),
    age: validateWeight(ageWeight, 'ageWeight'),
    gender: validateWeight(genderWeight, 'genderWeight'),
    tags: validateWeight(tagWeight, 'tagWeight'),
  };
  const normalizedTake = resolveTake(take);
  const normalizedPage = resolvePage(page);
  const normalizedOffset = resolveOffset(offset);

  let sendExplainability = true; // attribution is the point (see module header)
  if (explainability !== undefined) {
    if (typeof explainability !== 'boolean') {
      throw new AudienceInsightsError('explainability must be a boolean', {
        code: 'INVALID_FEATURE_FLAG',
        details: { explainability },
      });
    }
    sendExplainability = explainability;
  }

  const extraParams = collectExtra(extra, INSIGHTS_RESERVED);

  // The live gateway 400s without at least one signal or filter; check
  // client-side so the caller gets an instant, precise error. `extra`
  // may legitimately carry a filter (e.g. filter.tags), so it counts.
  const hasSignal =
    audienceUrns.length > 0 ||
    signalEntityIds.length > 0 ||
    signalTagIds.length > 0 ||
    locationQuery !== undefined;
  if (!hasSignal && Object.keys(extraParams).length === 0) {
    throw new AudienceInsightsError(
      'at least one signal is required: audiences, entityIds, tagIds or ' +
        'location (or a filter.* param via extra)',
      { code: 'NO_SIGNAL', details: { parameters } }
    );
  }

  // --- request ---------------------------------------------------------------
  const params = {
    'filter.type': targetType,
    take: normalizedTake,
    ...extraParams,
  };
  if (audienceUrns.length > 0) {
    params['signal.demographics.audiences'] = audienceUrns.join(',');
  }
  if (weights.audiences !== undefined) {
    params['signal.demographics.audiences.weight'] = weights.audiences;
  }
  if (ageRanges) params['signal.demographics.age'] = ageRanges.join(',');
  if (weights.age !== undefined) params['signal.demographics.age.weight'] = weights.age;
  if (genderValue) params['signal.demographics.gender'] = genderValue;
  if (weights.gender !== undefined) {
    params['signal.demographics.gender.weight'] = weights.gender;
  }
  if (signalEntityIds.length > 0) {
    params['signal.interests.entities'] = signalEntityIds.join(',');
  }
  if (signalTagIds.length > 0) {
    params['signal.interests.tags'] = signalTagIds.join(',');
  }
  if (weights.tags !== undefined) params['signal.interests.tags.weight'] = weights.tags;
  if (locationQuery !== undefined) params['signal.location.query'] = locationQuery;
  // Default ON; explicit false omits the parameter (server default is
  // false, so omitting is equivalent without the extra bytes).
  if (sendExplainability) params['feature.explainability'] = true;
  if (normalizedPage !== undefined) params.page = normalizedPage;
  if (normalizedOffset !== undefined) params.offset = normalizedOffset;

  return qlooClient.get(INSIGHTS_PATH, params).then((payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AudienceInsightsError(
        'Qloo insights response was not a JSON object',
        { code: 'MALFORMED_RESPONSE', details: { payload } }
      );
    }
    if (payload.success === false) {
      throw new AudienceInsightsError(
        'Qloo reported success=false for the audience insights query',
        { code: 'UPSTREAM_ERROR', details: { payload } }
      );
    }

    const rawEntities = Array.isArray(payload.results?.entities)
      ? payload.results.entities
      : [];
    const results = rawEntities.map(normalizeAffinityEntity).filter(Boolean);

    return {
      targetType,
      audiences: audienceUrns,
      age: ageRanges,
      gender: genderValue,
      take: normalizedTake,
      page: normalizedPage ?? null,
      offset: normalizedOffset ?? null,
      count: results.length,
      explainability: normalizeAggregateExplainability(payload),
      results,
    };
  });
}

/**
 * Normalizes one audience-search item (Find Audiences response).
 * Returns null when too malformed (no id or no name).
 */
export function normalizeAudience(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = nonEmptyString(raw.id);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const parents = Array.isArray(raw.parents)
    ? raw.parents
        .map((p) => {
          const obj = asObject(p);
          return {
            id: nonEmptyString(obj.id),
            name: nonEmptyString(obj.name),
            type: nonEmptyString(obj.type),
          };
        })
        .filter((p) => p.id !== null || p.name !== null)
    : [];

  return {
    id,
    name,
    type: nonEmptyString(raw.type),
    entityId: nonEmptyString(raw.entity_id),
    disambiguation: nonEmptyString(raw.disambiguation),
    parents,
  };
}

/**
 * Discovers audience URNs by keyword (documented Find Audiences route).
 * The official Qloo workflow: search here, then feed the returned `id`
 * (URN form, NOT the UUID) into `getAudienceInsights({ audiences })`.
 *
 * @param {string} query       Free-text audience name (trimmed, <= 200 chars).
 *                             Always sent as `filter.query`, which also
 *                             satisfies the gateway's selector requirement.
 * @param {object} [options]
 * @param {number} [options.take=20]  Clamped to 1..50.
 * @param {object} [options.extra]    Extra scalar query params (exploration);
 *                                    may not shadow filter.query or take.
 * @returns {Promise<{query: string, take: number, count: number,
 *                    results: Array<{id: string, name: string,
 *                      type: string|null, entityId: string|null,
 *                      disambiguation: string|null,
 *                      parents: Array<object>}>}>}
 * @throws {AudienceInsightsError} synchronously on invalid input; rejects
 *         with `QlooApiError` on upstream failures.
 */
export function searchAudiences(query, options = {}) {
  const normalizedQuery = resolveQuery(query);
  const { take, extra } = options;
  const normalizedTake = resolveTake(take);
  const extraParams = collectExtra(extra, AUDIENCES_RESERVED);

  const params = {
    'filter.query': normalizedQuery, // selector + search term
    take: normalizedTake,
    ...extraParams,
  };

  return qlooClient.get(AUDIENCES_PATH, params).then((payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AudienceInsightsError(
        'Qloo audiences response was not a JSON object',
        { code: 'MALFORMED_RESPONSE', details: { payload } }
      );
    }
    if (payload.success === false) {
      throw new AudienceInsightsError(
        'Qloo reported success=false for the audiences query',
        { code: 'UPSTREAM_ERROR', details: { payload } }
      );
    }

    const rawAudiences = Array.isArray(payload.results?.audiences)
      ? payload.results.audiences
      : [];
    const results = rawAudiences.map(normalizeAudience).filter(Boolean);

    return {
      query: normalizedQuery,
      take: normalizedTake,
      count: results.length,
      results,
    };
  });
}

const audienceInsightsClient = {
  getAudienceInsights,
  searchAudiences,
  resolveAudiences,
  resolveTagIds,
  normalizeAudience,
  AGE_RANGES,
  GENDERS,
  AUDIENCES_PATH,
};

export default audienceInsightsClient;

/**
 * Modular client for the Qloo Tags endpoint (`GET /v2/tags`) — the "taste
 * vector tags" API: given an entity and one or more tag types, return the
 * catalog tags Qloo associates with that entity's taste profile (genres,
 * styles, themes, keywords …) with popularity and affinity metadata.
 *
 * Contract was verified TWO ways and reconciled:
 *   1. the official OpenAPI spec for `GET /v2/tags` ("Search Tags");
 *   2. live probes against the Qloo hackathon host (2026-10-14), because
 *      the sandbox's runtime behavior differs from the spec in places.
 *
 * Documented contract (OpenAPI):
 * - Params: `filter.tag.types`, `filter.query`, `filter.results.tags`,
 *   `filter.parents.types`, `filter.popularity.min/max`, `page` (1..100,
 *   the RECOMMENDED pagination mechanism), `take` (default 20, max 50),
 *   `feature.typo_tolerance`, `feature.semantic_search` (beta, use with
 *   `filter.query`); `offset` is mentioned in the `take` description as a
 *   special-case alternative to `page`.
 * - Response: `{ duration, success, results: { tags: [...] } }`.
 * - Tag IDs follow `urn:tag:<kind>:<domain>[:<value>]`.
 *
 * Live-verified sandbox realities (not in the spec):
 * - The gateway REQUIRES at least one "selector" parameter among
 *   `filter.tag.types`, `filter.query`, `filter.parents.types`,
 *   `filter.tags`, `filter.results.tags`, `filter.popularity.min/max`,
 *   otherwise it answers 400 listing them. `filter.entities` is NOT a
 *   selector — it is a valid *scoping* parameter that must accompany one.
 *   This client always sends `filter.tag.types` (the `type` argument), so
 *   a well-formed call can never produce that 400.
 * - `filter.entities=<entityId>` scopes tags to the entity. Note: the
 *   current sandbox build accepts the parameter but appears to return
 *   type-scoped catalog results regardless; the parameter is still sent
 *   (documented Qloo convention) so the client is correct the moment the
 *   backend honors it, with zero code changes here.
 * - `take=51` was accepted leniently despite the documented 50-cap — the
 *   client clamps to the DOCUMENTED range, since production may enforce it.
 * - Numeric zero (e.g. `filter.popularity.min=0`) is silently dropped by
 *   the gateway, which then 400s for a missing selector — never rely on
 *   zero-valued selectors (see `validateOptions`).
 * - Tag shapes differ between doc generations: the live host returns
 *   `{ id, name, type, popularity, properties, parents, tags }` while the
 *   documented Taste Analysis example shows `{ tag_id, name, subtype,
 *   tag_value, types, query }`. Normalization tolerates both.
 *
 * Transport concerns (X-Api-Key, rate limiting, retries/backoff, two-tier
 * caching, single-flight dedup) are inherited from `qlooClient` — this
 * module performs zero direct `fetch` calls. `/v2/tags` automatically
 * receives the long-lived (24h) cache TTL via `ttlForPathname`.
 */

import { qlooClient } from './qlooClient.js';

/** Endpoint path (v2 Tags Search). */
export const TAGS_PATH = '/v2/tags';

const DEFAULT_TAKE = 20; // documented default for GET /v2/tags
const MAX_TAKE = 50; // documented maximum (sandbox is lenient; spec is not)
const MAX_PAGE = 100; // documented page ceiling
const MAX_QUERY_LENGTH = 200;
const MAX_ENTITY_ID_LENGTH = 128;

/** Full tag-type URN, e.g. `urn:tag:genre:media` or `urn:tag:subgenre:qloo`. */
const TAG_TYPE_URN = /^urn:tag:[a-z0-9_]+(:[a-z0-9_]+)*$/;
/** Shorthand form: at least two colon-separated parts, e.g. `genre:media`. */
const TAG_TYPE_SHORTHAND = /^[a-z0-9_]+(:[a-z0-9_]+)+$/;

/** Query parameters this module owns; `extra` may not shadow them. */
const RESERVED_PARAMS = new Set([
  'filter.entities',
  'filter.tag.types',
  'filter.query',
  'filter.popularity.min',
  'filter.popularity.max',
  'feature.typo_tolerance',
  'feature.semantic_search',
  'take',
  'page',
  'offset',
]);

/** Error for client-side validation and malformed upstream payloads. */
export class TasteTagsError extends Error {
  constructor(message, { code = 'VALIDATION', details } = {}) {
    super(message);
    this.name = 'TasteTagsError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalizes a tag-type argument into full `urn:tag:*` URNs.
 *
 * Accepts a single name, a comma-separated string, or an array of names.
 * Each entry may be:
 *   - a full URN (`urn:tag:genre:media`) — passed through;
 *   - a two-plus-part shorthand (`genre:media`) — prefixed with `urn:tag:`.
 * Single words ("genre") are rejected on purpose: they are ambiguous across
 * domains (genre:media vs genre:place vs genre:restaurant) and guessing
 * would silently query the wrong catalog.
 *
 * @throws {TasteTagsError} code `INVALID_TYPE` for unknown/malformed input.
 */
export function resolveTagType(type) {
  if (typeof type !== 'string' && !Array.isArray(type)) {
    throw new TasteTagsError(
      'type must be a tag-type string (e.g. "genre:media") or an array of them',
      { code: 'INVALID_TYPE', details: { type } }
    );
  }

  const list = Array.isArray(type) ? type : [type];
  const resolved = [];

  for (const entry of list) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TasteTagsError('each tag type must be a non-empty string', {
        code: 'INVALID_TYPE',
        details: { type: entry },
      });
    }
    const raw = entry.trim().toLowerCase();

    for (const part of raw.split(',')) {
      const value = part.trim();
      if (value.length === 0) continue; // tolerate "a,,b" gracefully

      if (TAG_TYPE_URN.test(value)) {
        resolved.push(value);
      } else if (value.startsWith('urn:')) {
        // A malformed URN must NOT fall through to shorthand handling:
        // "urn:tag" would otherwise become the nonsense "urn:tag:urn:tag".
        throw new TasteTagsError(
          `Invalid tag type "${entry}": looks like a URN but does not match ` +
            'the urn:tag:<kind>:<domain>[:<value>] format',
          { code: 'INVALID_TYPE', details: { type: entry } }
        );
      } else if (TAG_TYPE_SHORTHAND.test(value)) {
        resolved.push(`urn:tag:${value}`);
      } else {
        throw new TasteTagsError(
          `Invalid tag type "${entry}". Use a full URN (urn:tag:genre:media) ` +
            'or a two-plus-part shorthand (genre:media, subgenre:qloo); ' +
            'single words are ambiguous across tag domains',
          { code: 'INVALID_TYPE', details: { type: entry } }
        );
      }
    }
  }

  if (resolved.length === 0) {
    throw new TasteTagsError('type must resolve to at least one tag type', {
      code: 'INVALID_TYPE',
      details: { type },
    });
  }
  return resolved;
}

/**
 * Validates the entity id. Qloo ids are usually UUIDs but may be other
 * opaque tokens, so the check is structural (non-empty, no whitespace,
 * no comma — a comma would silently inject a second id into the
 * comma-separated parameter), not a strict UUID pattern.
 *
 * @throws {TasteTagsError} code `INVALID_ENTITY_ID`.
 */
function validateEntityId(entityId) {
  if (typeof entityId !== 'string') {
    throw new TasteTagsError('entityId must be a string', {
      code: 'INVALID_ENTITY_ID',
      details: { entityId },
    });
  }
  const trimmed = entityId.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ENTITY_ID_LENGTH ||
    /\s|,/.test(trimmed)
  ) {
    throw new TasteTagsError(
      'entityId must be a non-empty token (no whitespace or commas), ' +
        `at most ${MAX_ENTITY_ID_LENGTH} characters`,
      { code: 'INVALID_ENTITY_ID', details: { entityId } }
    );
  }
  return trimmed;
}

/**
 * Validates pagination, filtering and feature options.
 * `take` outside the documented 1..50 range is CLAMPED (forgiving for
 * LLM/tool callers); non-numeric or non-finite values THROW (a type error
 * is a bug). Pagination prefers the documented `page` (1..100); `offset`
 * remains available as the documented special-case alternative.
 */
function validateOptions({
  take,
  page,
  offset,
  query,
  typoTolerance,
  semanticSearch,
  popularityMin,
  popularityMax,
  extra,
} = {}) {
  let normalizedTake = DEFAULT_TAKE;
  if (take !== undefined) {
    if (typeof take !== 'number' || !Number.isFinite(take)) {
      throw new TasteTagsError('take must be a number', {
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
      throw new TasteTagsError(`page must be an integer between 1 and ${MAX_PAGE}`, {
        code: 'INVALID_PAGE',
        details: { page },
      });
    }
    normalizedPage = page;
  }

  let normalizedOffset;
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
      throw new TasteTagsError('offset must be a non-negative number', {
        code: 'INVALID_OFFSET',
        details: { offset },
      });
    }
    normalizedOffset = Math.trunc(offset);
  }

  let normalizedQuery;
  if (query !== undefined) {
    if (typeof query !== 'string') {
      throw new TasteTagsError('query must be a string', {
        code: 'INVALID_QUERY',
        details: { query },
      });
    }
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
      throw new TasteTagsError(
        `query must be 1..${MAX_QUERY_LENGTH} characters after trimming`,
        { code: 'INVALID_QUERY', details: { query } }
      );
    }
    normalizedQuery = trimmed;
  }

  // Boolean feature flags; only EXPLICIT true is sent (undefined stays
  // absent so server defaults apply).
  const flags = {};
  for (const [name, value, code] of [
    ['feature.typo_tolerance', typoTolerance, 'INVALID_FEATURE_FLAG'],
    ['feature.semantic_search', semanticSearch, 'INVALID_FEATURE_FLAG'],
  ]) {
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new TasteTagsError(`${name} must be a boolean`, {
        code,
        details: { [name]: value },
      });
    }
    if (value) flags[name] = true;
  }

  // Popularity range (documented float 0..1). IMPORTANT live quirk: the
  // gateway silently DROPS numeric zero, which turns a bare query into a
  // 400 "missing selector". Since this client always sends
  // filter.tag.types, dropping zero can no longer 400 — but it would
  // still silently widen the range, so min=0 is normalized to "absent"
  // (identical semantics: no lower bound) and documented as such.
  const popularity = {};
  for (const [name, value, code] of [
    ['filter.popularity.min', popularityMin, 'INVALID_POPULARITY'],
    ['filter.popularity.max', popularityMax, 'INVALID_POPULARITY'],
  ]) {
    if (value === undefined) continue;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new TasteTagsError(`${name} must be a float between 0 and 1`, {
        code,
        details: { [name]: value },
      });
    }
    if (value === 0) continue; // dropped by the gateway anyway (see above)
    popularity[name] = value;
  }

  const extraParams = {};
  if (extra !== undefined) {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw new TasteTagsError('extra must be a plain object', {
        code: 'INVALID_EXTRA',
        details: { extra },
      });
    }
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_PARAMS.has(key)) {
        throw new TasteTagsError(
          `extra.${key} is reserved; pass it as a dedicated argument`,
          { code: 'RESERVED_PARAM', details: { param: key } }
        );
      }
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        throw new TasteTagsError(
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
    query: normalizedQuery,
    flags,
    popularity,
    extraParams,
  };
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;
const asObject = (value) => (value && typeof value === 'object' ? value : {});

/**
 * Normalizes one raw tag. Tolerates both observed shapes:
 *   - live host: { id, name, type, popularity, properties, parents, tags }
 *   - docs:      { tag_id, name, subtype, tag_value, types, query }
 * Returns null when the item is too malformed to use (no id or no name) —
 * the caller drops it rather than throwing.
 */
export function normalizeTag(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id =
    nonEmptyString(raw.id) ??
    nonEmptyString(raw.tag_id) ??
    nonEmptyString(raw.tag_value);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const props = asObject(raw.properties);
  const queryMeta = asObject(raw.query);

  // Parents: [{ type: "urn:entity:movie" }, …] on the live host.
  const parents = Array.isArray(raw.parents)
    ? raw.parents
        .map((p) => (typeof p === 'string' ? p : asObject(p).type))
        .filter((t) => typeof t === 'string' && t.length > 0)
    : [];

  // Nested sub-tags ({ tag_id, name, type, value } per docs).
  const nestedTags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => {
          const obj = asObject(t);
          const nestedId =
            nonEmptyString(obj.id) ??
            nonEmptyString(obj.tag_id) ??
            nonEmptyString(obj.value);
          const nestedName = nonEmptyString(obj.name);
          if (!nestedId && !nestedName) return null;
          return {
            id: nestedId,
            name: nestedName,
            type: nonEmptyString(obj.type),
          };
        })
        .filter(Boolean)
    : [];

  return {
    id,
    name,
    type: nonEmptyString(raw.type) ?? nonEmptyString(raw.subtype) ?? null,
    popularity: finiteNumber(raw.popularity),
    // Taste-affinity metadata when the gateway attaches it under `query`
    // (empty object on current sandbox builds — kept for forward compat).
    affinity: finiteNumber(queryMeta.affinity),
    description: nonEmptyString(props.description),
    history: nonEmptyString(props.history),
    parents,
    tags: nestedTags,
  };
}

/** Extracts the tag list from the two payload shapes observed/documented. */
function extractRawTags(payload) {
  if (Array.isArray(payload.results?.tags)) return payload.results.tags;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.tags)) return payload.tags;
  return [];
}

/**
 * Validates and normalizes a tags payload.
 * Throws `TasteTagsError` for non-object payloads or `success: false`;
 * a missing tag list is tolerated as "no matches".
 */
function normalizeTagsPayload(payload, context) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TasteTagsError('Qloo tags response was not a JSON object', {
      code: 'MALFORMED_RESPONSE',
      details: { payload },
    });
  }
  if (payload.success === false) {
    throw new TasteTagsError('Qloo reported success=false for the tags query', {
      code: 'UPSTREAM_ERROR',
      details: { payload },
    });
  }

  const results = extractRawTags(payload)
    .map(normalizeTag)
    .filter(Boolean);

  return {
    entityId: context.entityId,
    types: context.types,
    take: context.take,
    page: context.page,
    offset: context.offset,
    count: results.length,
    results,
  };
}

/**
 * Fetches the taste-vector tags Qloo associates with an entity, scoped to
 * one or more tag types.
 *
 * @param {string} entityId           Qloo entity id (UUID from /search or
 *                                    insights results). No whitespace/commas.
 * @param {string|string[]} type     Tag type(s): full URNs (`urn:tag:genre:media`)
 *                                    or shorthands (`genre:media`, `subgenre:qloo`);
 *                                    comma-separated strings and arrays accepted.
 *                                    REQUIRED — the endpoint needs a selector
 *                                    and the entity scoping alone is not one.
 * @param {object} [options]
 * @param {number} [options.take=20]     Page size; clamped to 1..50 (documented).
 * @param {number} [options.page]        1-based page number (1..100); the
 *                                       document-preferred pagination mechanism.
 * @param {number} [options.offset]      Special-case alternative to `page`; >= 0.
 * @param {string} [options.query]       Partial tag-name search (`filter.query`),
 *                                       combined with the type selector.
 * @param {boolean} [options.typoTolerance]  feature.typo_tolerance for `query`.
 * @param {boolean} [options.semanticSearch] feature.semantic_search for `query`
 *                                       (beta, per docs).
 * @param {number} [options.popularityMin]   0..1 percentile floor.
 * @param {number} [options.popularityMax]   0..1 percentile ceiling.
 * @param {object} [options.extra]      Extra scalar query params (exploration);
 *                                      may not shadow this module's params.
 * @returns {Promise<{entityId: string, types: string[], take: number,
 *                    page: number|null, offset: number|null, count: number,
 *                    results: Array<{id: string, name: string, type: string|null,
 *                      popularity: number|null, affinity: number|null,
 *                      description: string|null, history: string|null,
 *                      parents: string[],
 *                      tags: Array<{id: string|null, name: string|null,
 *                        type: string|null}>}>}>}
 * @throws {TasteTagsError} synchronously on invalid input (before any
 *         network call, so a bad call never burns key quota); rejects with
 *         `QlooApiError` on upstream failures.
 */
export function findTags(entityId, type, options = {}) {
  // Validation is synchronous and happens BEFORE any I/O: a bad call can
  // never consume hackathon key quota or wait on the rate limiter.
  const normalizedEntityId = validateEntityId(entityId);
  const types = resolveTagType(type);
  const {
    take,
    page,
    offset,
    query,
    flags,
    popularity,
    extraParams,
  } = validateOptions(options);

  const params = {
    // Entity scoping (documented Qloo convention; see module header for the
    // sandbox caveat — sent unconditionally so it works the moment honored).
    'filter.entities': normalizedEntityId,
    // Tag-type selector: also satisfies the gateway's "at least one
    // selector" requirement, so this call can never 400 for a bare query.
    'filter.tag.types': types.join(','),
    take,
    ...flags,
    ...popularity,
    ...extraParams,
  };
  // Documented pagination: `page` is preferred; `offset` is the documented
  // special-case alternative — only the provided one is sent.
  if (page !== undefined) params.page = page;
  if (offset !== undefined) params.offset = offset;
  if (query !== undefined) params['filter.query'] = query;

  return qlooClient
    .get(TAGS_PATH, params)
    .then((payload) =>
      normalizeTagsPayload(payload, {
        entityId: normalizedEntityId,
        types,
        take,
        page: page ?? null,
        offset: offset ?? null,
      })
    );
}

const tasteTagsClient = {
  findTags,
  resolveTagType,
  normalizeTag,
  TAGS_PATH,
};

export default tasteTagsClient;

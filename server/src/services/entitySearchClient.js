/**
 * Modular client for the Qloo Entity Search endpoint (`GET /search`).
 *
 * Resolves free-text entity names ("Phoebe Bridgers", "Blade Runner")
 * into concrete Qloo entity IDs that can then be fed into insights,
 * analysis and heatmap calls. This module owns everything search-specific:
 *
 * - input validation (fails fast BEFORE any network call, so a bad query
 *   never burns hackathon key quota);
 * - domain ("types") normalization: friendly names ("artist", "film"),
 *   aliases ("tv" -> tv_show), deprecated folds ("actor" -> person) and
 *   raw `urn:entity:*` pass-through;
 * - defensive response parsing: Qloo publishes no formal schema for
 *   `/search` and documented examples differ in small ways, so every field
 *   is extracted tolerantly and malformed items are skipped, never thrown.
 *
 * Transport concerns (auth header, rate limiting, retries, response
 * caching, single-flight dedup) are inherited from `qlooClient` — this
 * module performs zero direct `fetch` calls.
 */

import { qlooClient } from './qlooClient.js';

/** Endpoint path (top-level `/search`, NOT `/v2/search`). */
export const SEARCH_PATH = '/search';

const MAX_QUERY_LENGTH = 200;
const MAX_TAKE = 50; // matches Qloo's documented `take` ceiling
const DEFAULT_TAKE = 10;

/** Error for client-side validation and malformed upstream payloads. */
export class EntitySearchError extends Error {
  constructor(message, { code = 'VALIDATION', details } = {}) {
    super(message);
    this.name = 'EntitySearchError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Friendly domain name -> Qloo entity-type URN. The list follows the
 * current Entity Type Guide; anything missing here can still be requested
 * as a raw URN (pass-through below), so a stale registry can never block
 * a valid call.
 */
export const DOMAINS = Object.freeze({
  actor: 'urn:entity:person', // deprecated -> Person
  album: 'urn:entity:album',
  artist: 'urn:entity:artist',
  author: 'urn:entity:person', // deprecated -> Person
  book: 'urn:entity:book',
  books: 'urn:entity:book', // agent domain vocabulary (see domainMapper)
  brand: 'urn:entity:brand',
  destination: 'urn:entity:destination',
  dining: 'urn:entity:place', // agent domain vocabulary (restaurants = places)
  director: 'urn:entity:person', // deprecated -> Person
  fashion: 'urn:entity:brand', // agent domain vocabulary (fashion = brands)
  film: 'urn:entity:movie',
  game: 'urn:entity:video_game',
  locality: 'urn:entity:locality',
  movie: 'urn:entity:movie',
  music: 'urn:entity:artist',
  person: 'urn:entity:person',
  place: 'urn:entity:place',
  podcast: 'urn:entity:podcast',
  series: 'urn:entity:tv_show',
  television: 'urn:entity:tv_show',
  travel: 'urn:entity:destination',
  tv: 'urn:entity:tv_show',
  tv_show: 'urn:entity:tv_show',
  video_game: 'urn:entity:video_game',
});

const RAW_URN_PATTERN = /^urn:entity:[a-z0-9_]+$/;

/** Query parameters this module owns; `extra` may not shadow them. */
const RESERVED_PARAMS = new Set(['query', 'types', 'take', 'offset']);

/**
 * Normalizes a domain argument into a Qloo entity-type URN.
 * Accepts a single name or an array of names; `undefined`/`null` means
 * "no domain filter" (search across all domains).
 * Throws `EntitySearchError` (code `INVALID_DOMAIN`) for unknown names.
 */
export function resolveDomain(domain) {
  if (domain === undefined || domain === null) return [];
  const list = Array.isArray(domain) ? domain : [domain];

  return list.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new EntitySearchError('domain must be a non-empty string', {
        code: 'INVALID_DOMAIN',
        details: { domain: entry },
      });
    }

    const raw = entry.trim();
    if (RAW_URN_PATTERN.test(raw)) return raw; // raw URN pass-through

    const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
    const urn = DOMAINS[key];
    if (!urn) {
      throw new EntitySearchError(
        `Unknown domain "${entry}". Use a raw URN (urn:entity:…) ` +
          `or one of: ${Object.keys(DOMAINS).sort().join(', ')}`,
        { code: 'INVALID_DOMAIN', details: { domain: entry } }
      );
    }
    return urn;
  });
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Normalizes one raw search item. Returns null when the item is too
 * malformed to use (missing id or name) — the caller drops it.
 */
export function normalizeEntity(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = nonEmptyString(raw.entity_id) ?? nonEmptyString(raw.id);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const asObject = (value) =>
    value && typeof value === 'object' ? value : {};
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
    // Search relevance/affinity metadata Qloo attaches under `query`.
    affinity: finiteNumber(queryMeta.affinity),
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
          .filter((t) => t && typeof t === 'object' && typeof t.name === 'string')
          .map((t) => ({
            // Live-verified shape divergence: /search returns tags as
            // { name, tag_id, type, value } (URN in `tag_id`), while
            // insights returns { id, name, type }. Accept all forms —
            // dropping the URN here silently breaks downstream
            // tag-family classification (domainMapper dining/fashion).
            id:
              nonEmptyString(t.id) ??
              nonEmptyString(t.tag_id) ??
              nonEmptyString(t.value),
            name: t.name,
            type: nonEmptyString(t.type),
          }))
      : [],
  };
}

/**
 * Validates and normalizes the free-text query.
 * Throws `EntitySearchError` (codes `EMPTY_QUERY` / `QUERY_TOO_LONG`).
 */
function validateQuery(query) {
  if (typeof query !== 'string') {
    throw new EntitySearchError('query must be a string', {
      code: 'EMPTY_QUERY',
      details: { query },
    });
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new EntitySearchError('query must not be empty', {
      code: 'EMPTY_QUERY',
      details: { query },
    });
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new EntitySearchError(
      `query must be at most ${MAX_QUERY_LENGTH} characters ` +
        `(got ${trimmed.length})`,
      { code: 'QUERY_TOO_LONG', details: { length: trimmed.length } }
    );
  }
  return trimmed;
}

/**
 * Validates pagination and extra params.
 * `take` outside 1..50 is CLAMPED (forgiving for LLM/tool callers);
 * non-integer or non-finite values THROW (a type error is a bug).
 */
function validateOptions({ take, offset, extra } = {}) {
  let normalizedTake = DEFAULT_TAKE;
  if (take !== undefined) {
    if (typeof take !== 'number' || !Number.isFinite(take)) {
      throw new EntitySearchError('take must be a number', {
        code: 'INVALID_TAKE',
        details: { take },
      });
    }
    normalizedTake = Math.min(MAX_TAKE, Math.max(1, Math.trunc(take)));
  }

  let normalizedOffset = 0;
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
      throw new EntitySearchError(
        'offset must be a non-negative number',
        { code: 'INVALID_OFFSET', details: { offset } }
      );
    }
    normalizedOffset = Math.trunc(offset);
  }

  const extraParams = {};
  if (extra !== undefined) {
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      throw new EntitySearchError('extra must be a plain object', {
        code: 'INVALID_EXTRA',
        details: { extra },
      });
    }
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_PARAMS.has(key)) {
        throw new EntitySearchError(
          `extra.${key} is reserved; pass it as a dedicated argument`,
          { code: 'RESERVED_PARAM', details: { param: key } }
        );
      }
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        throw new EntitySearchError(
          `extra.${key} must be a string, number or boolean ` +
            '(join lists into a comma-separated string yourself)',
          { code: 'INVALID_EXTRA', details: { param: key, value } }
        );
      }
      extraParams[key] = value;
    }
  }

  return { take: normalizedTake, offset: normalizedOffset, extraParams };
}

/** Extracts the item list from the two shapes Qloo documents/tolerates. */
function extractRawResults(payload) {
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.results?.entities)) return payload.results.entities;
  return [];
}

/**
 * Validates and normalizes a search payload.
 * Throws `EntitySearchError` for non-object payloads or `success: false`;
 * a missing `results` list is tolerated as "no matches".
 */
function normalizeSearchPayload(payload, context) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new EntitySearchError('Qloo search response was not a JSON object', {
      code: 'MALFORMED_RESPONSE',
      details: { payload },
    });
  }
  if (payload.success === false) {
    throw new EntitySearchError('Qloo reported success=false for the search', {
      code: 'UPSTREAM_ERROR',
      details: { payload },
    });
  }

  const results = extractRawResults(payload)
    .map(normalizeEntity)
    .filter(Boolean);

  return {
    query: context.query,
    types: context.types,
    take: context.take,
    offset: context.offset,
    count: results.length,
    results,
  };
}

/**
 * Searches Qloo entities by free-text name, optionally scoped to a domain.
 *
 * @param {string} query            Free-text entity name (trimmed, <= 200 chars).
 * @param {string|string[]} [domain] Friendly name ("artist", "film"), an alias
 *                                  ("tv", "music"), a deprecated fold ("actor"),
 *                                  a raw `urn:entity:*` URN, or an array of
 *                                  these. Omit for an unscoped search.
 * @param {object} [options]
 * @param {number} [options.take=10]   Page size; clamped to 1..50.
 * @param {number} [options.offset=0]  Pagination offset; >= 0.
 * @param {object} [options.extra]      Extra scalar query params (exploration);
 *                                      may not shadow query/types/take/offset.
 * @returns {Promise<{query: string, types: string[], take: number,
 *                    offset: number, count: number,
 *                    results: Array<object>}>}
 * @throws {EntitySearchError} synchronously on invalid input (before any
 *         network call); rejects with `QlooApiError` on upstream failures.
 */
export function searchEntities(query, domain, options = {}) {
  // Validation is synchronous and happens BEFORE any I/O: a bad call can
  // never consume hackathon key quota or wait on the rate limiter.
  const normalizedQuery = validateQuery(query);
  const types = resolveDomain(domain);
  const { take, offset, extraParams } = validateOptions(options);

  const params = { query: normalizedQuery, take, offset, ...extraParams };
  if (types.length > 0) {
    params.types = types.join(','); // Qloo's documented comma-separated format
  }

  return qlooClient
    .get(SEARCH_PATH, params)
    .then((payload) =>
      normalizeSearchPayload(payload, {
        query: normalizedQuery,
        types,
        take,
        offset,
      })
    );
}

const entitySearchClient = {
  searchEntities,
  resolveDomain,
  normalizeEntity,
  DOMAINS,
  SEARCH_PATH,
};

export default entitySearchClient;

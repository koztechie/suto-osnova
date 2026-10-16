/**
 * Seed entity resolver (task 47) — resolves RAW TEXT QUERIES into a
 * VERIFIED Qloo `entity_id` + CATEGORY via the live Qloo API.
 *
 * This is the I/O counterpart of the SEED_RESOLUTION pipeline phase
 * (task 42) and the first bridge from the pure engine (tasks 41-46)
 * into real Qloo traffic. The flow:
 *
 *   1. INGEST: `resolveSeed` normalizes and validates the raw text
 *      (typed InvalidSeedError propagates BEFORE any network call);
 *   2. FORMAT: `classifySeedFormat` (task 46) picks the probe ladder —
 *      which substrings are worth sending to Qloo search:
 *        direct_title         -> stripped title, then the full text;
 *        person               -> the name as written;
 *        aesthetic_description-> quoted segments first ("Blade
 *                               Runner" inside a prompt), then comma
 *                               fragments. The raw description itself
 *                               is NEVER a probe — it would only burn
 *                               quota;
 *   3. SEARCH: each probe is searched with domain-scoped entity types
 *      (a domain hint -> searchTypesFor(hint); otherwise all five
 *      mandatory domains, deduped). Probes are tried in order until a
 *      candidate is selected (MAX_PROBE_ATTEMPTS caps quota burn);
 *   4. SELECTION: deterministic and verified — candidates must carry a
 *      VALID entity id (Qloo issues UUIDs; validated by
 *      ENTITY_ID_PATTERN), pass the optional popularity gate, and
 *      satisfy the exact/fuzzy name policy; the winner is preferred
 *      among entities CLASSIFIABLE into one of the five agent domains
 *      (category), ordered by popularity desc, then name, then id —
 *      repeated resolutions never flip;
 *   5. OUTPUT: a frozen record with entity {id, name, category,
 *      subtype, popularity}, match/ambiguity, alternatives, the probe
 *      trail (attempts) and the live|mock provenance stamp.
 *
 * FAILURE IS TYPED AND DIAGNOSED (SeedResolutionError):
 *   no_results        — Qloo returned nothing usable;
 *   no_valid_id       — candidates existed but NONE carried a valid
 *                       entity id (a gateway schema change must be
 *                       LOUD, not silently accepted);
 *   no_mapped_entity  — candidates existed but none classifies into
 *                       film|music|books|dining|fashion (e.g. a director
 *                       with no work entity among agent domains);
 *   upstream_error    — the Qloo call itself failed (cause preserved).
 *
 * CONTRACT NOTE on person-format anchors: the agent's category space
 * is EXACTLY the five mandatory domains (domainMapper), and Qloo person
 * entities classify to null there. A person IS resolvable when they own
 * cultural entities in those domains (Radiohead -> artist/music, Stephen
 * King -> book/books); a pure director with no in-domain work fails
 * typed as no_mapped_entity — callers can widen the search with
 * `extraTypes` (e.g. urn:entity:person) and `requireMapped: false`.
 *
 * The search function is INJECTABLE (`options.search`) so the whole
 * pipeline is testable deterministically with zero network; production
 * callers inherit the full transport stack (auth, rate limiting,
 * retries, caching, single-flight, privacy guard, MOCK_MODE fixtures)
 * from `entitySearchClient`/`qlooClient`.
 */

import { env } from '../config/env.js';
import { searchEntities } from './entitySearchClient.js';
import {
  classifyEntity,
  searchTypesFor,
  MANDATORY_DOMAINS,
} from './domainMapper.js';
import { resolveSeed } from '../engine/SeedResolver.js';
import { classifySeedFormat, SEED_FORMATS } from '../engine/SeedClassifier.js';

/** Typed error for resolution failures. */
export class SeedResolutionError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SeedResolutionError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const RESOLUTION_CODES = Object.freeze({
  NO_RESULTS: 'no_results',
  NO_VALID_ID: 'no_valid_id',
  NO_MAPPED_ENTITY: 'no_mapped_entity',
  UPSTREAM_ERROR: 'upstream_error',
});

/** Qloo issues UUID entity ids (live + fixtures, verified). */
export const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quota guard: how many probes one resolution may try. */
export const MAX_PROBE_ATTEMPTS = 3;

/** Canonical name comparison key (same rule as the MCP resolve tool). */
export function normalizeNameKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const ALL_AGENT_TYPES = [
  ...new Set(MANDATORY_DOMAINS.flatMap((d) => searchTypesFor(d))),
];

/**
 * Builds the ordered probe ladder for a classified anchor. Probes equal
 * to the normalized text are deduplicated; the raw aesthetic
 * description is deliberately never probed.
 */
export function extractProbes(classification, seed) {
  const probes = [];
  const push = (text, source) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (probes.some((p) => p.text === trimmed)) return;
    probes.push({ text: trimmed, source });
  };

  if (classification.format === SEED_FORMATS.DIRECT_TITLE) {
    push(classification.components.title, 'title');
    push(seed.normalized, 'normalized');
  } else if (classification.format === SEED_FORMATS.PERSON) {
    push(classification.components.name, 'name');
  } else {
    for (const quoted of classification.components.quoted) push(quoted, 'quoted');
    for (const fragment of classification.components.fragments) {
      // A fragment carrying quotes was already probed as `quoted`;
      // the unsplit description itself is never worth a probe.
      const isWholeDescription =
        normalizeNameKey(fragment) === normalizeNameKey(seed.normalized);
      if (isWholeDescription || /["\u201C\u201D\u00AB\u00BB]/.test(fragment)) {
        continue;
      }
      push(fragment, 'fragment');
    }
  }
  return probes;
}

/**
 * Deterministic candidate selection over ONE search page.
 *
 * Filter order: valid id -> popularity gate -> exact/fuzzy name policy
 * -> domain-mapped preference; final order: popularity desc, name, id.
 *
 * @returns {{best: object|null, alternatives: object[], match: string,
 *            ambiguous: boolean, diagnostics: {total: number,
 *            sawValidId: boolean, sawMapped: boolean}}}
 */
export function selectBestCandidate(results, options = {}) {
  const {
    queryKey,
    allowFuzzy = true,
    minPopularity,
    requireMapped = true,
    requireValidId = true,
  } = options;

  const list = Array.isArray(results) ? results : [];
  const validPool = requireValidId
    ? list.filter((e) => typeof e.id === 'string' && ENTITY_ID_PATTERN.test(e.id))
    : list;
  const popPool =
    minPopularity === undefined
      ? validPool
      : validPool.filter((e) => (e.popularity ?? 0) >= minPopularity);

  const exactPool = popPool.filter((e) => normalizeNameKey(e.name) === queryKey);
  const namePool =
    exactPool.length > 0 ? exactPool : allowFuzzy ? popPool : [];
  const mappedPool = requireMapped
    ? namePool.filter((e) => classifyEntity(e) !== null)
    : namePool;

  // Granular diagnostics: WHICH filter emptied the pool drives the
  // failure code (id vs popularity vs exact-only vs unmapped).
  const diagnostics = {
    total: list.length,
    sawValidId: !requireValidId || validPool.length > 0,
    sawPopularity: minPopularity === undefined || popPool.length > 0,
    sawName: namePool.length > 0,
    sawMapped: !requireMapped || namePool.some((e) => classifyEntity(e) !== null),
  };

  const byPrecedence = (a, b) =>
    (b.popularity ?? 0) - (a.popularity ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id);

  if (mappedPool.length === 0) {
    return {
      best: null,
      alternatives: [],
      match: 'none',
      ambiguous: false,
      diagnostics,
    };
  }

  const ordered = [...mappedPool].sort(byPrecedence);
  const best = ordered[0];
  const alternatives = popPool
    .filter((e) => e !== best)
    .sort(byPrecedence)
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      name: e.name,
      category: classifyEntity(e),
    }));

  return {
    best,
    alternatives,
    match: exactPool.length > 0 ? 'exact' : 'fuzzy',
    ambiguous: ordered.length > 1,
    diagnostics,
  };
}

function mergeDiagnostics(a, b) {
  return {
    total: a.total + b.total,
    sawValidId: a.sawValidId || b.sawValidId,
    sawPopularity: a.sawPopularity || b.sawPopularity,
    sawName: a.sawName || b.sawName,
    sawMapped: a.sawMapped || b.sawMapped,
  };
}

function failureFrom(diagnostics, seed, attempts) {
  if (diagnostics.total === 0) {
    return new SeedResolutionError(
      `no Qloo candidates for "${seed.normalized}" across ${attempts.length} probe(s)`,
      { code: RESOLUTION_CODES.NO_RESULTS, details: { attempts } }
    );
  }
  if (!diagnostics.sawValidId) {
    return new SeedResolutionError(
      `Qloo returned ${diagnostics.total} candidate(s) but none carried a ` +
        `valid entity id (expected UUID) — refusing to synthesize one`,
      { code: RESOLUTION_CODES.NO_VALID_ID, details: { attempts } }
    );
  }
  if (!diagnostics.sawPopularity || !diagnostics.sawName) {
    return new SeedResolutionError(
      `candidates for "${seed.normalized}" did not survive the selection ` +
        `filters (exact-only or min_popularity)`,
      { code: RESOLUTION_CODES.NO_RESULTS, details: { attempts } }
    );
  }
  if (!diagnostics.sawMapped) {
    return new SeedResolutionError(
      `Qloo returned candidates for "${seed.normalized}" but none ` +
        `classifies into the five agent domains (film, music, books, ` +
        `dining, fashion); widen with extraTypes/requireMapped if intended`,
      { code: RESOLUTION_CODES.NO_MAPPED_ENTITY, details: { attempts } }
    );
  }
  return new SeedResolutionError(
    `no candidate for "${seed.normalized}" survived selection`,
    { code: RESOLUTION_CODES.NO_RESULTS, details: { attempts } }
  );
}

/**
 * Resolves a raw text query into a verified Qloo entity + category.
 *
 * @param {string|object} rawText raw user text or an ingress object
 *        (validated via resolveSeed; its InvalidSeedError propagates).
 * @param {object} [options]
 * @param {string} [options.domain] domain hint (validated by resolveSeed).
 * @param {number} [options.minPopularity] drop candidates below this
 *        popularity percentile (0..1) before selection.
 * @param {boolean} [options.allowFuzzy=true] accept non-exact names.
 * @param {boolean} [options.requireMapped=true] require the winner to
 *        classify into one of the five agent domains.
 * @param {boolean} [options.requireValidId=true] require UUID entity ids.
 * @param {number} [options.take=10] search page size (clamped 1..50 by
 *        the search client).
 * @param {string[]} [options.extraTypes] extra raw `urn:entity:*` types
 *        appended to the domain-scoped search types.
 * @param {Function} [options.search] injectable search function
 *        (defaults to entitySearchClient.searchEntities) — the
 *        resolution pipeline is fully testable without network.
 * @returns {Promise<Readonly<object>>} frozen resolution record.
 * @throws {InvalidSeedError} on unusable input (before any I/O).
 * @throws {SeedResolutionError} code no_results | no_valid_id |
 *         no_mapped_entity | upstream_error.
 */
export async function resolveTextQuery(rawText, options = {}) {
  const {
    domain = undefined,
    minPopularity = undefined,
    allowFuzzy = true,
    requireMapped = true,
    requireValidId = true,
    take = 10,
    extraTypes = undefined,
    search = searchEntities,
  } = options;

  // Steps 1-2: pure engine work, no I/O — typed failures propagate.
  const seed = resolveSeed(rawText, domain !== undefined ? { domain } : undefined);
  const classification = classifySeedFormat(seed);
  const probes = extractProbes(classification, seed);

  const types = [
    ...new Set([
      ...(seed.domain !== null ? searchTypesFor(seed.domain) : ALL_AGENT_TYPES),
      ...(Array.isArray(extraTypes) ? extraTypes : []),
    ]),
  ];

  const attempts = [];
  let diagnostics = {
    total: 0,
    sawValidId: false,
    sawPopularity: false,
    sawName: false,
    sawMapped: false,
  };

  for (const probe of probes.slice(0, MAX_PROBE_ATTEMPTS)) {
    let page;
    try {
      page = await search(probe.text, types, { take });
    } catch (cause) {
      attempts.push({
        probe: probe.text,
        source: probe.source,
        error: cause?.message ?? String(cause),
      });
      throw new SeedResolutionError(
        `Qloo search failed while resolving probe "${probe.text}"`,
        { code: RESOLUTION_CODES.UPSTREAM_ERROR, details: { attempts }, cause }
      );
    }

    const results = Array.isArray(page?.results) ? page.results : [];
    const selection = selectBestCandidate(results, {
      // Exactness is judged against the CLEANEST probe (the de-quoted,
      // year-stripped title), not the raw anchor text.
      queryKey: normalizeNameKey(probe.text),
      allowFuzzy,
      minPopularity,
      requireMapped,
      requireValidId,
    });
    attempts.push({ probe: probe.text, source: probe.source, count: results.length });
    diagnostics = mergeDiagnostics(diagnostics, selection.diagnostics);

    if (selection.best !== null) {
      const best = selection.best;
      return Object.freeze({
        verified: true,
        mode: env.MOCK_MODE ? 'mock' : 'live',
        query: Object.freeze({
          raw: seed.raw,
          normalized: seed.normalized,
          key: seed.key,
        }),
        format: classification.format,
        confidence: classification.confidence,
        probe: Object.freeze({ text: probe.text, source: probe.source }),
        entity: Object.freeze({
          id: best.id,
          name: best.name,
          category: classifyEntity(best),
          subtype: best.subtype ?? null,
          popularity: best.popularity ?? null,
        }),
        idValid: ENTITY_ID_PATTERN.test(best.id),
        match: selection.match,
        ambiguous: selection.ambiguous,
        alternatives: Object.freeze(selection.alternatives.map((a) => Object.freeze(a))),
        attempts: Object.freeze(attempts.map((a) => Object.freeze({ ...a }))),
      });
    }
  }

  throw failureFrom(diagnostics, seed, attempts);
}

const seedEntityResolver = {
  resolveTextQuery,
  selectBestCandidate,
  extractProbes,
  normalizeNameKey,
  SeedResolutionError,
  RESOLUTION_CODES,
  ENTITY_ID_PATTERN,
  MAX_PROBE_ATTEMPTS,
};

export default seedEntityResolver;

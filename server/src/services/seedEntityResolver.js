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
 *      satisfy the exact/fuzzy name policy; the surviving pool is then
 *      RANKED by the statistical candidate ranker (task 48 — name
 *      similarity, Qloo graph affinity, popularity, tag overlap,
 *      domain fit; absent signals renormalized) so an ambiguous search
 *      picks the most statistically relevant entity with a full
 *      per-signal explanation (`relevance`), ordered deterministically;
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
import {
  classifySeedFormat,
  extractTasteWords,
  SEED_FORMATS,
} from '../engine/SeedClassifier.js';
import { rankCandidates, nameSimilarity } from './candidateRanker.js';

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
  // Task 193: candidates existed but NONE is a record Qloo accepts as an
  // affinity signal (upstream 400 on every probe) — an honest 400 content
  // answer, never a 500 all_domains_failed.
  NO_USABLE_SIGNAL: 'no_usable_signal',
});

/** Qloo issues UUID entity ids (live + fixtures, verified). */
export const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quota guard: how many probes one resolution may try. */
export const MAX_PROBE_ATTEMPTS = 3;
/** Cap on ALTERNATIVE signal probes per resolution (the best is probed too);
 *  covers the full list — selectBestCandidate caps alternatives at 6. */
export const MAX_SIGNAL_PROBES = 6;
/** A promoted alternative must score at least this FRACTION of the winner
 *  (task 193): a swap is a rescue of a comparably-ranked candidate (another
 *  edition of the same work), never a jump to a weaker match on a different
 *  topic — a 'festival' anchor must not swap to a mall food court. */
export const SWAP_SCORE_FLOOR = 0.9;

/** A fuzzy PLACE match against a name-based seed must clear this floor. */
export const MIN_FUZZY_SIMILARITY = 0.5;
const PLACE_URN = 'urn:entity:place';

/**
 * Canonical name comparison key (same rule as the MCP resolve tool).
 * RELIABILITY: non-string input yields the empty key instead of a raw
 * TypeError — upstream pages carry hostile shapes (missing/numeric
 * names) and a malformed candidate must degrade to "no name match",
 * never crash the resolution pipeline.
 */
export function normalizeNameKey(value) {
  if (typeof value !== 'string') return '';
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
      if (isWholeDescription) {
        // An UNQUOTED description is a single fragment; splitting it on
        // the spaced connectors "with"/"and" (and dash/list separators)
        // yields MEANINGFUL probe chunks ("neon noir", "melancholic
        // jazz") instead of ZERO probes (a spurious no_results). The
        // classifier's SCORING is deliberately untouched — this split
        // is for the probe ladder only. A connector-less description
        // still yields ONE probe (itself), never zero.
        const chunks = fragment
          .split(/\s+(?:with|and)\s+|[,;/|&\u2014\u2013]+/i)
          .map((t) => t.trim())
          .filter((t) => t.length >= 2);
        for (const chunk of chunks) push(chunk, 'fragment');
        continue;
      }
      if (/["\u201C\u201D\u00AB\u00BB]/.test(fragment)) {
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
 * -> domain-mapped preference; the surviving pool is then RANKED by
 * the statistical candidate ranker (task 48) — name similarity, Qloo
 * graph affinity, popularity, tag overlap, domain fit — instead of
 * bare popularity, so an ambiguous search picks the most statistically
 * relevant entity, explainably and reproducibly.
 *
 * @returns {{best: object|null, relevance: {score: number,
 *            signals: object}|null, alternatives: object[],
 *            match: string, ambiguous: boolean, diagnostics: {total:
 *            number, sawValidId: boolean, sawPopularity: boolean,
 *            sawName: boolean, sawMapped: boolean}}}
 */
export function selectBestCandidate(results, options = {}) {
  // RELIABILITY: same rule as resolveTextQuery — a non-object options
  // bag degrades to defaults instead of crashing the destructure.
  const safeOptions =
    options !== null && typeof options === 'object' && !Array.isArray(options)
      ? options
      : {};
  const {
    queryKey,
    allowFuzzy = true,
    minPopularity,
    requireMapped = true,
    requireValidId = true,
    queryWords = [],
    targetDomain = null,
    weights = undefined,
    floorPlaces = false,
  } = safeOptions;

  // RELIABILITY: upstream pages can carry null/primitive entries — a
  // hostile page must shrink the pool, never crash selection.
  const list = (Array.isArray(results) ? results : []).filter(
    (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  );
  const validPool = requireValidId
    ? list.filter((e) => typeof e.id === 'string' && ENTITY_ID_PATTERN.test(e.id))
    : list;
  const popPool =
    minPopularity === undefined
      ? validPool
      : validPool.filter((e) => (e.popularity ?? 0) >= minPopularity);

  // RELIABILITY: name matching requires a USABLE string name — a
  // candidate without one cannot be name-matched (it degrades to the
  // fuzzy pool under allowFuzzy, or out of selection entirely).
  const namedPool = popPool.filter((e) => typeof e.name === 'string');
  const exactPool = namedPool.filter((e) => normalizeNameKey(e.name) === queryKey);
  // VIA NEGATIVA on fuzzy PLACE matches (name-based seeds only): a PLACE
  // whose name only weakly shares a prefix with the query is the classic
  // false-positive — the anchor "Bong Joon-ho" (a director) was fuzzy-
  // matched to "Bong Sung ... Restaurant" (0.33 similarity: only "Bong"
  // of 3 tokens), producing a WRONG dossier. Exact matches (1.0) always
  // pass; a taste-based (aesthetic) seed is EXEMPT (floorPlaces=false)
  // because it resolves by taste, not name similarity.
  const fuzzyPool = namedPool.filter((e) => {
    if (!floorPlaces) return true;
    if (e.subtype !== PLACE_URN) return true;
    return nameSimilarity(queryKey, e.name) >= MIN_FUZZY_SIMILARITY;
  });
  const namePool =
    exactPool.length > 0 ? exactPool : allowFuzzy ? fuzzyPool : [];
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

  const context = { queryKey, queryWords, targetDomain };
  const byScoreThenDeterminism = rankCandidates(mappedPool, context, { weights });

  if (byScoreThenDeterminism.length === 0) {
    return {
      best: null,
      relevance: null,
      alternatives: [],
      match: 'none',
      ambiguous: false,
      diagnostics,
    };
  }

  const top = byScoreThenDeterminism[0];
  const best = top.candidate;
  // Alternatives rank the NAMEABLE pool (not popPool): the ranker's
  // determinism tie-break calls localeCompare on names, and a nameless
  // candidate must never reach it.
  const rankedPool = rankCandidates(namedPool, context, { weights });
  const alternatives = rankedPool
    .filter((entry) => entry.candidate !== best)
    .slice(0, 6)
    .map((entry) => ({
      id: entry.candidate.id,
      name: entry.candidate.name,
      category: classifyEntity(entry.candidate),
      score: entry.score,
      // Signal-fallback fields (task 193): an alternative can BECOME the
      // anchor when the best record is rejected as a Qloo signal, so it
      // carries everything a full entity needs.
      subtype: entry.candidate.subtype ?? null,
      popularity: entry.candidate.popularity ?? null,
    }));

  return {
    best,
    relevance: Object.freeze({ score: top.score, signals: top.signals }),
    alternatives,
    match: exactPool.length > 0 ? 'exact' : 'fuzzy',
    ambiguous: rankedPool.length > 1,
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
/**
 * Signal-usability probe (task 193): Qloo rejects certain entity RECORDS
 * as `signal.interests.entities` — upstream 400, even against their own
 * domain — which fails every target domain at once (500 all_domains_failed).
 * A probe that RESOLVES means the record is usable; an upstream 400 means
 * it is NOT (walk the alternatives); transport/5xx/timeout failures are a
 * property of the moment, NOT of the record, so they never demote a chosen
 * anchor (the affinity vector reports them honestly later).
 *
 * @param {Function} signalProbe `(ids, domain, {take}) => page` (affinityFn)
 * @param {object} candidate best entry or an enriched alternative
 * @returns {Promise<boolean>} false only on a definite upstream rejection
 */
async function isSignalUsable(signalProbe, candidate) {
  const id = typeof candidate?.id === 'string' ? candidate.id : null;
  const category =
    typeof candidate?.category === 'string' ? candidate.category : classifyEntity(candidate);
  // A record with no classifiable domain cannot be probed (and could not
  // drive the vector either) — treat it as unusable, not as valid.
  if (id === null || typeof category !== 'string' || category === '') return false;
  try {
    await signalProbe([id], category, { take: 1 });
    return true;
  } catch (err) {
    return err?.status !== 400;
  }
}

export async function resolveTextQuery(rawText, options = {}) {
  // RELIABILITY: options may arrive as null/array/garbage from callers
  // and MCP wrappers — anything non-object degrades to {} (defaults),
  // never a raw destructure TypeError.
  const safeOptions =
    options !== null && typeof options === 'object' && !Array.isArray(options)
      ? options
      : {};
  const {
    domain = undefined,
    minPopularity = undefined,
    allowFuzzy = true,
    requireMapped = true,
    requireValidId = true,
    take = 10,
    extraTypes = undefined,
    weights = undefined,
    search = searchEntities,
    // Task 193: OPTIONAL signal-usability probe — `(ids, domain, {take})`
    // (the affinityFn contract). Absent = today's behavior, zero probes.
    signalProbe = undefined,
  } = safeOptions;

  // Steps 1-2: pure engine work, no I/O — typed failures propagate.
  const seed = resolveSeed(rawText, domain !== undefined ? { domain } : undefined);
  const classification = classifySeedFormat(seed);
  const probes = extractProbes(classification, seed);
  // Query side of the ranker's tag-overlap signal (task 48).
  const tasteWords = extractTasteWords(seed.normalized);

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
      queryWords: tasteWords,
      targetDomain: seed.domain,
      // A name-based seed floors weak PLACE matches; an aesthetic (taste)
      // seed is exempt (it resolves by taste, not name similarity).
      floorPlaces: classification.format !== SEED_FORMATS.AESTHETIC_DESCRIPTION,
      weights,
    });
    attempts.push({ probe: probe.text, source: probe.source, count: results.length });
    diagnostics = mergeDiagnostics(diagnostics, selection.diagnostics);

    if (selection.best !== null) {
      let best = selection.best;
      let alternatives = selection.alternatives;
      // SIGNAL USABILITY (task 193): Qloo rejects certain entity RECORDS
      // as `signal.interests.entities` (upstream 400, even their own
      // domain) — which failed EVERY target domain at once -> 500
      // all_domains_failed (the hosting stability probe's finding). Verify
      // the chosen record with the injected probe; when it is rejected,
      // walk the ranked alternatives (bounded) for a record the graph DOES
      // accept, so the dossier runs on a usable anchor. Nothing usable
      // fails typed (400 no_usable_signal) — never an opaque 500. Absent a
      // probe the path is byte-for-byte today's behavior.
      if (typeof signalProbe === 'function') {
        const topScore = selection.relevance?.score;
        const eligible =
          typeof topScore === 'number'
            ? selection.alternatives.filter(
                (entry) =>
                  typeof entry.score === 'number' &&
                  entry.score >= topScore * SWAP_SCORE_FLOOR,
              )
            : selection.alternatives;
        const chain = [selection.best, ...eligible.slice(0, MAX_SIGNAL_PROBES)];
        let usable = null;
        for (const candidate of chain) {
          if (await isSignalUsable(signalProbe, candidate)) {
            usable = candidate;
            break;
          }
        }
        if (usable === null) {
          throw new SeedResolutionError(
            `no candidate for "${seed.normalized}" is usable as a Qloo affinity signal`,
            { code: RESOLUTION_CODES.NO_USABLE_SIGNAL, details: { attempts } },
          );
        }
        if (usable !== selection.best) {
          best = usable;
          alternatives = alternatives.filter((entry) => entry.id !== usable.id);
        }
      }
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
        // Task 48: the statistical explanation of WHY this candidate won.
        relevance: selection.relevance,
        idValid: ENTITY_ID_PATTERN.test(best.id),
        match: selection.match,
        ambiguous: selection.ambiguous,
        alternatives: Object.freeze(alternatives.map((a) => Object.freeze(a))),
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

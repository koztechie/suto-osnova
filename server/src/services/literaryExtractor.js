/**
 * Literary extractor (task 52) — the LITERARY LAYER of the dossier:
 * from the initial (resolved) cultural anchor it identifies
 *
 *   1. AUTHORS           — `urn:entity:person` entities whose taste
 *                          profile Qloo correlates with the anchor
 *                          (cross-domain affinity, insights endpoint);
 *   2. ESSAYISTS         — the AUTHORS whose tag profile carries essay
 *                          markers (essay/essays/essayist/nonfiction …)
 *                          — a deterministic classification, not a
 *                          second upstream guess;
 *   3. PHILOSOPHICAL TEXTS — `urn:entity:book` entities with philosophy
 *                          markers on their tags, ranked
 *                          philosophical-first.
 *
 * CORRELATION CONTRACT (the defining rule of this module): every kept
 * entity must carry a correlation (the cross-domain affinity score —
 * Qloo's statistical correlation between the anchor's taste profile
 * and the entity) STRICTLY ABOVE 0.65 (MIN_CORRELATION, overridable).
 * Below-threshold entities are DROPPED and counted, never silently
 * shipped. Entities with NO correlation at all cannot prove 0.65:
 * they are dropped by default (`requireCorrelation: true`) and kept,
 * flagged `unverified`, only when the caller opts out.
 *
 * Endpoint reality (live-verified, tasks 20-23): `urn:entity:person`
 * and `urn:entity:book` are both valid insights `filter.type` targets
 * (raw-URN pass-through in crossDomainClient), so both legs ride the
 * affinity endpoint in parallel.
 *
 * Failure model mirrors task 51: a failing leg never aborts its
 * sibling ({leg, code, message} + coverage flags); both legs failing
 * -> typed all_legs_failed (this diagnosis WINS even under
 * `strict: true` — an outage is not a partial answer); one leg failing
 * under `strict: true` -> partial_failure. All I/O
 * is injectable (`affinityFn`) — fully testable with zero network;
 * pure parts (marker matching, ranking, correlation filtering) are
 * exported and deterministic (no clocks/RNG).
 */

import { getCrossDomainAffinities } from './crossDomainClient.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Typed error for literary-extraction failures. */
export class LiteraryExtractionError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'LiteraryExtractionError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const LITERARY_CODES = Object.freeze({
  NO_ANCHOR: 'no_anchor',
  ALL_LEGS_FAILED: 'all_legs_failed',
  PARTIAL_FAILURE: 'partial_failure',
  INVALID_THRESHOLD: 'invalid_threshold',
});

/**
 * The correlation threshold (task contract): kept entities must score
 * STRICTLY ABOVE this value.
 */
export const MIN_CORRELATION = 0.65;

/** Documented algorithm defaults. */
export const LITERARY_DEFAULTS = Object.freeze({
  authorLimit: 5,
  textLimit: 6,
  take: 10,
  minimumCorrelation: MIN_CORRELATION,
  requireCorrelation: true,
});

/** The two upstream legs. */
export const LITERARY_LEGS = Object.freeze(['authors', 'texts']);

const PERSON_URN = 'urn:entity:person';
const BOOK_URN = 'urn:entity:book';

/** Essayist detection markers (exported tuning contract). */
export const ESSAY_MARKERS = Object.freeze([
  'essay',
  'essays',
  'essayist',
  'nonfiction',
  'non-fiction',
  'criticism',
  'prose',
  'columnist',
]);

/** Philosophical-text detection markers (exported tuning contract). */
export const PHILOSOPHY_MARKERS = Object.freeze([
  'philosophy',
  'philosophical',
  'philosopher',
  'ethics',
  'existential',
  'metaphysics',
  'phenomenology',
  'stoicism',
  'political-theory',
  'theory',
]);

const normalizeHaystack = (value) =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

/**
 * Markers matched by an entity's tag profile (name + id of every tag,
 * normalized; substring matching). Returns the matched markers.
 */
export function matchEntityMarkers(entity, markers) {
  if (!entity || typeof entity !== 'object') return [];
  const haystack = normalizeHaystack(
    (Array.isArray(entity.tags) ? entity.tags : [])
      .map((t) => `${t?.name ?? ''} ${t?.id ?? ''}`)
      .join(' ')
  );
  return markers.filter((marker) => haystack.includes(marker));
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Applies the correlation contract to raw rows.
 *
 * @returns {{kept: object[], droppedBelow: number, droppedUnverified: number}}
 *          `droppedBelow` — numeric correlation <= threshold;
 *          `droppedUnverified` — no correlation at all (dropped only
 *          when requireCorrelation is true).
 */
export function applyCorrelation(rows, { minimumCorrelation, requireCorrelation }) {
  const kept = [];
  let droppedBelow = 0;
  let droppedUnverified = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.name !== 'string') {
      continue;
    }
    const correlation = finiteNumber(row.affinity);
    if (correlation === null) {
      if (requireCorrelation) droppedUnverified += 1;
      else kept.push({ ...row, correlation: null, unverified: true });
      continue;
    }
    if (correlation <= minimumCorrelation) {
      droppedBelow += 1;
      continue;
    }
    kept.push({ ...row, correlation, unverified: false });
  }

  return { kept, droppedBelow, droppedUnverified };
}

const byCorrelation = (a, b) =>
  (b.correlation ?? -1) - (a.correlation ?? -1) ||
  (b.popularity ?? -1) - (a.popularity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

function pageRows(page) {
  if (Array.isArray(page)) return page;
  if (page && typeof page === 'object' && Array.isArray(page.results)) return page.results;
  return [];
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

/**
 * Extracts the literary profile of an anchor.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the RESOLVED seed (task 47 shape).
 * @param {object} [options] authorLimit/textLimit/take,
 *        minimumCorrelation (0..1, strictly-above semantics),
 *        requireCorrelation (keep-or-drop unverified rows), strict,
 *        injectable affinityFn.
 * @returns {Readonly<object>} frozen record {anchor, authors,
 *          essayists, texts, coverage, failures}.
 * @throws {LiteraryExtractionError} no_anchor | invalid_threshold |
 *         all_legs_failed | partial_failure (strict).
 */
export async function extractLiteraryProfile(anchor, options = {}) {
  const {
    authorLimit = LITERARY_DEFAULTS.authorLimit,
    textLimit = LITERARY_DEFAULTS.textLimit,
    take = LITERARY_DEFAULTS.take,
    minimumCorrelation = LITERARY_DEFAULTS.minimumCorrelation,
    requireCorrelation = LITERARY_DEFAULTS.requireCorrelation,
    strict = false,
    affinityFn = defaultAffinity,
  } = options;

  if (
    !anchor ||
    typeof anchor !== 'object' ||
    typeof anchor.id !== 'string' ||
    anchor.id.length === 0
  ) {
    throw new LiteraryExtractionError(
      'extractLiteraryProfile: anchor must carry a non-empty string id ' +
        '(resolve the seed first)',
      { code: LITERARY_CODES.NO_ANCHOR, details: { anchor } }
    );
  }
  if (
    typeof minimumCorrelation !== 'number' ||
    !Number.isFinite(minimumCorrelation) ||
    minimumCorrelation < 0 ||
    minimumCorrelation > 1
  ) {
    throw new LiteraryExtractionError(
      'extractLiteraryProfile: minimumCorrelation must be a number in [0, 1]',
      { code: LITERARY_CODES.INVALID_THRESHOLD, details: { minimumCorrelation } }
    );
  }

  const anchorName =
    typeof anchor.name === 'string' && anchor.name.trim().length > 0
      ? anchor.name.trim()
      : null;

  // Both legs ride the affinity endpoint in parallel, isolated.
  const [authorsOutcome, textsOutcome] = await Promise.allSettled([
    affinityFn([anchor.id], PERSON_URN, { take }),
    affinityFn([anchor.id], BOOK_URN, { take }),
  ]);

  const failures = [];
  const resolveLeg = (outcome, leg) => {
    if (outcome.status === 'fulfilled') return pageRows(outcome.value);
    failures.push(Object.freeze({ leg, ...describeError(outcome.reason) }));
    return null;
  };
  const authorRows = resolveLeg(authorsOutcome, 'authors');
  const textRows = resolveLeg(textsOutcome, 'texts');

  // Correlation contract applied per leg.
  const authorPool = authorRows === null ? null : applyCorrelation(authorRows, { minimumCorrelation, requireCorrelation });
  const textPool = textRows === null ? null : applyCorrelation(textRows, { minimumCorrelation, requireCorrelation });

  // Authors: correlation desc, essayist classification by markers.
  const authors =
    authorPool === null
      ? []
      : authorPool.kept
          .sort(byCorrelation)
          .slice(0, authorLimit)
          .map((row, index) => {
            const markers = matchEntityMarkers(row, ESSAY_MARKERS);
            return Object.freeze({
              id: row.id,
              name: row.name,
              subtype: row.subtype ?? null,
              correlation: row.correlation,
              unverified: row.unverified,
              popularity: finiteNumber(row.popularity),
              rank: index + 1,
              essayist: markers.length > 0,
              markers: Object.freeze(markers),
            });
          });

  const essayists = Object.freeze(
    authors
      .filter((a) => a.essayist)
      .map((a) => Object.freeze({ id: a.id, name: a.name, correlation: a.correlation, rank: a.rank }))
  );

  // Texts: philosophical-first, then correlation.
  const texts =
    textPool === null
      ? []
      : textPool.kept
          .map((row) => {
            const markers = matchEntityMarkers(row, PHILOSOPHY_MARKERS);
            return { ...row, markers, philosophical: markers.length > 0 };
          })
          .sort(
            (a, b) =>
              Number(b.philosophical) - Number(a.philosophical) ||
              b.markers.length - a.markers.length ||
              byCorrelation(a, b)
          )
          .slice(0, textLimit)
          .map((row, index) =>
            Object.freeze({
              id: row.id,
              name: row.name,
              subtype: row.subtype ?? null,
              correlation: row.correlation,
              unverified: row.unverified,
              popularity: finiteNumber(row.popularity),
              rank: index + 1,
              philosophical: row.philosophical,
              markers: Object.freeze(row.markers),
            })
          );

  const failedLegs = new Set(failures.map((f) => f.leg));
  if (failedLegs.size === LITERARY_LEGS.length) {
    throw new LiteraryExtractionError(
      'every literary-extraction leg failed — upstream outage',
      { code: LITERARY_CODES.ALL_LEGS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new LiteraryExtractionError(
      `strict mode: ${failures.length} leg(s) failed — ${failures
        .map((f) => f.leg)
        .join(', ')}`,
      { code: LITERARY_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  return deepFreeze({
    anchor: { id: anchor.id, name: anchorName, domain: anchor.domain ?? anchor.category ?? null },
    authors: Object.freeze(authors),
    essayists,
    texts: Object.freeze(texts),
    coverage: {
      authors: authors.length > 0,
      essayists: essayists.length > 0,
      texts: texts.length > 0,
      minimumCorrelation,
      droppedBelowCorrelation:
        (authorPool?.droppedBelow ?? 0) + (textPool?.droppedBelow ?? 0),
      droppedUnverified:
        (authorPool?.droppedUnverified ?? 0) + (textPool?.droppedUnverified ?? 0),
    },
    failures: Object.freeze(failures),
  });
}

const literaryExtractor = {
  extractLiteraryProfile,
  matchEntityMarkers,
  applyCorrelation,
  LiteraryExtractionError,
  LITERARY_CODES,
  LITERARY_DEFAULTS,
  LITERARY_LEGS,
  MIN_CORRELATION,
  ESSAY_MARKERS,
  PHILOSOPHY_MARKERS,
};

export default literaryExtractor;

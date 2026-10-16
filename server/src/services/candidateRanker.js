/**
 * Candidate ranker (task 48) — statistical ranking of AMBIGUOUS search
 * candidates: which entity is the most statistically relevant one "from
 * the graph".
 *
 * Task 47 resolves a raw anchor into a verified entity; when several
 * candidates survive the eligibility filters (a common reality: "Heat",
 * "The Thing", "Her" — short titles collide, bands share names with
 * albums, Qloo returns fuzzy neighbors), bare popularity is a poor
 * judge. This module replaces popularity-only ordering with a
 * transparent weighted score over FIVE signals:
 *
 *   nameSimilarity  (always present)  — hybrid of normalized
 *       Levenshtein similarity and query-token containment, so
 *       "Blade Runnr" ranks its "Blade Runner" neighbor at ~0.92 and
 *       partial token hits still count;
 *   popularity      (when Qloo sent it) — the 0..1 percentile; NOTE:
 *       the gateway DROPS popularity zeroes (live-verified), so a
 *       MISSING popularity is treated as ABSENT, never as 0;
 *   graphAffinity   (when Qloo sent it) — the search-relevance
 *       affinity Qloo attaches under `query.affinity`: the graph's own
 *       statistical opinion of the match;
 *   tagOverlap      (when the query carries taste words AND the
 *       candidate carries tags) — the fraction of the query's
 *       descriptive adjectives ("moody", "cozy" …) appearing in the
 *       candidate's Qloo tag names;
 *   domainFit       (when a domain hint exists) — 1 when the candidate
 *       classifies into the hinted domain, else 0.
 *
 * ABSENT-SIGNAL RENORMALIZATION (anti-fragile core): the score is
 * `sum(weight_i * signal_i) / sum(weight_i)` over PRESENT signals
 * only. A candidate with fewer data points is not penalized; a candidate
 * with a zero-valued popularity (impossible from the gateway, possible
 * from stubs/tests) is scored on its 0, while a MISSING one simply
 * drops out of the denominator.
 *
 * Determinism: pure math, no clocks/RNG; ties break by popularity desc,
 * then name, then id — repeated rankings never flip. Every score ships
 * with its per-signal breakdown, so the choice is explainable, and the
 * weights table is an exported, validated contract.
 */

import { classifyEntity } from './domainMapper.js';

/** Signal names produced by the ranker. */
export const RANK_SIGNALS = Object.freeze({
  NAME: 'nameSimilarity',
  POPULARITY: 'popularity',
  GRAPH_AFFINITY: 'graphAffinity',
  TAGS: 'tagOverlap',
  DOMAIN: 'domainFit',
});

/**
 * Default signal weights (sum not normalized to 1 by design — scores
 * are renormalized over present signals). Tuned for the ambiguity
 * profile of cultural anchors: the graph's own opinion (affinity) and
 * the name are the strongest evidence, raw popularity is a tiebreaker.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  nameSimilarity: 0.35,
  graphAffinity: 0.3,
  popularity: 0.2,
  domainFit: 0.25,
  tagOverlap: 0.1,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function validateWeights(weights) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new TypeError('rankCandidates: weights must be a plain object');
  }
  for (const [key, value] of Object.entries(weights)) {
    if (!(key in DEFAULT_WEIGHTS)) {
      throw new TypeError(
        `rankCandidates: unknown weight "${key}" — declared signals: ` +
          Object.keys(DEFAULT_WEIGHTS).join(', ')
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new TypeError(
        `rankCandidates: weight "${key}" must be a finite number > 0, got ${value}`
      );
    }
  }
  return weights;
}

/**
 * Partial overrides are MERGED over the defaults — a subset table can
 * never leave a present signal without a weight (that would silently
 * poison the mean with NaN).
 */
function mergedWeights(weights) {
  return { ...DEFAULT_WEIGHTS, ...validateWeights(weights) };
}

/** Two-row Levenshtein distance (candidates are short strings). */
function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Hybrid name similarity in [0, 1]: the better of character-level
 * Levenshtein similarity and query-token containment.
 */
export function nameSimilarity(queryKey, candidateName) {
  if (typeof queryKey !== 'string' || typeof candidateName !== 'string') return 0;
  const q = queryKey.trim().toLowerCase();
  const c = candidateName.trim().toLowerCase();
  if (q.length === 0 || c.length === 0) return 0;
  if (q === c) return 1;

  const levSim = 1 - editDistance(q, c) / Math.max(q.length, c.length);

  const tokenize = (s) =>
    new Set(s.split(/[\s,.;:'’!?/\\|&-]+/).filter((t) => t.length > 0));
  const qTokens = tokenize(q);
  const cTokens = tokenize(c);
  let hits = 0;
  for (const token of qTokens) {
    if (cTokens.has(token)) hits += 1;
  }
  const tokenFraction = qTokens.size > 0 ? hits / qTokens.size : 0;

  return Math.max(levSim, tokenFraction);
}

/**
 * Fraction of the query's taste words appearing in the candidate's tag
 * names (case-insensitive containment). Returns null when either side
 * has no data — the signal is then renormalized out, never zeroed.
 */
export function tagOverlap(queryWords, tags) {
  if (!Array.isArray(queryWords) || queryWords.length === 0) return null;
  const words = [
    ...new Set(
      queryWords
        .map((w) => (typeof w === 'string' ? w.toLowerCase().trim() : ''))
        .filter(Boolean)
    ),
  ];
  if (words.length === 0) return null;

  const names = (Array.isArray(tags) ? tags : [])
    .map((t) => (typeof t === 'string' ? t : t?.name))
    .filter((n) => typeof n === 'string')
    .map((n) => n.toLowerCase());
  if (names.length === 0) return null;

  let hits = 0;
  for (const word of words) {
    if (names.some((n) => n.includes(word))) hits += 1;
  }
  return hits / words.length;
}

/**
 * Scores ONE candidate. Returns {score, signals} where `signals` holds
 * every PRESENT signal value (the explanation); absent signals are
 * omitted and the weighted mean renormalizes over the rest.
 *
 * @param {object} candidate normalized search entity (id, name,
 *        subtype/tags/popularity/affinity when Qloo sent them).
 * @param {{queryKey: string, queryWords?: string[],
 *          targetDomain?: string|null}} context
 * @param {object} [weights] override of DEFAULT_WEIGHTS (validated).
 */
export function scoreCandidate(candidate, context, weights = DEFAULT_WEIGHTS) {
  const w = mergedWeights(weights);
  const entity = candidate && typeof candidate === 'object' ? candidate : {};

  const present = [];
  const add = (signal, value) => present.push([signal, value]);

  add(RANK_SIGNALS.NAME, nameSimilarity(context.queryKey, entity.name));
  if (typeof entity.popularity === 'number' && Number.isFinite(entity.popularity)) {
    add(RANK_SIGNALS.POPULARITY, clamp01(entity.popularity));
  }
  if (typeof entity.affinity === 'number' && Number.isFinite(entity.affinity)) {
    add(RANK_SIGNALS.GRAPH_AFFINITY, clamp01(entity.affinity));
  }
  const overlap = tagOverlap(context.queryWords, entity.tags);
  if (overlap !== null) add(RANK_SIGNALS.TAGS, overlap);
  if (context.targetDomain) {
    add(RANK_SIGNALS.DOMAIN, classifyEntity(entity) === context.targetDomain ? 1 : 0);
  }

  let numerator = 0;
  let denominator = 0;
  const signals = {};
  for (const [signal, value] of present) {
    numerator += w[signal] * value;
    denominator += w[signal];
    signals[signal] = value;
  }

  return {
    score: denominator > 0 ? numerator / denominator : 0,
    signals: Object.freeze(signals),
  };
}

const byPrecedence = (a, b) =>
  b.score - a.score ||
  (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0) ||
  a.candidate.name.localeCompare(b.candidate.name) ||
  a.candidate.id.localeCompare(b.candidate.id);

/**
 * Ranks a candidate list by the weighted statistical score.
 *
 * @returns {ReadonlyArray<Readonly<{candidate, rank, score, signals}>>}
 *          sorted best-first; rank is 1-based; empty input -> [].
 * @throws {TypeError} on invalid weights (unknown signal, non-positive).
 */
export function rankCandidates(candidates, context, options = {}) {
  const weights = mergedWeights(options.weights ?? DEFAULT_WEIGHTS);
  const list = Array.isArray(candidates) ? candidates : [];

  const scored = list.map((candidate) => {
    const { score, signals } = scoreCandidate(candidate, context, weights);
    return { candidate, score, signals };
  });

  scored.sort(byPrecedence);

  return Object.freeze(
    scored.map((entry, index) =>
      Object.freeze({
        candidate: entry.candidate,
        rank: index + 1,
        score: entry.score,
        signals: entry.signals,
      })
    )
  );
}

const candidateRanker = {
  rankCandidates,
  scoreCandidate,
  nameSimilarity,
  tagOverlap,
  RANK_SIGNALS,
  DEFAULT_WEIGHTS,
};

export default candidateRanker;

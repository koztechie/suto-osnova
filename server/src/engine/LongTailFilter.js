/**
 * LongTailFilter (task 56) — the mathematical pop-culture NOISE CUT
 * for candidate lists, built on the Via Negativa principle (Taleb):
 * the profile improves by SUBTRACTING what is provably harmful, never
 * by inflating what survives. Survivors keep their original scores —
 * the filter only removes and explains.
 *
 * WHY: Qloo results are popularity-weighted; every anchor drags the
 * same mainstream mega-hits (the entities/tags that correlate with
 * EVERYTHING). A dossier built from raw ranks reads generic. The
 * statistical signature of noise is not low relevance — it is
 * relevance FULLY EXPLAINED BY FAME. Three pure rules detect it:
 *
 *   R3 negative_excess    excessAffinity = affinity - popularity
 *                         <= excessAffinityFloor (-0.2): the entity is
 *                         notably LESS relevant than its fame predicts;
 *   R1 mainstream_no_excess popularity >= mainstreamCeiling (0.9) AND
 *                         excessAffinity < mainstreamExcessAllowance
 *                         (0.05): a mega-hit may only occupy the
 *                         profile when it OVER-PERFORMs its fame — a
 *                         famous entity whose correlation merely
 *                         matches its popularity is generic;
 *   R2 generic_weight     weight (carrier share) >= genericWeightFloor
 *                         (0.8) in a pool of >= minPoolForWeightRule
 *                         candidates: a tag carried by nearly everyone
 *                         is a generic descriptor ("Drama", "Based On A
 *                         Book"), not a taste signal. The pool guard
 *                         keeps small-sample arithmetic from being
 *                         mistaken for evidence.
 *
 * HONEST DATA HANDLING: rules only fire on PROVEN numbers. A missing
 * affinity or popularity makes excessAffinity undefined, so the excess
 * rules stay silent (absence of evidence is not evidence of noise) —
 * only the weight rule, which needs no affinity, may still remove.
 * `keepFallback` (default true) retains the top-`keepFallbackCount`
 * candidates by relevance when everything else was cut, each flagged
 * `fallback: true` — an empty dossier section is worse than a few
 * honestly flagged survivors (count defaults to 1 for the classic
 * single-best contract; callers pass `topN` for a full dossier); set
 * keepFallback false for the purist empty answer.
 *
 * The filter is ORDER-PRESERVING (ranking stays the caller's job),
 * pure (no I/O, clocks, RNG), deterministic, and every removal lands
 * in a ledger with the matched rules and the metrics that triggered
 * them — subtraction you can audit.
 */

/** Documented algorithm defaults (exported tuning contract). */
export const LONG_TAIL_DEFAULTS = Object.freeze({
  mainstreamCeiling: 0.9,
  mainstreamExcessAllowance: 0.05,
  excessAffinityFloor: -0.2,
  genericWeightFloor: 0.8,
  minPoolForWeightRule: 3,
  keepFallback: true,
  // When EVERYTHING is cut (Qloo is mainstream-biased, so this happens
  // on live data), the fallback keeps the top-N by relevance instead of
  // a single survivor — an empty dossier is worse than a few honestly
  // flagged mainstream entries. Default 1 preserves the classic contract;
  // callers that want a full dossier pass `topN`.
  keepFallbackCount: 1,
});

/** Machine-readable removal reasons (precedence order). */
export const CUT_REASONS = Object.freeze({
  NEGATIVE_EXCESS: 'negative_excess',
  MAINSTREAM_NO_EXCESS: 'mainstream_no_excess',
  GENERIC_WEIGHT: 'generic_weight',
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Reads a candidate's relevance score: `affinity` (tasks 51/53-55) or
 * `correlation` (task 52). Returns null when neither is a finite
 * number.
 */
export function relevanceOf(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  return finiteNumber(candidate.affinity) ?? finiteNumber(candidate.correlation);
}

/**
 * excessAffinity = relevance - popularity, ROUNDED to 12 decimals:
 * binary float tails (0.9-0.3 = 0.6000000000000001) would otherwise
 * make threshold boundaries non-deterministic across callers.
 * Returns null when either side is missing — the excess rules then
 * stay silent by contract.
 */
export function excessAffinity(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const relevance = relevanceOf(candidate);
  const popularity = finiteNumber(candidate.popularity);
  if (relevance === null || popularity === null) return null;
  return Math.round((relevance - popularity) * 1e12) / 1e12;
}

const validateOptions = (options) => {
  const inRange = (value, min, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

  if (!inRange(options.mainstreamCeiling, 0, 1)) {
    throw new TypeError('filterLongTail: mainstreamCeiling must be a number in [0, 1]');
  }
  if (!inRange(options.mainstreamExcessAllowance, 0, 1)) {
    throw new TypeError('filterLongTail: mainstreamExcessAllowance must be a number in [0, 1]');
  }
  if (!inRange(options.excessAffinityFloor, -1, 1)) {
    throw new TypeError('filterLongTail: excessAffinityFloor must be a number in [-1, 1]');
  }
  if (!inRange(options.genericWeightFloor, 0, 1)) {
    throw new TypeError('filterLongTail: genericWeightFloor must be a number in [0, 1]');
  }
  if (!Number.isInteger(options.minPoolForWeightRule) || options.minPoolForWeightRule < 1) {
    throw new TypeError('filterLongTail: minPoolForWeightRule must be an integer >= 1');
  }
  if (typeof options.keepFallback !== 'boolean') {
    throw new TypeError('filterLongTail: keepFallback must be a boolean');
  }
  if (!Number.isInteger(options.keepFallbackCount) || options.keepFallbackCount < 1) {
    throw new TypeError('filterLongTail: keepFallbackCount must be an integer >= 1');
  }
};

/**
 * The matched cut rules for ONE candidate (pure; exported for unit
 * tests and callers that want to explain without filtering).
 *
 * @returns {string[]} reasons in precedence order; [] = survivor.
 */
export function explainCut(candidate, options, poolSize) {
  const {
    mainstreamCeiling,
    mainstreamExcessAllowance,
    excessAffinityFloor,
    genericWeightFloor,
    minPoolForWeightRule,
  } = options;

  const reasons = [];
  const excess = excessAffinity(candidate);
  const popularity = finiteNumber(candidate?.popularity);
  const weight = finiteNumber(candidate?.weight);

  // R3: relevance notably BELOW what fame predicts.
  if (excess !== null && excess <= excessAffinityFloor) {
    reasons.push(CUT_REASONS.NEGATIVE_EXCESS);
  }
  // R1: a mega-hit must OVER-PERFORM its fame to keep its place.
  if (
    popularity !== null &&
    popularity >= mainstreamCeiling &&
    excess !== null &&
    excess < mainstreamExcessAllowance
  ) {
    reasons.push(CUT_REASONS.MAINSTREAM_NO_EXCESS);
  }
  // R2: a tag carried by nearly the whole pool is a generic word.
  if (
    weight !== null &&
    weight >= genericWeightFloor &&
    poolSize >= minPoolForWeightRule
  ) {
    reasons.push(CUT_REASONS.GENERIC_WEIGHT);
  }

  return reasons;
}

const byRelevanceThenInput = (a, b) =>
  ((relevanceOf(b.relevant) ?? -1) - (relevanceOf(a.relevant) ?? -1)) ||
  a.index - b.index;

/**
 * Cuts pop-culture noise from a candidate list (Via Negativa).
 *
 * @param {object[]} candidates extractor entries: `affinity`|`correlation`,
 *        `popularity`, optional `weight` (tag carrier share). Order is
 *        preserved; nothing is re-sorted.
 * @param {object} [options] see LONG_TAIL_DEFAULTS (validated; bad
 *        values throw TypeError — a programming error, not data).
 * @returns {Readonly<{kept, removed, stats}>} frozen record:
 *          - kept    — surviving entries (order-preserving copies)
 *                      each carrying `longTail: {excessAffinity, fallback?}`;
 *          - removed — the audit ledger: {id, name, reason, reasons,
 *                      metrics: {affinity, popularity, excess, weight}};
 *          - stats   — {input, kept, removed, keptShare, fellBack}.
 */
export function filterLongTail(candidates, options = {}) {
  const resolved = { ...LONG_TAIL_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(candidates) ? candidates.filter((c) => c && typeof c === 'object') : [];

  const kept = [];
  const removedPairs = []; // {index, record} — index-addressed, never searched
  let fellBack = false;

  list.forEach((candidate, index) => {
    const reasons = explainCut(candidate, resolved, list.length);
    const excess = excessAffinity(candidate);
    const metrics = Object.freeze({
      affinity: relevanceOf(candidate),
      popularity: finiteNumber(candidate.popularity),
      excess,
      weight: finiteNumber(candidate.weight),
    });

    if (reasons.length === 0) {
      kept.push(
        Object.freeze({
          ...candidate,
          longTail: Object.freeze({ excessAffinity: excess }),
        })
      );
      return;
    }

    removedPairs.push({
      index,
      record: Object.freeze({
        id: candidate.id ?? null,
        name: candidate.name ?? null,
        reason: reasons[0],
        reasons: Object.freeze(reasons),
        metrics,
      }),
    });
  });

  // Via Negativa with one safety valve: when EVERYTHING was cut, keep
  // the top-N by relevance (honestly flagged), not a single survivor —
  // an empty dossier is worse than a few flagged mainstream entries.
  if (kept.length === 0 && removedPairs.length > 0 && resolved.keepFallback) {
    const count = Math.min(resolved.keepFallbackCount, list.length);
    // Best-N by relevance (affinity/correlation desc), ties by input order.
    const best = list
      .map((candidate, index) => ({ candidate, index }))
      .sort(
        (a, b) =>
          (relevanceOf(b.candidate) ?? -1) - (relevanceOf(a.candidate) ?? -1) ||
          a.index - b.index
      )
      .slice(0, count);
    for (const { candidate, index } of best) {
      kept.push(
        Object.freeze({
          ...candidate,
          longTail: Object.freeze({ excessAffinity: excessAffinity(candidate), fallback: true }),
        })
      );
    }
    const keptIndices = new Set(best.map((entry) => entry.index));
    for (let i = removedPairs.length - 1; i >= 0; i -= 1) {
      if (keptIndices.has(removedPairs[i].index)) removedPairs.splice(i, 1);
    }
    fellBack = true;
  }

  return deepFreezeLocal({
    kept: Object.freeze(kept),
    removed: Object.freeze(removedPairs.map((pair) => pair.record)),
    stats: Object.freeze({
      input: list.length,
      kept: kept.length,
      removed: removedPairs.length,
      keptShare: list.length > 0 ? kept.length / list.length : 0,
      fellBack,
    }),
  });
}

/** Local deep freeze (engine-pure module: no imports by design). */
function deepFreezeLocal(record) {
  const walk = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Object.keys(value)) walk(value[key]);
    return Object.freeze(value);
  };
  return walk(record);
}

const longTailFilter = {
  filterLongTail,
  explainCut,
  excessAffinity,
  relevanceOf,
  LONG_TAIL_DEFAULTS,
  CUT_REASONS,
};

export default longTailFilter;

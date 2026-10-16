/**
 * PopClicheFilter (task 58) — the AUTOMATIC QUANTILE CUT of mass
 * recommendations: remove the top 15% most banal ("pop-stamped")
 * entries of a ranked list.
 *
 * WHERE IT SITS: task 56's LongTailFilter applies ABSOLUTE Via-Negativa
 * rules (proven noise is cut regardless of the list); this module
 * applies a RELATIVE cut — "the most banal 15% OF THIS LIST" — the
 * operation a dossier executor runs over any recommendation batch
 * before publishing it.
 *
 * BANALITY INDEX (the exported contract, reusing task 56's metrics):
 *
 *     banality = max(0, popularity - excessAffinity)
 *              = max(0, 2 * popularity - relevance)
 *
 * Interpretation: a recommendation is banal exactly to the degree its
 * fame is NOT justified by specific relevance. A mega-hit that
 * OVER-PERFORMs (excess > 0) loses banality points; a famous entity
 * whose relevance merely tracks its fame stays fully banal; an
 * under-performing famous entity (negative excess) is the MOST banal
 * possible. The index is intentionally UNCAPPED above — it is a
 * relative ordering signal within one list, not a bounded score.
 * Missing affinity makes excess undefined -> banality falls back to
 * bare popularity (unmeasured specificity, honestly flagged in
 * metrics); missing popularity makes banality UNMEASURABLE (null) —
 * such entries are PROTECTED from the cut (absence of evidence is
 * never evidence of banality, the shared honesty rule of tasks 56-57).
 *
 * CUT MATH: cutable = entries with a measurable banality STRICTLY
 * ABOVE 0 — an index of exactly 0 means the relevance is at least
 * twice the fame, which PROVES the entry is not a pop-stamp; such
 * entries are protected from the cut at any cutRate (counted in
 * stats.zeroBanality). cutCount = floor(cutable * cutRate) — at least
 * 1 when cutRate > 0 and anything is cutable (alwaysCutAtLeastOne,
 * default true: a 15% cut must be FELT; a 4-item list still loses its
 * single most banal entry). Ties in banality break by INPUT ORDER
 * (earlier = cut first) — fully deterministic, no RNG.
 *
 * OUTPUT: order-preserving kept entries (each carrying a frozen
 * `cliche: {banality}` diagnostic), a QUANTILE-ORDERED removal ledger
 * (most banal first, 1-based quantileRank, full metrics — the cut you
 * can audit) and stats including `thresholdBanality` (the lowest
 * banality that was still cut — the market line of the batch).
 *
 * Pure (imports only the sibling engine metric module), no clocks/RNG.
 */

import { excessAffinity, relevanceOf } from './LongTailFilter.js';

/** Documented defaults (exported tuning contract). */
export const CLICHE_DEFAULTS = Object.freeze({
  cutRate: 0.15,
  alwaysCutAtLeastOne: true,
});

/** The single machine-readable removal reason of this filter. */
export const CLICHE_REASONS = Object.freeze({
  TOP_BANALITY_QUANTILE: 'top_banality_quantile',
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Round to 6 decimals: float-stable JSON and contracts. */
const round6 = (value) => Math.round(value * 1e6) / 1e6;

/**
 * The banality index of ONE candidate: max(0, popularity - excess).
 * Returns null when popularity is missing (unmeasurable -> protected).
 */
export function banalityIndex(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const popularity = finiteNumber(candidate.popularity);
  if (popularity === null) return null;
  const excess = excessAffinity(candidate);
  if (excess === null) return round6(popularity);
  return round6(Math.max(0, popularity - excess));
}

const validateOptions = (options) => {
  const { cutRate, alwaysCutAtLeastOne } = options;
  if (typeof cutRate !== 'number' || !Number.isFinite(cutRate) || cutRate < 0 || cutRate > 1) {
    throw new TypeError('cutMassCliches: cutRate must be a number in [0, 1]');
  }
  if (typeof alwaysCutAtLeastOne !== 'boolean') {
    throw new TypeError('cutMassCliches: alwaysCutAtLeastOne must be a boolean');
  }
};

/**
 * Cuts the top-`cutRate` most banal entries of a recommendation list.
 *
 * @param {object[]} candidates ranked extractor outputs carrying
 *        `popularity` and `affinity`|`correlation`.
 * @param {object} [options] {cutRate = 0.15, alwaysCutAtLeastOne = true}
 *        (validated; bad values throw TypeError — programmer error).
 * @returns {Readonly<{kept, removed, stats}>} frozen record:
 *          - kept    — surviving entries, INPUT order, each with
 *                      `cliche: {banality}`;
 *          - removed — ledger in QUANTILE order (most banal first):
 *                      {id, name, quantileRank, reason, metrics:
 *                      {popularity, affinity, excess, banality}};
 *          - stats   — {input, kept, removed, cutRate, cutCount,
 *                      thresholdBanality, unmeasured, zeroBanality}.
 */
export function cutMassCliches(candidates, options = {}) {
  const resolved = { ...CLICHE_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && typeof c === 'object')
    : [];

  const scored = list.map((candidate, index) => ({
    candidate,
    index,
    banality: banalityIndex(candidate),
  }));

  const cutable = scored.filter(
    (entry) => entry.banality !== null && entry.banality > 0
  );
  const unmeasured = scored.length - scored.filter((e) => e.banality !== null).length;
  const zeroBanality = scored.filter((e) => e.banality === 0).length;

  // Banality desc; ties break by input order (earlier = cut first).
  const ordered = [...cutable].sort(
    (a, b) => b.banality - a.banality || a.index - b.index
  );

  let cutCount = Math.floor(ordered.length * resolved.cutRate);
  if (resolved.alwaysCutAtLeastOne && resolved.cutRate > 0 && ordered.length > 0) {
    cutCount = Math.max(cutCount, 1);
  }

  const cutIndices = new Set(ordered.slice(0, cutCount).map((entry) => entry.index));

  const kept = Object.freeze(
    scored
      .filter((entry) => !cutIndices.has(entry.index))
      .map((entry) =>
        Object.freeze({
          ...entry.candidate,
          cliche: Object.freeze({ banality: entry.banality }),
        })
      )
  );

  const removed = Object.freeze(
    ordered.slice(0, cutCount).map((entry, rank) =>
      Object.freeze({
        id: entry.candidate.id ?? null,
        name: entry.candidate.name ?? null,
        quantileRank: rank + 1,
        reason: CLICHE_REASONS.TOP_BANALITY_QUANTILE,
        metrics: Object.freeze({
          popularity: finiteNumber(entry.candidate.popularity),
          affinity: relevanceOf(entry.candidate),
          excess: excessAffinity(entry.candidate),
          banality: entry.banality,
        }),
      })
    )
  );

  return Object.freeze({
    kept,
    removed,
    stats: Object.freeze({
      input: scored.length,
      kept: kept.length,
      removed: cutCount,
      cutRate: resolved.cutRate,
      cutCount,
      thresholdBanality: cutCount > 0 ? ordered[cutCount - 1].banality : null,
      unmeasured,
      zeroBanality,
    }),
  });
}

const popClicheFilter = {
  cutMassCliches,
  banalityIndex,
  CLICHE_DEFAULTS,
  CLICHE_REASONS,
};

export default popClicheFilter;

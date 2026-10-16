/**
 * NonObviousSorter (task 61) — re-ranks the output array with PRIORITY
 * FOR NON-OBVIOUS BUT MATHEMATICALLY CONFIRMED high-level
 * correlations.
 *
 * THE INTUITION, MADE NUMERIC: a correlation between two famous things
 * is boring — fame explains it. A correlation that SURVIVES despite
 * obscurity is information. This sorter puts the latter first using
 * the CONFIRMED SURPRISE index assembled from the existing math stack
 * (no new formulas, only composition):
 *
 *   confirmation = connectionScoreOf(entry)   (task-60 priority chain:
 *                  affinity -> correlation -> index -> weight);
 *   excess        = max(0, excessAffinity(entry))  (task-56 metric:
 *                  relevance BEYOND what fame predicts — only the
 *                  positive part is non-obvious evidence);
 *   obscurity     = U(popularity)             (task-57 uniqueness
 *                  coefficient; unmeasured popularity -> 0).
 *
 *   surprise = confirmation * (1 + excessWeight * excess
 *                              + rarityWeight * obscurity)
 *
 * The multiplier is a RELATIVE sort key (bounded by
 * 1 + excessWeight + rarityWeight), not a probability. Properties
 * pinned by tests: at equal confirmation the entry with the higher
 * excess wins; a mass hit (excess ~ 0, tiny obscurity) sinks below a
 * weaker-but-specific correlation; entries with NO measurable
 * confirmation get surprise null and sort LAST (in input order) —
 * unmeasured is never ranked above measured.
 *
 * Ordering: surprise desc -> confirmation desc -> INPUT ORDER (fully
 * deterministic stable sort, no RNG). The sort RE-RANKS only — no
 * entry is ever dropped (filtering is tasks 56/58's job). Output:
 * frozen entries {...entry, sorting: {surprise, confirmation, excess,
 * obscurity}} plus stats {count, measured, unmeasured}. Pure engine
 * module; reuses the sibling metric modules via import.
 */

import { connectionScoreOf } from './ScoreNormalizer.js';
import { excessAffinity } from './LongTailFilter.js';
import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Documented defaults (exported tuning contract). */
export const SORT_DEFAULTS = Object.freeze({
  excessWeight: 1,
  rarityWeight: 0.5,
});

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const validateOptions = (options) => {
  for (const key of ['excessWeight', 'rarityWeight']) {
    const value = options[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
      throw new TypeError(`sortByNonObvious: ${key} must be a number in [0, 10]`);
    }
  }
};

/** The scoring core shared by surpriseIndex and the sort. */
function scoreEntry(entry, resolved) {
  const confirmation = connectionScoreOf(entry);
  const rawExcess = excessAffinity(entry);
  const excess = rawExcess === null ? 0 : Math.max(0, rawExcess);
  const obscurity =
    uniquenessCoefficient(entry?.popularity ?? null).coefficient ?? 0;
  const surprise =
    confirmation === null
      ? null
      : round6(
          confirmation *
            (1 + resolved.excessWeight * excess + resolved.rarityWeight * obscurity)
        );
  return { confirmation, excess, obscurity, surprise };
}

/**
 * The confirmed-surprise index of ONE entry. Returns null when no
 * connection score is measurable (the entry will sink).
 */
export function surpriseIndex(entry, options = {}) {
  const resolved = { ...SORT_DEFAULTS, ...options };
  validateOptions(resolved);
  return scoreEntry(entry, resolved).surprise;
}

/**
 * Re-ranks an output array with non-obvious-first priority.
 *
 * @param {object[]} entries pipeline outputs (tasks 49-60 shapes).
 * @param {object} [options] {excessWeight = 1, rarityWeight = 0.5}
 *        (validated; bad values throw TypeError — programmer error).
 * @returns {Readonly<{entries, stats}>} frozen record: entries in the
 *          new order, each {...entry, sorting: {surprise,
 *          confirmation, excess, obscurity}}; stats {count, measured,
 *          unmeasured}.
 */
export function sortByNonObvious(entries, options = {}) {
  const resolved = { ...SORT_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(entries)
    ? entries.filter((e) => e && typeof e === 'object')
    : [];

  const scored = list.map((entry, index) => ({
    entry,
    index,
    ...scoreEntry(entry, resolved),
  }));

  const measured = scored.filter((entry) => entry.surprise !== null).length;

  // surprise desc -> confirmation desc -> input order. Nulls sink.
  const ordered = [...scored].sort((a, b) => {
    if (a.surprise === null && b.surprise === null) return a.index - b.index;
    if (a.surprise === null) return 1;
    if (b.surprise === null) return -1;
    return (
      b.surprise - a.surprise ||
      (b.confirmation ?? 0) - (a.confirmation ?? 0) ||
      a.index - b.index
    );
  });

  return Object.freeze({
    entries: Object.freeze(
      ordered.map((item) =>
        Object.freeze({
          ...item.entry,
          sorting: Object.freeze({
            surprise: item.surprise,
            confirmation: item.confirmation,
            excess: round6(item.excess),
            obscurity: item.obscurity,
          }),
        })
      )
    ),
    stats: Object.freeze({
      count: list.length,
      measured,
      unmeasured: list.length - measured,
    }),
  });
}

const nonObviousSorter = {
  sortByNonObvious,
  surpriseIndex,
  SORT_DEFAULTS,
};

export default nonObviousSorter;

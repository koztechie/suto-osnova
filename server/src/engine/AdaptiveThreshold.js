/**
 * AdaptiveThreshold (task 67) — edge-case handling: AUTOMATIC AFFINITY
 * THRESHOLD RELIEF for rare and ultra-niche entities.
 *
 * THE PROBLEM, STATISTICALLY: Qloo's affinity is a sparse-graph
 * measurement — an ultra-rare entity has FEWER co-occurrences, so even
 * a perfect taste match arrives with a systematically WEAKER raw
 * affinity than a mainstream one. A fixed gate (task 52's 0.65
 * contract) therefore rejects exactly the long tail this project exists
 * to surface (tasks 56-61). Rarity must buy threshold relief.
 *
 * THE SCHEDULE:
 *
 *     T(entity) = max(minThreshold, T0 * (1 - relief * U(popularity)))
 *
 *   - T0 = base threshold (default 0.65 — the task-52 contract);
 *   - U  = task-57 uniqueness coefficient in [0, 1];
 *   - relief (default 0.5): a max-uniqueness entity needs only
 *     (1 - relief) * T0 — for the defaults, 0.325;
 *   - monotone: rarer -> lower threshold, NEVER above T0 (relief only
 *     reduces) and never below the absolute minThreshold floor
 *     (default 0.2: below that the graph signal is noise and rarity
 *     cannot excuse it);
 *   - HONEST DATA HANDLING (the shared rule of tasks 56-66): a
 *     MISSING popularity means rarity is UNPROVEN -> NO relief
 *     (threshold = base, rarity null); a missing affinity can never
 *     pass (reason `no_affinity` in the ledger);
 *   - relief = 0 reproduces the legacy FIXED gate exactly (compat
 *     pin).
 *
 * Surfaces: affinityThreshold (the schedule), passesThreshold (one
 * verdict with margin) and filterByAdaptiveThreshold (order-preserving
 * batch with an auditable rejection ledger and stats). Pure engine
 * module: reuses the task-57 uniqueness coefficient and the task-56
 * relevance reader; no I/O, no clocks, no RNG.
 */

import { uniquenessCoefficient } from './UniquenessCoefficient.js';
import { relevanceOf } from './LongTailFilter.js';

/** Documented defaults (exported tuning contract). */
export const THRESHOLD_DEFAULTS = Object.freeze({
  base: 0.65,
  relief: 0.5,
  minThreshold: 0.2,
});

/** Machine-readable rejection reasons. */
export const THRESHOLD_REASONS = Object.freeze({
  BELOW_THRESHOLD: 'below_threshold',
  NO_AFFINITY: 'no_affinity',
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const validateOptions = (options) => {
  const { base, relief, minThreshold } = options;
  if (typeof base !== 'number' || !(base > 0 && base <= 1)) {
    throw new TypeError('adaptive threshold: base must be a number in (0, 1]');
  }
  if (typeof relief !== 'number' || !(relief >= 0 && relief <= 1)) {
    throw new TypeError('adaptive threshold: relief must be a number in [0, 1]');
  }
  if (typeof minThreshold !== 'number' || !(minThreshold >= 0 && minThreshold <= base)) {
    throw new TypeError('adaptive threshold: minThreshold must be a number in [0, base]');
  }
};

/**
 * The affinity threshold for ONE popularity value (or candidate).
 *
 * @param {number|{popularity?: number}|null} input
 * @param {object} [options] THRESHOLD_DEFAULTS overrides (validated).
 * @returns {Readonly<{threshold, base, relief, rarity, tier,
 *          floorApplied}>} frozen; rarity null when unproven.
 */
export function affinityThreshold(input, options = {}) {
  const resolved = { ...THRESHOLD_DEFAULTS, ...options };
  validateOptions(resolved);

  const raw =
    typeof input === 'number'
      ? input
      : input && typeof input === 'object'
        ? finiteNumber(input.popularity)
        : null;
  const popularity = finiteNumber(raw);

  const rarity =
    popularity === null ? null : uniquenessCoefficient(popularity).coefficient;
  const discounted =
    rarity === null
      ? resolved.base
      : resolved.base * (1 - resolved.relief * rarity);
  const floored = Math.max(resolved.minThreshold, discounted);

  return Object.freeze({
    threshold: round6(Math.min(resolved.base, floored)),
    base: resolved.base,
    relief: rarity === null ? 0 : round6(resolved.relief * rarity),
    rarity,
    tier: rarity === null ? null : uniquenessCoefficient(popularity).tier,
    floorApplied: floored !== discounted && rarity !== null,
  });
}

/**
 * One pass/fail verdict with the applied threshold and margin.
 *
 * @returns {Readonly<{pass, affinity, threshold, margin, rarity,
 *          reason}>} frozen; reason null on pass.
 */
export function passesThreshold(candidate, options = {}) {
  const affinity = relevanceOf(candidate);
  const schedule = affinityThreshold(candidate, options);

  if (affinity === null) {
    return Object.freeze({
      pass: false,
      affinity: null,
      threshold: schedule.threshold,
      margin: null,
      rarity: schedule.rarity,
      reason: THRESHOLD_REASONS.NO_AFFINITY,
    });
  }

  const margin = round6(affinity - schedule.threshold);
  return Object.freeze({
    pass: margin >= 0,
    affinity: round6(affinity),
    threshold: schedule.threshold,
    margin,
    rarity: schedule.rarity,
    reason: margin >= 0 ? null : THRESHOLD_REASONS.BELOW_THRESHOLD,
  });
}

/**
 * Filters a candidate batch under the adaptive schedule
 * (order-preserving; auditable ledger — the tasks 56-66 convention).
 *
 * @returns {Readonly<{kept, rejected, stats}>} frozen: rejected
 *          entries carry {id, name, reason, affinity, threshold,
 *          margin, rarity}; stats {input, kept, rejected, noAffinity,
 *          relieved, meanRelief} (relief stats over rarity-measured
 *          entries, null when none).
 */
export function filterByAdaptiveThreshold(candidates, options = {}) {
  const resolved = { ...THRESHOLD_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && typeof c === 'object')
    : [];

  const kept = [];
  const rejected = [];
  let noAffinity = 0;
  let relieved = 0;
  let reliefSum = 0;

  for (const candidate of list) {
    const verdict = passesThreshold(candidate, resolved);

    if (verdict.rarity !== null) {
      reliefSum += verdict.rarity;
      if (verdict.rarity > 0) relieved += 1;
    }

    if (verdict.pass) {
      kept.push(
        Object.freeze({
          ...candidate,
          threshold: Object.freeze({
            affinity: verdict.affinity,
            threshold: verdict.threshold,
            margin: verdict.margin,
            rarity: verdict.rarity,
          }),
        })
      );
      continue;
    }

    if (verdict.reason === THRESHOLD_REASONS.NO_AFFINITY) noAffinity += 1;
    rejected.push(
      Object.freeze({
        id: candidate.id ?? null,
        name: candidate.name ?? null,
        reason: verdict.reason,
        affinity: verdict.affinity,
        threshold: verdict.threshold,
        margin: verdict.margin,
        rarity: verdict.rarity,
      })
    );
  }

  const measuredRarity = list.filter(
    (c) => finiteNumber(c?.popularity) !== null
  ).length;

  return Object.freeze({
    kept: Object.freeze(kept),
    rejected: Object.freeze(rejected),
    stats: Object.freeze({
      input: list.length,
      kept: kept.length,
      rejected: rejected.length,
      noAffinity,
      relieved,
      meanRelief: measuredRarity > 0 ? round6(reliefSum / measuredRarity) : null,
    }),
  });
}

const adaptiveThreshold = {
  affinityThreshold,
  passesThreshold,
  filterByAdaptiveThreshold,
  THRESHOLD_DEFAULTS,
  THRESHOLD_REASONS,
};

export default adaptiveThreshold;

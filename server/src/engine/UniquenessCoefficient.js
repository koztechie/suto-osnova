/**
 * UniquenessCoefficient (task 57) — the mathematical uniqueness score
 * of an entity derived from its GLOBAL popularity in the Qloo sample.
 *
 * MODEL (information-theoretic, pure): treat the entity's Qloo
 * popularity percentile p as the probability of meeting it at random
 * in the sample. Its self-information (surprisal) is
 *
 *     bits(p) = -log2(p)
 *
 * and the UNIQUENESS COEFFICIENT is that surprisal normalized over the
 * widest surprisal the sample can express:
 *
 *     U(p) = log2(1/p) / log2(1 / minProbability),  p in (0, 1]
 *
 * with minProbability = 1e-6 (the practical support floor: percentiles
 * below one in a million are indistinguishable from "never met").
 *
 * PROPERTIES (pinned by server/test/uniquenessCoefficient.test.js):
 *   - bounded U in [0, 1]; U(1) = 0 (a universally known entity
 *     carries zero uniqueness), U(minProbability) = 1;
 *   - MONOTONE decreasing in p — more famous, less unique, always;
 *   - exact landmark values at decimal percentiles: U(1e-1) = 1/6,
 *     U(1e-2) = 1/3, U(1e-3) = 1/2 — the logarithm does the work, not
 *     an arbitrary lookup;
 *   - LINEAR popularity scales (1 - p) would compress the entire
 *     long tail into noise: Qloo percentiles cluster low, so rarity
 *     differences live at small p, where only the log resolves them.
 *
 * HONEST DATA HANDLING (mirrors task 56): the Qloo gateway DROPS
 * popularity zeroes (live-verified), so p === 0 is treated as
 * "rarer than measurable" -> coefficient 1.0 with reason
 * `zero_popularity`; missing/non-numeric popularity -> coefficient
 * null with reason `no_popularity` (an unmeasured entity is never
 * silently scored); out-of-range p (< 0 or > 1) -> null with reason
 * `invalid_popularity` (malformed upstream data, reported).
 *
 * `annotateUniqueness(candidates)` batch-annotates extractor outputs
 * (tasks 51-55, 56) with {coefficient, bits, tier, reason} per entry
 * plus distribution stats — order-preserving, frozen, deterministic
 * (no clocks/RNG, zero imports).
 */

/** Documented defaults (exported tuning contract). */
export const UNIQUENESS_DEFAULTS = Object.freeze({
  minProbability: 1e-6,
});

/**
 * Tier ladder (exported): the coefficient bands that label an entity
 * from universally known to microtail-rare.
 */
export const UNIQUENESS_TIERS = Object.freeze([
  Object.freeze({ tier: 'microtail', min: 0.75 }),
  Object.freeze({ tier: 'long_tail', min: 0.35 }),
  Object.freeze({ tier: 'midstream', min: 0.15 }),
  Object.freeze({ tier: 'mainstream', min: 0 }),
]);

/** Machine-readable measurement reasons. */
export const UNIQUENESS_REASONS = Object.freeze({
  NONE: null, // measured successfully
  NO_POPULARITY: 'no_popularity',
  ZERO_POPULARITY: 'zero_popularity',
  INVALID_POPULARITY: 'invalid_popularity',
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Round to 6 decimals: keeps JSON output and tests float-stable. */
const round6 = (value) => Math.round(value * 1e6) / 1e6;

const validateOptions = (options) => {
  const { minProbability } = options;
  if (
    typeof minProbability !== 'number' ||
    !Number.isFinite(minProbability) ||
    minProbability <= 0 ||
    minProbability > 1
  ) {
    throw new TypeError(
      'uniquenessCoefficient: minProbability must be a number in (0, 1]'
    );
  }
};

/** Reads the popularity from a raw number or a candidate object. */
function popularityOf(input) {
  if (typeof input === 'number') return input;
  if (input && typeof input === 'object') return finiteNumber(input.popularity);
  return undefined; // not even a candidate shape
}

/**
 * The uniqueness coefficient of ONE popularity value (or a candidate
 * carrying `popularity`).
 *
 * @param {number|{popularity?: number}} input
 * @param {{minProbability?: number}} [options]
 * @returns {Readonly<{coefficient: number|null, bits: number|null,
 *          tier: string|null, reason: string|null}>}
 *          `bits` is the raw unnormalized surprisal (-log2(p));
 *          `tier` is null when the coefficient could not be measured.
 * @throws {TypeError} on invalid options (programmer error).
 */
export function uniquenessCoefficient(input, options = {}) {
  const resolved = { ...UNIQUENESS_DEFAULTS, ...options };
  validateOptions(resolved);

  const raw = popularityOf(input);
  const p = finiteNumber(raw);
  const maxBits = Math.log2(1 / resolved.minProbability);

  const measured = (value, bits) => {
    const tier =
      UNIQUENESS_TIERS.find((band) => value >= band.min)?.tier ?? 'mainstream';
    return Object.freeze({
      coefficient: round6(value),
      bits: round6(bits),
      tier,
      reason: UNIQUENESS_REASONS.NONE,
    });
  };
  const unmeasured = (reason) =>
    Object.freeze({ coefficient: null, bits: null, tier: null, reason });

  if (p === null || raw === undefined) return unmeasured(UNIQUENESS_REASONS.NO_POPULARITY);
  if (p < 0 || p > 1) return unmeasured(UNIQUENESS_REASONS.INVALID_POPULARITY);
  if (p === 0) {
    // Dropped-by-the-gateway territory: rarer than measurable -> max.
    return Object.freeze({
      coefficient: 1,
      bits: null,
      tier: 'microtail',
      reason: UNIQUENESS_REASONS.ZERO_POPULARITY,
    });
  }
  if (p === 1) return measured(0, 0);

  const bits = -Math.log2(p);
  return measured(bits / maxBits, bits);
}

/**
 * Batch-annotates candidate entries (extractor shapes) with their
 * uniqueness. Order-preserving; originals are never mutated (frozen
 * copies carry a `uniqueness` block).
 *
 * @param {object[]} candidates
 * @param {{minProbability?: number}} [options]
 * @returns {Readonly<{entries, stats}>} frozen record:
 *          - entries — {...candidate, uniqueness} in input order;
 *          - stats   — {count, measured, unmeasured, tiers, meanCoefficient}
 *            (mean over MEASURED entries, null when none).
 * @throws {TypeError} on invalid options.
 */
export function annotateUniqueness(candidates, options = {}) {
  const resolved = { ...UNIQUENESS_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && typeof c === 'object')
    : [];

  const entries = [];
  const tierCounts = { microtail: 0, long_tail: 0, midstream: 0, mainstream: 0 };
  let measured = 0;
  let coefficientSum = 0;

  for (const candidate of list) {
    const result = uniquenessCoefficient(candidate, {
      minProbability: resolved.minProbability,
    });
    if (result.coefficient !== null) {
      measured += 1;
      coefficientSum += result.coefficient;
      tierCounts[result.tier] += 1;
    }
    entries.push(Object.freeze({ ...candidate, uniqueness: result }));
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    stats: Object.freeze({
      count: list.length,
      measured,
      unmeasured: list.length - measured,
      tiers: Object.freeze({ ...tierCounts }),
      meanCoefficient: measured > 0 ? round6(coefficientSum / measured) : null,
    }),
  });
}

const uniquenessCoefficientModule = {
  uniquenessCoefficient,
  annotateUniqueness,
  UNIQUENESS_DEFAULTS,
  UNIQUENESS_TIERS,
  UNIQUENESS_REASONS,
};

export default uniquenessCoefficientModule;

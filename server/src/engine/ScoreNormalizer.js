/**
 * ScoreNormalizer (task 60) — unified 0-100% CONNECTION scoring for
 * every detected cross-domain artifact.
 *
 * The pipeline emits artifacts with heterogeneous 0..1 connection
 * scores: entities carry `affinity` (tasks 49-55), literary entries
 * carry `correlation` (task 52), tag entries carry `weight` (carrier
 * share, tasks 51-54), kinship pairs carry `index` (task 59). This
 * module reads the ONE connection score of an artifact through a
 * documented priority chain and publishes it on a 0-100% scale:
 *
 *   connectionScoreOf: affinity -> correlation -> index -> weight
 *                      (task-59 PAIRS carry both `index` and a
 *                      rarity-multiplier `weight` > 1 — the bounded
 *                      kinship index wins; counts like `carriers` are
 *                      NOT connection strength — batch arithmetic,
 *                      never a score);
 *
 *   toPercent:          clamp [0, 1] x 100, one decimal (display-ready);
 *                       null stays null — UNMEASURED IS NEVER ZERO
 *                       (the shared honesty rule of tasks 56-59).
 *
 * TWO SCALES (options.mode):
 *   absolute (default) — the raw 0..1 score as a percentage of the
 *                        full scale (0.8 -> 80.0%): comparable ACROSS
 *                        batches;
 *   relative           — min-max within THIS batch: the weakest
 *                        detected artifact -> 0%, the strongest ->
 *                        100%: comparable WITHIN a batch (degenerate
 *                        batch where every measured score is equal ->
 *                        all 100% with stats.degenerate — everything
 *                        is equally the strongest; a single artifact
 *                        -> 100% by the same rule).
 *
 * Output: order-preserving frozen entries carrying
 * `{...artifact, connection: {score, percent, scale}}` plus stats
 * {count, measured, unmeasured, minPercent, maxPercent, meanPercent,
 * degenerate}. Pure engine module: no I/O, no clocks, no RNG.
 */

/** Documented defaults (exported tuning contract). */
export const SCORE_DEFAULTS = Object.freeze({
  mode: 'absolute',
});

/** The recognized scale modes. */
export const SCORE_MODES = Object.freeze(['absolute', 'relative']);

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Round to one decimal: display-ready, float-stable percentages. */
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The connection score of ONE artifact through the documented
 * priority chain. Returns null when nothing measurable is present.
 */
export function connectionScoreOf(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  return (
    finiteNumber(artifact.affinity) ??
    finiteNumber(artifact.correlation) ??
    finiteNumber(artifact.index) ??
    finiteNumber(artifact.weight)
  );
}

/**
 * 0..1 -> 0..100 with clamping and one decimal. Null-safe: unmeasured
 * input stays null (never coerced to 0 or 100).
 */
export function toPercent(value) {
  const score = finiteNumber(value);
  if (score === null) return null;
  return round1(Math.min(1, Math.max(0, score)) * 100);
}

const validateOptions = (options) => {
  if (!SCORE_MODES.includes(options.mode)) {
    throw new TypeError(
      `normalizeArtifactScores: mode must be one of ${SCORE_MODES.join(' | ')}`
    );
  }
};

/**
 * Normalizes the connection scoring of a batch of detected
 * cross-domain artifacts to 0-100%.
 *
 * @param {object[]} artifacts extractor outputs (any shapes carrying
 *        affinity|correlation|weight|index).
 * @param {object} [options] {mode = 'absolute'} (validated; bad mode
 *        throws TypeError — programmer error).
 * @returns {Readonly<{entries, stats}>} frozen record:
 *          - entries — {...artifact, connection: {score, percent,
 *                      scale}} in input order;
 *          - stats   — {count, measured, unmeasured, minPercent,
 *                      maxPercent, meanPercent, degenerate} (percent
 *                      stats over MEASURED entries; null when none).
 */
export function normalizeArtifactScores(artifacts, options = {}) {
  const resolved = { ...SCORE_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(artifacts)
    ? artifacts.filter((a) => a && typeof a === 'object')
    : [];

  const scored = list.map((artifact, index) => ({
    artifact,
    index,
    score: connectionScoreOf(artifact),
  }));

  const measuredScores = scored
    .map((entry) => entry.score)
    .filter((score) => score !== null);
  const min = measuredScores.length > 0 ? Math.min(...measuredScores) : null;
  const max = measuredScores.length > 0 ? Math.max(...measuredScores) : null;
  const degenerate = resolved.mode === 'relative' && min !== null && min === max;

  const percentOf = (score) => {
    if (score === null) return null;
    if (resolved.mode === 'absolute') return toPercent(score);
    if (degenerate) return 100; // equally the strongest in this batch
    return round1(((score - min) / (max - min)) * 100);
  };

  const entries = Object.freeze(
    scored.map((entry) =>
      Object.freeze({
        ...entry.artifact,
        connection: Object.freeze({
          score: entry.score,
          percent: percentOf(entry.score),
          scale: resolved.mode,
        }),
      })
    )
  );

  const percents = scored
    .map((entry) => percentOf(entry.score))
    .filter((percent) => percent !== null);

  return Object.freeze({
    entries,
    stats: Object.freeze({
      count: list.length,
      measured: measuredScores.length,
      unmeasured: list.length - measuredScores.length,
      minPercent: percents.length > 0 ? Math.min(...percents) : null,
      maxPercent: percents.length > 0 ? Math.max(...percents) : null,
      meanPercent:
        percents.length > 0
          ? round1(percents.reduce((sum, v) => sum + v, 0) / percents.length)
          : null,
      degenerate,
    }),
  });
}

const scoreNormalizer = {
  normalizeArtifactScores,
  connectionScoreOf,
  toPercent,
  SCORE_DEFAULTS,
  SCORE_MODES,
};

export default scoreNormalizer;

/**
 * ResonanceIndex (task 93) — the EVENT RESONANCE INDEX: a single
 * 0-100% number for how COHERENT an activation brief is, computed
 * from the activation bundle's own evidence. Design contract:
 *
 *   - SEVEN SIGNALS, exported RESONANCE_WEIGHTS (they sum to 1.0):
 *       audience       0.25 — the audience-insights leg delivered
 *                             (rows -> 1.0; a delivered-but-empty
 *                             page -> 0.5, a documented half
 *                             signal);
 *       dual_evidence  0.20 — share of curation picks confirmed by
 *                             BOTH the taste graph and the audience
 *                             leg (the task-87 attribution);
 *       affinity       0.20 — mean graph affinity of the picks;
 *       chain_survival 0.10 — ranked/candidates: how much of the
 *                             pool survived the gates (dense real
 *                             signal vs long filler);
 *       domain_coverage 0.10 — expansion domains delivered/planned;
 *       layer_coverage 0.10 — sound/material/gastronomy legs that
 *                             succeeded/attempted;
 *       uniqueness     0.05 — mean uniqueness coefficient of the
 *                             ranked list (task 57).
 *   - RENORMALIZED WEIGHTING (the task-48 discipline): a MISSING
 *     signal is RENORMALIZED OUT, never scored as zero — a failed
 *     leg is not evidence of incoherence. `evidenceCoverage`
 *     reports how much of the weighting was actually
 *     evidence-backed; the score is never presented without it. If
 *     NOTHING is measurable the score is honestly null.
 *   - The index is a MEASUREMENT, not a verdict: no grade, no
 *     color, no invented thresholds — the components show the math.
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * computeResonance(pieces, options) -> frozen block;
 * renderResonance(block) for the brief (deterministic, zero
 * emojis). Integrated into the activation bundle as
 * `bundle.resonance` (options.resonance = false disables). Pinned
 * by server/test/resonanceIndex.test.js.
 */

/** Block version. */
export const RESONANCE_VERSION = 1;

/** The signal weights (exported tuning contract, sum 1.0). */
export const RESONANCE_WEIGHTS = Object.freeze({
  audience: 0.25,
  dual_evidence: 0.2,
  affinity: 0.2,
  chain_survival: 0.1,
  domain_coverage: 0.1,
  layer_coverage: 0.1,
  uniqueness: 0.05,
});

/** Machine-readable missing-signal reasons. */
export const RESONANCE_REASONS = Object.freeze({
  AUDIENCE_UNAVAILABLE: 'audience_insights_unavailable',
  NO_PICKS: 'no_picks',
  NO_MEASURABLE_AFFINITY: 'no_measurable_affinity',
  NO_CANDIDATES: 'no_candidates',
  NO_EXPANSION_RECORDS: 'no_expansion_records',
  NO_LAYER_RECORDS: 'no_layer_records',
  NO_UNIQUENESS_MEASURE: 'no_uniqueness_measure',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;

/** The EVIDENCE_KINDS.DUAL value of task 87 (no circular import). */
const DUAL_EVIDENCE = 'dual';

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Compute the Event Resonance Index.
 *
 * @param {object} pieces { audience, curation, chain, expansion,
 *        coverage, ranked } — the runExperiential() bundle pieces.
 * @param {object} [options] { weights } validated overrides.
 * @returns {Readonly<object>} the frozen block (score null when
 *          nothing is measurable).
 */
export function computeResonance(pieces, options = {}) {
  if (!pieces || typeof pieces !== 'object') {
    throw new TypeError('computeResonance: pieces must be an object');
  }
  const weights = { ...RESONANCE_WEIGHTS, ...(options.weights ?? {}) };
  for (const [key, value] of Object.entries(weights)) {
    if (!(key in RESONANCE_WEIGHTS)) {
      throw new TypeError(`computeResonance: unknown weight "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`computeResonance: weights.${key} must be a finite number >= 0`);
    }
  }
  if (Object.values(weights).reduce((sum, value) => sum + value, 0) <= 0) {
    throw new TypeError('computeResonance: at least one weight must be positive');
  }

  const picks = [
    ...(Array.isArray(pieces.curation?.openingActs) ? pieces.curation.openingActs : []),
    ...(Array.isArray(pieces.curation?.sponsors) ? pieces.curation.sponsors : []),
    ...(Array.isArray(pieces.curation?.vendors) ? pieces.curation.vendors : []),
  ];
  const ranked = Array.isArray(pieces.ranked) ? pieces.ranked : [];
  const measuredCoefficients = ranked
    .map((entry) => entry?.uniqueness?.coefficient)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  const measurableAffinities = picks
    .map((pick) => pick?.affinityPercent)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .map((percent) => percent / 100);
  const plannedDomains = (pieces.expansion?.ok ?? 0) + (pieces.expansion?.failed ?? 0);
  const layerRecords = Object.entries(pieces.coverage ?? {});

  const components = [];
  const missing = [];
  const record = (key, value, reason, evidence) => {
    if (value === null) {
      missing.push(Object.freeze({ key, reason }));
      return;
    }
    components.push(Object.freeze({
      key,
      weight: weights[key],
      value: round12(value),
      contribution: round12(weights[key] * value),
      evidence,
    }));
  };

  // 1. The audience leg: delivered rows -> full signal; a delivered
  //    but EMPTY page -> half a signal; a failed leg -> MISSING (a
  //    failure is not evidence of incoherence).
  if (pieces.audience?.available === true) {
    const count = typeof pieces.audience?.count === 'number' ? pieces.audience.count : 0;
    record('audience', count > 0 ? 1 : 0.5,
      null, `${count} audience row(s)`);
  } else {
    record('audience', null, RESONANCE_REASONS.AUDIENCE_UNAVAILABLE, null);
  }

  // 2. Dual evidence across the curation picks.
  if (picks.length === 0) {
    record('dual_evidence', null, RESONANCE_REASONS.NO_PICKS, null);
  } else {
    const dual = picks.filter((pick) => pick?.evidence === DUAL_EVIDENCE).length;
    record('dual_evidence', dual / picks.length, null, `${dual} of ${picks.length} picks dual`);
  }

  // 3. Mean graph affinity of the picks (nulls honestly excluded).
  if (measurableAffinities.length === 0) {
    record('affinity', null, RESONANCE_REASONS.NO_MEASURABLE_AFFINITY, null);
  } else {
    record('affinity', mean(measurableAffinities), null,
      `${measurableAffinities.length} measurable pick(s)`);
  }

  // 4. Chain survival: ranked / candidates (clamped 0..1).
  const candidates = pieces.chain?.candidates;
  const rankedCount = pieces.chain?.ranked;
  if (!Number.isFinite(candidates) || candidates <= 0
    || !Number.isFinite(rankedCount)) {
    record('chain_survival', null, RESONANCE_REASONS.NO_CANDIDATES, null);
  } else {
    record('chain_survival', Math.min(1, rankedCount / candidates), null,
      `${rankedCount} of ${candidates} candidates`);
  }

  // 5. Expansion domain coverage: delivered / planned.
  if (!Number.isFinite(plannedDomains) || plannedDomains <= 0) {
    record('domain_coverage', null, RESONANCE_REASONS.NO_EXPANSION_RECORDS, null);
  } else {
    record('domain_coverage', (pieces.expansion.ok ?? 0) / plannedDomains, null,
      `${pieces.expansion.ok ?? 0} of ${plannedDomains} domains`);
  }

  // 6. Layer coverage: succeeded / attempted.
  if (layerRecords.length === 0) {
    record('layer_coverage', null, RESONANCE_REASONS.NO_LAYER_RECORDS, null);
  } else {
    const ok = layerRecords.filter(([, value]) => value === true).length;
    record('layer_coverage', ok / layerRecords.length, null, `${ok} of ${layerRecords.length} legs`);
  }

  // 7. Mean uniqueness coefficient of the ranked list.
  if (measuredCoefficients.length === 0) {
    record('uniqueness', null, RESONANCE_REASONS.NO_UNIQUENESS_MEASURE, null);
  } else {
    record('uniqueness', mean(measuredCoefficients), null,
      `${measuredCoefficients.length} measured entr(ies)`);
  }

  // Renormalized weighted sum over the AVAILABLE signals.
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const evidenceCoverage = round12(availableWeight / totalWeight);
  const score = components.length === 0
    ? null
    : Math.round(
      100 * components.reduce((sum, component) => sum + component.contribution, 0) / availableWeight
    );

  return Object.freeze({
    version: RESONANCE_VERSION,
    score,
    evidenceCoverage,
    method: 'renormalized weighted sum over available signals',
    components: Object.freeze(components),
    missing: Object.freeze(missing),
    summary: score === null
      ? 'No measurable signal in the bundle — the index stays uncomputed.'
      : `Event Resonance Index ${score}% on ${Math.round(evidenceCoverage * 100)}% evidence coverage.`,
  });
}

/**
 * Render the printable index block (deterministic, zero emojis).
 */
export function renderResonance(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.components)) {
    throw new TypeError('renderResonance: expected a computeResonance() block');
  }
  const lines = [];
  lines.push(block.score === null
    ? 'EVENT RESONANCE INDEX: not computable (no measurable signal)'
    : `EVENT RESONANCE INDEX: ${block.score}%`);
  if (block.score !== null) {
    lines.push(
      `   evidence coverage: ${Math.round(block.evidenceCoverage * 100)}% of the weighting`
    );
  }
  for (const component of block.components) {
    lines.push(
      `   - ${component.key} (${Math.round(component.weight * 100)}% weight): ` +
        `${component.value.toFixed(2)}${component.evidence ? ` [${component.evidence}]` : ''}`
    );
  }
  if (block.missing.length > 0) {
    lines.push(
      `   missing (renormalized out): ${block.missing.map((m) => m.key).join(', ')}`
    );
  }
  return lines.join('\n');
}

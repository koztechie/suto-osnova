/**
 * DissonanceFilter (task 96) — FILTERING OF ANTIPODES: cuts
 * ACCIDENTAL NOISE out of the inverted taste vector and
 * concentrates the report on entities that cause CONSCIOUS
 * cultural dissonance.
 *
 * THE PROBLEM IT SOLVES: the inversion (task 95) honestly selects
 * the weakest correlations — but a weak correlation alone does not
 * prove dissonance. An entity the audience NEVER ENCOUNTERED
 * (missing popularity) or a rare-tail pick (obscure popularity)
 * with a low coefficient is GRAPH NOISE, not opposition: you cannot
 * consciously reject what you have never met. Two independent,
 * honestly reported axes decide:
 *
 *   EVIDENCE (from the inverter's own fields):
 *     proven  — a signed negative correlation (the Qloo API itself
 *               asserts opposition: the strongest antithesis
 *               evidence, kept REGARDLESS of encounter — the
 *               graph's assertion stands on its own);
 *     zero    — a proven zero affinity (the graph explicitly
 *               reports no relationship);
 *     weak    — the weakest positive correlation only.
 *
 *   ENCOUNTER (task-57 uniqueness tiers over popularity — ONE tier
 *   table, no parallel vocabulary): did the audience actually MET
 *   the entity? The tier ladder is rarity-ordered
 *   [microtail, long_tail, midstream, mainstream]; a row counts as
 *   `broad` encounter when its tier is at or above
 *   `minEncounterTier` (default `mainstream` = Qloo popularity
 *   >= ~0.13, the broadly-recognized band — the task-57
 *   normalized coefficient puts mainstream there). Lowering the
 *   bar to `midstream` widens the net; `unmeasured` popularity is
 *   never encounter evidence.
 *
 * THE DECISION MATRIX (deterministic, machine-readable):
 *     proven + any encounter        -> KEEP proven_dissonance
 *     zero   + broad                -> KEEP measured_dissonance
 *     zero   + obscure/unmeasured   -> CUT  obscure_unproven /
 *                                      unmeasured_encounter
 *     weak   + broad                -> KEEP minimal_correlation
 *                                      when options.keepMinimal
 *                                      (default true — the report
 *                                      keeps the full minimal-
 *                                      correlation picture), else
 *                                      CUT weak_correlation;
 *     weak   + obscure/unmeasured   -> CUT  obscure_unproven /
 *                                      unmeasured_encounter.
 * Every cut lands in the LEDGER with its reason — nothing is
 * dropped silently. KEPT records preserve the input (divergence)
 * order — the filter never re-ranks, it only classifies.
 *
 * Consumes TasteInverter records (task 95); mode-agnostic. Pure
 * module: no I/O, no clocks, no RNG. Surfaces: encounterOf,
 * classifyDissonance, filterConsciousDissonance. Integrated into
 * buildAntithesisBlock (the matrix and the lanes are built from the
 * KEPT records only; the cut rides the block as `dissonance.cut`).
 * Pinned by server/test/dissonanceFilter.test.js.
 */

import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Module version. */
export const DISSONANCE_VERSION = 1;

/** The dissonance classes (exported vocabulary). */
export const DISSONANCE_CLASSES = Object.freeze({
  PROVEN: 'proven_dissonance',
  MEASURED: 'measured_dissonance',
  MINIMAL: 'minimal_correlation',
});

/** Machine-readable noise-cut reasons. */
export const DISSONANCE_REASONS = Object.freeze({
  UNMEASURED_ENCOUNTER: 'unmeasured_encounter',
  OBSCURE_UNPROVEN: 'obscure_unproven',
  WEAK_CORRELATION: 'weak_correlation',
});

/** Encounter evidence tiers, rare -> known (the task-57 order). */
export const ENCOUNTER_TIERS = Object.freeze([
  'microtail', 'long_tail', 'midstream', 'mainstream',
]);

/** Documented defaults (exported tuning contract). */
export const DISSONANCE_DEFAULTS = Object.freeze({
  minEncounterTier: 'mainstream',
  keepMinimal: true,
});

/** The three encounter levels. */
export const ENCOUNTER_LEVELS = Object.freeze({
  BROAD: 'broad',
  OBSCURE: 'obscure',
  UNMEASURED: 'unmeasured',
});

const assertTier = (value, label) => {
  if (!ENCOUNTER_TIERS.includes(value)) {
    throw new TypeError(
      `${label}: minEncounterTier must be one of ${ENCOUNTER_TIERS.join(' | ')}`
    );
  }
};

/**
 * The ENCOUNTER verdict of one inverter record: the task-57
 * popularity tier mapped to broad / obscure / unmeasured against
 * `minEncounterTier` (default mainstream).
 */
export function encounterOf(record, options = {}) {
  const minEncounterTier = options.minEncounterTier ?? DISSONANCE_DEFAULTS.minEncounterTier;
  assertTier(minEncounterTier, 'encounterOf');
  const popularity = record?.popularity;
  if (typeof popularity !== 'number' || !Number.isFinite(popularity)) {
    return Object.freeze({ level: ENCOUNTER_LEVELS.UNMEASURED, tier: null });
  }
  const { tier } = uniquenessCoefficient({ popularity });
  if (tier === null) {
    return Object.freeze({ level: ENCOUNTER_LEVELS.UNMEASURED, tier: null });
  }
  const level = ENCOUNTER_TIERS.indexOf(tier) >= ENCOUNTER_TIERS.indexOf(minEncounterTier)
    ? ENCOUNTER_LEVELS.BROAD
    : ENCOUNTER_LEVELS.OBSCURE;
  return Object.freeze({ level, tier });
}

const evidenceOf = (record) => {
  if (record?.negativeCorrelation === true) return 'proven';
  if (record?.zeroAffinity === true) return 'zero';
  return 'weak';
};

/**
 * The classification verdict of ONE inverter record: keep (class)
 * or cut (reason), with both axes reported.
 */
export function classifyDissonance(record, options = {}) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('classifyDissonance: record must be an object');
  }
  const minEncounterTier = options.minEncounterTier ?? DISSONANCE_DEFAULTS.minEncounterTier;
  assertTier(minEncounterTier, 'classifyDissonance');
  const keepMinimal = options.keepMinimal ?? DISSONANCE_DEFAULTS.keepMinimal;
  if (typeof keepMinimal !== 'boolean') {
    throw new TypeError('classifyDissonance: keepMinimal must be a boolean');
  }

  const evidence = evidenceOf(record);
  const encounter = encounterOf(record, { minEncounterTier });

  let dissonanceClass = null;
  let reason = null;
  if (evidence === 'proven') {
    dissonanceClass = DISSONANCE_CLASSES.PROVEN; // the API's own assertion
  } else if (evidence === 'zero') {
    if (encounter.level === ENCOUNTER_LEVELS.BROAD) {
      dissonanceClass = DISSONANCE_CLASSES.MEASURED;
    } else {
      reason = encounter.level === ENCOUNTER_LEVELS.UNMEASURED
        ? DISSONANCE_REASONS.UNMEASURED_ENCOUNTER
        : DISSONANCE_REASONS.OBSCURE_UNPROVEN;
    }
  } else if (encounter.level === ENCOUNTER_LEVELS.BROAD) {
    if (keepMinimal) dissonanceClass = DISSONANCE_CLASSES.MINIMAL;
    else reason = DISSONANCE_REASONS.WEAK_CORRELATION;
  } else {
    reason = encounter.level === ENCOUNTER_LEVELS.UNMEASURED
      ? DISSONANCE_REASONS.UNMEASURED_ENCOUNTER
      : DISSONANCE_REASONS.OBSCURE_UNPROVEN;
  }
  return Object.freeze({
    evidence,
    encounter: encounter.level,
    encounterTier: encounter.tier,
    dissonanceClass,
    reason,
  });
}

/**
 * Filter an inverted vector: keep the conscious-dissonance records,
 * ledger the noise.
 *
 * @param {ReadonlyArray<object>} records TasteInverter records (any
 *        rows carrying negativeCorrelation/zeroAffinity/popularity).
 * @param {object} [options] { minEncounterTier, keepMinimal }.
 * @returns {Readonly<object>} { version, minEncounterTier,
 *          keepMinimal, kept (input order, decorated), cut (the
 *          ledger), stats } — frozen.
 */
export function filterConsciousDissonance(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError('filterConsciousDissonance: records must be an array');
  }
  const minEncounterTier = options.minEncounterTier ?? DISSONANCE_DEFAULTS.minEncounterTier;
  assertTier(minEncounterTier, 'filterConsciousDissonance');
  const keepMinimal = options.keepMinimal ?? DISSONANCE_DEFAULTS.keepMinimal;
  if (typeof keepMinimal !== 'boolean') {
    throw new TypeError('filterConsciousDissonance: keepMinimal must be a boolean');
  }
  const settings = { minEncounterTier, keepMinimal };

  const kept = [];
  const cut = [];
  const classes = {
    [DISSONANCE_CLASSES.PROVEN]: 0,
    [DISSONANCE_CLASSES.MEASURED]: 0,
    [DISSONANCE_CLASSES.MINIMAL]: 0,
  };
  const reasons = {
    [DISSONANCE_REASONS.UNMEASURED_ENCOUNTER]: 0,
    [DISSONANCE_REASONS.OBSCURE_UNPROVEN]: 0,
    [DISSONANCE_REASONS.WEAK_CORRELATION]: 0,
  };
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const verdict = classifyDissonance(record, settings);
    if (verdict.dissonanceClass !== null) {
      classes[verdict.dissonanceClass] += 1;
      kept.push(Object.freeze({
        ...record,
        dissonanceClass: verdict.dissonanceClass,
        encounter: verdict.encounter,
        encounterTier: verdict.encounterTier,
      }));
    } else {
      reasons[verdict.reason] += 1;
      cut.push(Object.freeze({
        id: record.id ?? null,
        name: record.name ?? null,
        reason: verdict.reason,
        evidence: verdict.evidence,
        encounter: verdict.encounter,
        encounterTier: verdict.encounterTier,
      }));
    }
  }

  return Object.freeze({
    version: DISSONANCE_VERSION,
    minEncounterTier,
    keepMinimal,
    kept: Object.freeze(kept),
    cut: Object.freeze(cut),
    stats: Object.freeze({
      input: records.length,
      kept: kept.length,
      cut: cut.length,
      classes: Object.freeze({ ...classes }),
      reasons: Object.freeze({ ...reasons }),
    }),
  });
}

/**
 * TasteInverter (task 95) — THE TASTE-VECTOR INVERSION ALGORITHM:
 * selects entities with the MINIMAL or NEGATIVE correlation
 * coefficient in the Qloo graph. Engine-level math, mode-agnostic:
 * AntithesisMode (task 94) builds its blindspot report ON this
 * module; any future caller (the `qloo_taste_antithesis` MCP tool,
 * risk analyzers) gets the same proven selection.
 *
 * THE COEFFICIENT CHAIN (exported as coefficientOf, priority order):
 *   1. `correlation` — a DECLARED SIGNED coefficient in [-1, 1].
 *      Present-but-invalid values (not finite, out of range) are
 *      DATA CORRUPTION: the row is rejected as UNMEASURED (reason
 *      `coefficient_out_of_range`) and never silently salvaged;
 *   2. the UNSIGNED chain (task-60 connectionScoreOf: affinity ->
 *      correlation -> index -> weight), range-checked to [0, 1]
 *      (same corruption rule);
 *   3. nothing measurable -> reason `no_measurable_coefficient`.
 * A row is never coerced: the absence of evidence stays unmeasured.
 *
 * THE TWO DIVERGENCE CONVENTIONS (both bounded to [0, 1], honest):
 *   - SIGNED  c in [-1, 1]: divergence = (1 - c) / 2 — a proven
 *     NEGATIVE correlation (c < 0) is the strongest antithesis
 *     evidence: c = 0 -> 50%, c = -1 -> 100%;
 *   - UNSIGNED a in [0, 1]: divergence = 1 - a — the Qloo affinity
 *     channel has no negative territory; a = 0 means a proven
 *     ZERO correlation (100% divergence), NOT a negative one
 *     (negativeCorrelation is honestly null for unsigned rows —
 *     absence of evidence is never claimed as opposition).
 * The mixed-input domain is reported (`coefficientDomain`).
 *
 * SELECTION (the task text: minimal OR negative coefficient):
 *   - `lowest` (default) — the `take` strongest divergences;
 *   - `negative` — ONLY rows with a proven signed negative
 *     coefficient (an unsigned-only pool yields an HONEST empty
 *     selection — the graph provided no negative evidence).
 *
 * ORDERING: divergence DESC, popularity DESC (a mainstream blindspot
 * pick is the strongest conflict/risk material), name, id.
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * coefficientOf(entry), invertTasteVector(entries, options). Pinned
 * by server/test/tasteInverter.test.js.
 */

import { connectionScoreOf } from './ScoreNormalizer.js';

/** Module version. */
export const TASTE_INVERTER_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const INVERTER_DEFAULTS = Object.freeze({
  take: 10,
  strategy: 'lowest',
});

/** Selection strategies (exported vocabulary). */
export const INVERTER_STRATEGIES = Object.freeze({
  LOWEST: 'lowest',
  NEGATIVE: 'negative',
});

/** The coefficient kinds the chain can produce. */
export const COEFFICIENT_KINDS = Object.freeze({
  SIGNED: 'signed',
  UNSIGNED: 'unsigned',
});

/** Machine-readable unmeasured reasons. */
export const INVERTER_REASONS = Object.freeze({
  NO_COEFFICIENT: 'no_measurable_coefficient',
  OUT_OF_RANGE: 'coefficient_out_of_range',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * The coefficient chain of ONE entry. Returns the frozen
 * {coefficient, kind} verdict or the frozen {reason} rejection —
 * never a coerced number.
 */
export function coefficientOf(entry) {
  if (!entry || typeof entry !== 'object') {
    return Object.freeze({ reason: INVERTER_REASONS.NO_COEFFICIENT });
  }
  // 1. The declared signed correlation: present -> must be valid.
  if (entry.correlation !== undefined && entry.correlation !== null) {
    const value = finite(entry.correlation);
    if (value === null || value < -1 || value > 1) {
      return Object.freeze({ reason: INVERTER_REASONS.OUT_OF_RANGE });
    }
    return Object.freeze({ coefficient: value, kind: COEFFICIENT_KINDS.SIGNED });
  }
  // 2. The unsigned chain (task 60), range-checked to [0, 1].
  const value = finite(connectionScoreOf(entry));
  if (value === null) {
    return Object.freeze({ reason: INVERTER_REASONS.NO_COEFFICIENT });
  }
  if (value < 0 || value > 1) {
    return Object.freeze({ reason: INVERTER_REASONS.OUT_OF_RANGE });
  }
  return Object.freeze({ coefficient: value, kind: COEFFICIENT_KINDS.UNSIGNED });
}

const compare = (a, b) =>
  b.divergence - a.divergence
  || (b.popularity ?? -1) - (a.popularity ?? -1)
  || a.name.localeCompare(b.name)
  || String(a.id ?? '').localeCompare(String(b.id ?? ''));

/**
 * Invert a taste vector: annotate every measurable entry with its
 * divergence, order the pool and apply the selection strategy.
 *
 * @param {ReadonlyArray<object>} entries candidate rows (the
 *        flattened Qloo expansion or any coefficient-carrying rows).
 * @param {object} [options] { take (1..1000, default 10),
 *        strategy ('lowest' | 'negative', default 'lowest') }.
 * @returns {Readonly<object>} { version, strategy, coefficientDomain,
 *          records (ALL measurable, sorted), selected (the strategy
 *          cut), stats } — frozen.
 */
export function invertTasteVector(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError('invertTasteVector: entries must be an array');
  }
  const take = options.take ?? INVERTER_DEFAULTS.take;
  if (!Number.isInteger(take) || take < 1 || take > 1000) {
    throw new TypeError('invertTasteVector: take must be an integer in 1..1000');
  }
  const strategy = options.strategy ?? INVERTER_DEFAULTS.strategy;
  if (!Object.values(INVERTER_STRATEGIES).includes(strategy)) {
    throw new TypeError(
      `invertTasteVector: strategy must be one of ${Object.values(INVERTER_STRATEGIES).join(' | ')}`
    );
  }

  const records = [];
  const reasons = {};
  let signed = 0;
  let unsigned = 0;
  let negatives = 0;
  let zeros = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const verdict = coefficientOf(entry);
    if ('reason' in verdict) {
      if (verdict.reason !== INVERTER_REASONS.NO_COEFFICIENT) {
        reasons[verdict.reason] = (reasons[verdict.reason] ?? 0) + 1;
      }
      continue;
    }
    const { coefficient, kind } = verdict;
    const divergence = round12(
      kind === COEFFICIENT_KINDS.SIGNED ? (1 - coefficient) / 2 : 1 - coefficient
    );
    if (kind === COEFFICIENT_KINDS.SIGNED) {
      signed += 1;
      if (coefficient < 0) negatives += 1;
    } else {
      unsigned += 1;
      if (coefficient === 0) zeros += 1;
    }
    records.push(Object.freeze({
      id: entry.id ?? null,
      name: typeof entry.name === 'string' ? entry.name : '',
      subtype: nonEmptyString(entry.subtype),
      domain: nonEmptyString(entry.domain),
      coefficient: round12(coefficient),
      coefficientKind: kind,
      divergence,
      divergencePercent: Math.round(divergence * 100),
      negativeCorrelation: kind === COEFFICIENT_KINDS.SIGNED
        ? coefficient < 0 : null,
      zeroAffinity: kind === COEFFICIENT_KINDS.UNSIGNED
        ? coefficient === 0 : null,
      popularity: finite(entry.popularity),
    }));
  }
  records.sort(compare);

  const selected = strategy === INVERTER_STRATEGIES.NEGATIVE
    ? records.filter((record) => record.negativeCorrelation === true).slice(0, take)
    : records.slice(0, take);

  const measurable = records.length;
  return Object.freeze({
    version: TASTE_INVERTER_VERSION,
    strategy,
    coefficientDomain: measurable === 0
      ? 'empty'
      : (signed > 0 && unsigned > 0 ? 'mixed' : (signed > 0 ? 'signed' : 'unsigned')),
    records: Object.freeze(records),
    selected: Object.freeze(selected),
    stats: Object.freeze({
      input: entries.length,
      measurable,
      unmeasurable: entries.length - measurable,
      signed,
      unsigned,
      negatives,
      zeros,
      outOfRange: reasons[INVERTER_REASONS.OUT_OF_RANGE] ?? 0,
      selected: selected.length,
    }),
  });
}

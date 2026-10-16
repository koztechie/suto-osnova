/**
 * UniquenessCoefficient tests (task 57) — pins the information-
 * theoretic uniqueness contract: exact landmark values (U(1e-k) = k/6),
 * monotonicity, raw surprisal bits, honest handling of missing/zero/
 * invalid popularity, tier boundaries, batch annotation stats,
 * validation, frozen float-stable outputs and composition with the
 * task-56 LongTailFilter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uniquenessCoefficient,
  annotateUniqueness,
  UNIQUENESS_DEFAULTS,
  UNIQUENESS_TIERS,
  UNIQUENESS_REASONS,
} from '../src/engine/UniquenessCoefficient.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';

const MAX_BITS = Math.log2(1 / UNIQUENESS_DEFAULTS.minProbability);

test('landmark math: exact fractions at decimal percentiles', () => {
  assert.equal(uniquenessCoefficient(1).coefficient, 0, 'universally known -> zero');
  assert.equal(uniquenessCoefficient(1).tier, 'mainstream');

  // U(10^-k) = k/6 for minProbability 1e-6 — the log does the work
  // (rounded to 6 decimals for float-stable contracts).
  assert.ok(Math.abs(uniquenessCoefficient(0.1).coefficient - 1 / 6) < 1e-6);
  assert.ok(Math.abs(uniquenessCoefficient(0.01).coefficient - 1 / 3) < 1e-6);
  assert.equal(uniquenessCoefficient(0.001).coefficient, 0.5);
  assert.equal(uniquenessCoefficient(1e-6).coefficient, 1, 'support floor -> max');
  assert.equal(uniquenessCoefficient(1e-6).tier, 'microtail');
});

test('monotonicity: more famous, less unique — always', () => {
  const samples = [1, 0.5, 0.2, 0.1, 0.05, 0.01, 0.005, 0.001, 1e-5, 1e-6];
  const values = samples.map((p) => uniquenessCoefficient(p).coefficient);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] > values[i - 1], `U(${samples[i]}) > U(${samples[i - 1]})`);
  }
});

test('raw surprisal bits are reported unnormalized', () => {
  assert.equal(uniquenessCoefficient(0.25).bits, 2, '-log2(0.25) = 2 bits');
  assert.equal(uniquenessCoefficient(0.5).bits, 1);
  assert.equal(uniquenessCoefficient(1).bits, 0);
  assert.ok(Math.abs(uniquenessCoefficient(1e-6).bits - MAX_BITS) < 1e-6, 'rounded to 6 decimals');
});

test('input forms: raw numbers and candidate objects both accepted', () => {
  assert.equal(uniquenessCoefficient({ popularity: 0.001 }).coefficient, 0.5);
  assert.equal(uniquenessCoefficient(0.001).coefficient, 0.5);
  assert.equal(uniquenessCoefficient({ name: 'No Popularity' }).reason, UNIQUENESS_REASONS.NO_POPULARITY);
});

test('honest data handling: missing, zero and invalid popularity', () => {
  // Missing -> never silently scored.
  const missing = uniquenessCoefficient({});
  assert.equal(missing.coefficient, null);
  assert.equal(missing.bits, null);
  assert.equal(missing.tier, null);
  assert.equal(missing.reason, UNIQUENESS_REASONS.NO_POPULARITY);
  assert.equal(uniquenessCoefficient(null).reason, UNIQUENESS_REASONS.NO_POPULARITY);
  assert.equal(uniquenessCoefficient('x').reason, UNIQUENESS_REASONS.NO_POPULARITY);

  // Zero (dropped by the gateway) -> rarer than measurable -> max.
  const zero = uniquenessCoefficient(0);
  assert.equal(zero.coefficient, 1);
  assert.equal(zero.tier, 'microtail');
  assert.equal(zero.reason, UNIQUENESS_REASONS.ZERO_POPULARITY);

  // Out-of-range -> malformed upstream, reported not guessed.
  for (const bad of [-0.1, 1.5]) {
    const result = uniquenessCoefficient(bad);
    assert.equal(result.coefficient, null);
    assert.equal(result.reason, UNIQUENESS_REASONS.INVALID_POPULARITY);
  }
});

test('tier boundaries are inclusive at the band minimum', () => {
  const atBand = (coefficient) =>
    uniquenessCoefficient(2 ** (-coefficient * MAX_BITS)).tier;

  assert.equal(atBand(0.75), 'microtail', '0.75 inclusive');
  assert.equal(atBand(0.7499), 'long_tail');
  assert.equal(atBand(0.35), 'long_tail', '0.35 inclusive');
  assert.equal(atBand(0.3499), 'midstream');
  assert.equal(atBand(0.15), 'midstream', '0.15 inclusive');
  assert.equal(atBand(0.1499), 'mainstream');
  assert.equal(UNIQUENESS_TIERS.length, 4);
});

test('validation: bad options are TypeErrors', () => {
  for (const bad of [{ minProbability: 0 }, { minProbability: 1.5 }, { minProbability: 'x' }, { minProbability: NaN }]) {
    assert.throws(() => uniquenessCoefficient(0.5, bad), TypeError, JSON.stringify(bad));
    assert.throws(() => annotateUniqueness([], bad), TypeError, JSON.stringify(bad));
  }
});

test('annotateUniqueness: batch annotation, order preserved, stats', () => {
  const entries = annotateUniqueness([
    { id: 'hit', name: 'Blockbuster', popularity: 0.999 },
    { id: 'classic', name: 'Cult Classic', popularity: 0.001 },
    { id: 'obscure', name: 'Obscure Gem', popularity: 1e-5 },
    { id: 'nodata', name: 'No Data' },
  ]);

  assert.deepEqual(entries.entries.map((e) => e.id), ['hit', 'classic', 'obscure', 'nodata']);
  assert.equal(entries.entries[0].uniqueness.tier, 'mainstream');
  assert.equal(entries.entries[1].uniqueness.coefficient, 0.5);
  assert.equal(entries.entries[1].uniqueness.tier, 'long_tail');
  assert.equal(entries.entries[2].uniqueness.tier, 'microtail');
  assert.equal(entries.entries[3].uniqueness.coefficient, null, 'unmeasured stays unmeasured');

  const expectedMean =
    Math.round(
      ((entries.entries[0].uniqueness.coefficient +
        entries.entries[1].uniqueness.coefficient +
        entries.entries[2].uniqueness.coefficient) /
        3) *
        1e6
    ) / 1e6;
  assert.deepEqual({ ...entries.stats }, {
    count: 4,
    measured: 3,
    unmeasured: 1,
    tiers: { microtail: 1, long_tail: 1, midstream: 0, mainstream: 1 },
    meanCoefficient: expectedMean,
  });
});

test('outputs are frozen, float-stable through JSON and deterministic', () => {
  const data = () => [
    { id: 'a', popularity: 0.001 },
    { id: 'b', popularity: 0.4 },
  ];

  const result = annotateUniqueness(data());
  assert.deepEqual(annotateUniqueness(data()), result, 'cross-run identical');

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.entries));
  assert.ok(Object.isFrozen(result.entries[0]));
  assert.ok(Object.isFrozen(result.entries[0].uniqueness));
  assert.ok(Object.isFrozen(result.stats));
  assert.throws(() => {
    result.entries[0].uniqueness.coefficient = 0;
  }, TypeError);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(result)))),
    'round6 keeps JSON stable'
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)).entries[0].uniqueness.coefficient, 0.5);
});

test('empty and degenerate inputs degrade safely', () => {
  const empty = annotateUniqueness([]);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual({ ...empty.stats }, {
    count: 0,
    measured: 0,
    unmeasured: 0,
    tiers: { microtail: 0, long_tail: 0, midstream: 0, mainstream: 0 },
    meanCoefficient: null,
  });
  assert.deepEqual(annotateUniqueness(undefined).entries, []);
  assert.deepEqual(annotateUniqueness([null, 'x', 42]).entries, []);
});

test('composition: LongTailFilter survivors carry uniqueness into the dossier', () => {
  const filtered = filterLongTail([
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.8, popularity: 0.25 },
    { id: 'E2', name: 'Cult Deep Cut', affinity: 0.75, popularity: 0.002 },
    { id: 'E3', name: 'Blockbuster', affinity: 0.72, popularity: 0.95 },
  ]);

  const annotated = annotateUniqueness(filtered.kept);

  assert.deepEqual(annotated.entries.map((e) => e.name), ['Obscure Auteur', 'Cult Deep Cut']);
  assert.equal(annotated.entries[0].uniqueness.coefficient, uniquenessCoefficient(0.25).coefficient);
  // The deep cut is the rarest survivor — the pipeline's whole point.
  assert.ok(
    annotated.entries[1].uniqueness.coefficient > annotated.entries[0].uniqueness.coefficient,
    'lower popularity -> higher uniqueness among survivors'
  );
  assert.equal(annotated.entries[1].uniqueness.tier, 'long_tail', 'U(0.002) ~= 0.45');
});

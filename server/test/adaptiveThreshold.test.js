/**
 * AdaptiveThreshold tests (task 67) — pins the automatic affinity
 * threshold relief for rare/ultra-niche entities: the schedule math
 * (rarity buys relief, never above base, floor-bounded), the no-proof-
 * no-relief honesty rule, the legacy fixed-gate compat pin (relief 0),
 * pass/fail verdicts with margins, the auditable batch ledger, frozen
 * deterministic outputs and composition with task 56 survivors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  affinityThreshold,
  passesThreshold,
  filterByAdaptiveThreshold,
  THRESHOLD_DEFAULTS,
  THRESHOLD_REASONS,
} from '../src/engine/AdaptiveThreshold.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const U = (p) => uniquenessCoefficient(p).coefficient;

test('the schedule: rarity buys relief, never above base', () => {
  // Mainstream: no relief, base threshold.
  assert.equal(affinityThreshold(1).threshold, 0.65);
  assert.equal(affinityThreshold(1).relief, 0);

  // Exact landmarks: T = 0.65 * (1 - 0.5 * U), rounded to 6 decimals.
  assert.equal(affinityThreshold(1e-3).threshold, round6(0.65 * (1 - 0.5 * 0.5)), 'U(1e-3) = 0.5');
  assert.equal(affinityThreshold(1e-6).threshold, 0.325, 'full relief at the support floor');
  assert.equal(affinityThreshold(1e-6).tier, 'microtail');

  // Monotone: rarer -> lower threshold.
  const chain = [1, 0.5, 0.2, 0.05, 0.005, 1e-6].map(
    (p) => affinityThreshold(p).threshold
  );
  for (let i = 1; i < chain.length; i += 1) {
    assert.ok(chain[i] < chain[i - 1], `threshold must decrease at step ${i}`);
  }

  // Never above base, candidate-object input accepted.
  assert.ok(affinityThreshold({ popularity: 0.99 }).threshold <= 0.65);
});

test('no proof, no relief: missing popularity keeps the base gate', () => {
  const unproven = affinityThreshold({});
  assert.equal(unproven.threshold, 0.65);
  assert.equal(unproven.rarity, null);
  assert.equal(unproven.relief, 0);
  assert.equal(unproven.tier, null);
  assert.equal(affinityThreshold(null).threshold, 0.65);
});

test('the floor: rarity cannot excuse a noise-level threshold', () => {
  const floored = affinityThreshold(1e-6, { relief: 1, minThreshold: 0.2 });
  assert.equal(floored.threshold, 0.2);
  assert.equal(floored.floorApplied, true);
  assert.equal(affinityThreshold(1e-6).floorApplied, false, 'defaults stay above the floor');
});

test('compat pin: relief 0 reproduces the legacy fixed gate', () => {
  const fixed = affinityThreshold(1e-6, { relief: 0 });
  assert.equal(fixed.threshold, THRESHOLD_DEFAULTS.base, 'no rarity discount');
  assert.equal(fixed.relief, 0);
});

test('passesThreshold: rare passes, mainstream fails, margins exact', () => {
  const rare = passesThreshold({ affinity: 0.4, popularity: 1e-6 });
  assert.equal(rare.pass, true);
  assert.equal(rare.threshold, 0.325);
  assert.equal(rare.margin, 0.075);
  assert.equal(rare.reason, null);

  const mainstream = passesThreshold({ affinity: 0.4, popularity: 0.95 });
  assert.equal(mainstream.pass, false);
  assert.equal(mainstream.reason, THRESHOLD_REASONS.BELOW_THRESHOLD);
  assert.equal(mainstream.threshold, round6(0.65 * (1 - 0.5 * U(0.95))));
  assert.ok(mainstream.margin < 0);

  // The SAME affinity flips verdict purely on rarity — the task in one pin.
  assert.ok(rare.pass && !mainstream.pass);

  const noAffinity = passesThreshold({ popularity: 0.5 });
  assert.equal(noAffinity.pass, false);
  assert.equal(noAffinity.reason, THRESHOLD_REASONS.NO_AFFINITY);
  assert.equal(noAffinity.affinity, null);

  // correlation alias (task 52).
  assert.equal(passesThreshold({ correlation: 0.7, popularity: 1e-6 }).pass, true);
});

test('batch filter: ledger, stats, order preserved', () => {
  const result = filterByAdaptiveThreshold([
    { id: 'rare', name: 'Rare Match', affinity: 0.4, popularity: 1e-6 },
    { id: 'mainstream', name: 'Famous Miss', affinity: 0.4, popularity: 0.95 },
    { id: 'blind', name: 'No Score' },
  ]);

  assert.deepEqual(result.kept.map((e) => e.id), ['rare']);
  assert.deepEqual(result.kept[0].threshold, {
    affinity: 0.4,
    threshold: 0.325,
    margin: 0.075,
    rarity: 1,
  });

  assert.deepEqual(result.rejected.map((e) => e.id), ['mainstream', 'blind']);
  assert.deepEqual(result.rejected.map((e) => e.reason), [
    THRESHOLD_REASONS.BELOW_THRESHOLD,
    THRESHOLD_REASONS.NO_AFFINITY,
  ]);

  assert.deepEqual({ ...result.stats }, {
    input: 3,
    kept: 1,
    rejected: 2,
    noAffinity: 1,
    relieved: 2,
    meanRelief: round6((U(1e-6) + U(0.95)) / 2),
  });
});

test('validation, empty input, determinism and freezing', () => {
  for (const bad of [{ base: 1.5 }, { relief: -0.1 }, { minThreshold: 0.7 }]) {
    assert.throws(() => affinityThreshold(0.5, bad), TypeError, JSON.stringify(bad));
    assert.throws(() => filterByAdaptiveThreshold([], bad), TypeError);
  }

  const empty = filterByAdaptiveThreshold([]);
  assert.deepEqual(empty.kept, []);
  assert.deepEqual({ ...empty.stats }, {
    input: 0, kept: 0, rejected: 0, noAffinity: 0, relieved: 0, meanRelief: null,
  });

  const data = () => [
    { id: 'a', affinity: 0.5, popularity: 0.002 },
    { id: 'b', affinity: 0.9, popularity: 0.9 },
  ];
  assert.deepEqual(filterByAdaptiveThreshold(data()), filterByAdaptiveThreshold(data()));

  const result = filterByAdaptiveThreshold(data());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.kept[0].threshold));
  assert.ok(Object.isFrozen(result.rejected[0]));
  assert.ok(Object.isFrozen(result.stats));
  assert.equal(JSON.parse(JSON.stringify(result)).stats.input, 2, 'serializable');
});

test('composition: task-56 survivors then the adaptive gate', () => {
  const survivors = filterLongTail([
    { id: 'niche', name: 'Niche Match', affinity: 0.55, popularity: 0.001 },
    { id: 'famous', name: 'Famous Match', affinity: 0.55, popularity: 0.6 },
  ]).kept;
  assert.equal(survivors.length, 2, 'both survive the Via Negativa cut');

  const gated = filterByAdaptiveThreshold(survivors);

  // Both carried a positive excess, but only the niche one clears the
  // RELIEVED gate (threshold 0.4875); the famous one faced the near-
  // base threshold and missed it.
  assert.deepEqual(gated.kept.map((e) => e.id), ['niche']);
  assert.deepEqual(gated.rejected.map((e) => e.id), ['famous']);
  assert.ok(gated.kept[0].threshold.margin > 0);
  assert.ok(gated.rejected[0].margin < 0);
});

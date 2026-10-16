/**
 * LongTailFilter tests (task 56) — pins the Via Negativa noise-cut
 * contract: excess-affinity math, the three removal rules with their
 * boundaries, protection of unknown data, the fallback valve, the
 * auditable ledger, order preservation, validation, deep-frozen
 * deterministic outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterLongTail,
  explainCut,
  excessAffinity,
  relevanceOf,
  LONG_TAIL_DEFAULTS,
  CUT_REASONS,
} from '../src/engine/LongTailFilter.js';

const c = (over = {}) => ({
  id: over.id ?? 'ID-1',
  name: over.name ?? 'Candidate',
  affinity: over.affinity,
  correlation: over.correlation,
  popularity: over.popularity,
  weight: over.weight,
});

test('relevance/excess units: affinity field, correlation alias, null-safety', () => {
  assert.equal(relevanceOf(c({ affinity: 0.8 })), 0.8);
  assert.equal(relevanceOf(c({ correlation: 0.7 })), 0.7, 'task-52 field alias');
  assert.equal(relevanceOf(c({})), null);
  assert.equal(relevanceOf(null), null);
  assert.equal(relevanceOf('x'), null);

  assert.equal(excessAffinity(c({ affinity: 0.9, popularity: 0.3 })), 0.6);
  assert.equal(excessAffinity(c({ affinity: 0.5, popularity: 0.9 })), -0.4);
  assert.ok(Math.abs(excessAffinity(c({ correlation: 0.7, popularity: 0.25 })) - 0.45) < 1e-12);
  assert.equal(excessAffinity(c({ affinity: 0.9 })), null, 'missing popularity -> no evidence');
  assert.equal(excessAffinity(c({ popularity: 0.9 })), null, 'missing affinity -> no evidence');
});

test('R3 negative_excess: relevance notably below fame', () => {
  const result = filterLongTail([
    c({ id: 'noise', affinity: 0.5, popularity: 0.9 }),
    c({ id: 'signal', affinity: 0.8, popularity: 0.3 }),
  ]);

  assert.deepEqual(result.kept.map((e) => e.id), ['signal']);
  assert.deepEqual(result.removed.map((e) => e.id), ['noise']);
  assert.equal(result.removed[0].reason, CUT_REASONS.NEGATIVE_EXCESS);
  assert.equal(result.removed[0].metrics.excess, -0.4);

  // Boundary: excess exactly at the floor is CUT (<= semantics).
  // Popularity kept BELOW the mainstream ceiling so R1 cannot fire —
  // this pins R3 alone.
  const atFloor = explainCut(c({ affinity: 0.65, popularity: 0.85 }), LONG_TAIL_DEFAULTS, 1);
  assert.deepEqual(atFloor, [CUT_REASONS.NEGATIVE_EXCESS]);
});

test('R1 mainstream_no_excess: a mega-hit must over-perform its fame', () => {
  // Famous and merely fame-proportional -> cut (fallback valve OFF so
  // the rule's effect is observable in isolation).
  const proportional = filterLongTail(
    [c({ id: 'hit', affinity: 0.99, popularity: 0.95 })],
    { keepFallback: false }
  );
  assert.deepEqual(proportional.removed.map((e) => e.reason), [CUT_REASONS.MAINSTREAM_NO_EXCESS]);
  assert.equal(proportional.kept.length, 0);

  // Famous AND over-performing by the allowance -> survives (boundary).
  const overperforming = filterLongTail([c({ id: 'gem', affinity: 1.0, popularity: 0.95 })]);
  assert.deepEqual(overperforming.kept.map((e) => e.id), ['gem']);
  assert.deepEqual(overperforming.removed, []);

  // Mid-popularity entities never trigger R1 (ceiling guard).
  const midPop = explainCut(c({ affinity: 0.5, popularity: 0.7 }), LONG_TAIL_DEFAULTS, 5);
  assert.ok(!midPop.includes(CUT_REASONS.MAINSTREAM_NO_EXCESS));
});

test('R3 precedes R1 when both match; reasons list all matches', () => {
  const reasons = explainCut(c({ affinity: 0.72, popularity: 0.95 }), LONG_TAIL_DEFAULTS, 1);
  assert.deepEqual(reasons, [CUT_REASONS.NEGATIVE_EXCESS, CUT_REASONS.MAINSTREAM_NO_EXCESS]);
});

test('R2 generic_weight: near-universal carrier share, with a pool guard', () => {
  // Pool large enough: weight .9 is generic.
  const bigPool = filterLongTail([
    c({ id: 'generic', weight: 0.9 }),
    c({ id: 'a', weight: 0.4 }),
    c({ id: 'b', weight: 0.2 }),
    c({ id: 'c', weight: 0.1 }),
  ]);
  assert.deepEqual(bigPool.removed.map((e) => e.reason), [CUT_REASONS.GENERIC_WEIGHT]);
  assert.deepEqual(bigPool.kept.map((e) => e.id), ['a', 'b', 'c']);

  // Small pool: the same weight is arithmetic, not evidence.
  const smallPool = filterLongTail([
    c({ id: 'generic', weight: 0.9 }),
    c({ id: 'other', weight: 0.1 }),
  ]);
  assert.deepEqual(smallPool.removed, [], 'pool guard blocks the rule');

  // Threshold is inclusive at exactly 0.8 in a pool of 3.
  const atThreshold = explainCut(
    c({ weight: 0.8 }),
    LONG_TAIL_DEFAULTS,
    3
  );
  assert.deepEqual(atThreshold, [CUT_REASONS.GENERIC_WEIGHT]);
});

test('unknown data is never cut by excess rules; weight still applies', () => {
  const unknown = filterLongTail([
    c({ id: 'no-data', affinity: null, popularity: 0.99 }),
  ]);
  assert.deepEqual(unknown.kept.map((e) => e.id), ['no-data'], 'absence of evidence');

  const unknownButGeneric = filterLongTail([
    c({ id: 'no-data-generic', popularity: 0.99, weight: 0.95 }),
    c({ id: 'x', weight: 0.1 }),
    c({ id: 'y', weight: 0.1 }),
    c({ id: 'z', weight: 0.1 }),
  ]);
  assert.deepEqual(
    unknownButGeneric.removed.map((e) => [e.id, e.reason]),
    [['no-data-generic', CUT_REASONS.GENERIC_WEIGHT]],
    'R2 needs no affinity'
  );
});

test('fallback valve: everything cut -> best-by-affinity survives, flagged', () => {
  const allNoise = [
    c({ id: 'a', affinity: 0.5, popularity: 0.9 }), // excess -0.4
    c({ id: 'b', affinity: 0.6, popularity: 0.95 }), // excess -0.35 -> best
  ];

  const withFallback = filterLongTail(allNoise);
  assert.deepEqual(withFallback.kept.map((e) => e.id), ['b']);
  assert.equal(withFallback.kept[0].longTail.fallback, true, 'honestly flagged');
  assert.deepEqual(withFallback.removed.map((e) => e.id), ['a'], 'ledger keeps the rest');
  assert.equal(withFallback.stats.fellBack, true);
  assert.equal(withFallback.stats.kept, 1);
  assert.equal(withFallback.stats.removed, 1);

  const purist = filterLongTail(allNoise, { keepFallback: false });
  assert.deepEqual(purist.kept, []);
  assert.equal(purist.stats.fellBack, false);
  assert.equal(purist.stats.removed, 2);
});

test('order preservation, stats math and ledger shape', () => {
  const result = filterLongTail([
    c({ id: 'keep1', affinity: 0.9, popularity: 0.2 }),
    c({ id: 'cut1', affinity: 0.3, popularity: 0.95 }),
    c({ id: 'keep2', affinity: 0.7, popularity: 0.1 }),
    c({ id: 'cut2', weight: 1, popularity: 0.1 }),
    c({ id: 'keep3', correlation: 0.8, popularity: 0.2 }),
  ]);

  assert.deepEqual(result.kept.map((e) => e.id), ['keep1', 'keep2', 'keep3'], 'input order kept');
  assert.deepEqual(result.removed.map((e) => e.id), ['cut1', 'cut2']);
  assert.deepEqual({ ...result.stats }, { input: 5, kept: 3, removed: 2, keptShare: 0.6, fellBack: false });

  const cut2 = result.removed[1];
  assert.equal(cut2.reason, CUT_REASONS.GENERIC_WEIGHT);
  assert.deepEqual([...cut2.reasons], [CUT_REASONS.GENERIC_WEIGHT]);
  assert.deepEqual({ ...cut2.metrics }, { affinity: null, popularity: 0.1, excess: null, weight: 1 });
  assert.equal(result.kept[0].longTail.excessAffinity, 0.7, 'diagnostics on survivors');
});

test('validation: bad options are TypeErrors (programming errors)', () => {
  const bad = [
    { mainstreamCeiling: 1.5 },
    { mainstreamExcessAllowance: -0.1 },
    { excessAffinityFloor: -2 },
    { genericWeightFloor: 2 },
    { minPoolForWeightRule: 0 },
    { minPoolForWeightRule: 1.5 },
    { keepFallback: 'yes' },
  ];
  for (const options of bad) {
    assert.throws(() => filterLongTail([], options), TypeError, JSON.stringify(options));
  }
  assert.throws(() => filterLongTail([], { mainstreamCeiling: NaN }), TypeError);
});

test('empty and malformed inputs degrade safely', () => {
  const empty = filterLongTail([]);
  assert.deepEqual({ ...empty.stats }, { input: 0, kept: 0, removed: 0, keptShare: 0, fellBack: false });

  const messy = filterLongTail([null, 'x', 42, c({ id: 'real', affinity: 0.5, popularity: 0.1 })]);
  assert.deepEqual(messy.kept.map((e) => e.id), ['real']);
  assert.equal(messy.stats.input, 1, 'non-objects filtered out');

  assert.deepEqual(filterLongTail(undefined).kept, []);
});

test('outputs are deeply frozen, serializable and deterministic', () => {
  const data = () => [
    c({ id: 'keep', affinity: 0.9, popularity: 0.2 }),
    c({ id: 'cut', affinity: 0.4, popularity: 0.9 }),
  ];

  const result = filterLongTail(data());
  assert.deepEqual(filterLongTail(data()), result, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.kept));
  assert.ok(Object.isFrozen(result.kept[0]));
  assert.ok(Object.isFrozen(result.kept[0].longTail));
  assert.ok(Object.isFrozen(result.removed[0].reasons));
  assert.ok(Object.isFrozen(result.removed[0].metrics));
  assert.ok(Object.isFrozen(result.stats));
  assert.throws(() => {
    result.kept[0].longTail.excessAffinity = 9;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(result)).stats.kept, 1, 'serializable');
});

test('realistic extractor mix: tags with weight + entities with affinity', () => {
  const profile = filterLongTail([
    // Distinctive long-tail tag (low carrier share).
    { id: 'urn:tag:genre:media:slow_cinema', name: 'Slow Cinema', weight: 0.2, popularity: 0.3 },
    // Generic descriptor carried by nearly everyone.
    { id: 'urn:tag:genre:media:drama', name: 'Drama', weight: 0.95, popularity: 0.9 },
    // Correlated long-tail entity: relevance far beyond fame.
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.8, popularity: 0.25 },
    // Mainstream hit dragged in by fame alone (excess -0.02: R1, not R3).
    { id: 'E2', name: 'Blockbuster', affinity: 0.93, popularity: 0.95 },
  ]);

  assert.deepEqual(profile.kept.map((e) => e.name), ['Slow Cinema', 'Obscure Auteur']);
  assert.deepEqual(profile.removed.map((e) => e.name), ['Drama', 'Blockbuster']);
  assert.deepEqual(profile.removed.map((e) => e.reason), [
    CUT_REASONS.GENERIC_WEIGHT,
    CUT_REASONS.MAINSTREAM_NO_EXCESS,
  ]);
});

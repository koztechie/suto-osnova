/**
 * PopClicheFilter tests (task 58) — pins the automatic top-15% mass
 * recommendation cut: the banality index math (fame minus justified
 * specificity), quantile cut math (floor + felt minimum), zero-banality
 * and unmeasured protection, tie determinism, the quantile-ordered
 * ledger with thresholdBanality, validation, frozen outputs and
 * composition with the task-56 LongTailFilter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cutMassCliches,
  banalityIndex,
  CLICHE_DEFAULTS,
  CLICHE_REASONS,
} from '../src/engine/PopClicheFilter.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;

const c = (over = {}) => ({
  id: over.id ?? 'ID-1',
  name: over.name ?? 'Candidate',
  popularity: over.popularity,
  affinity: over.affinity,
});

/** n entries whose banality equals their popularity (excess = 0). */
const proportional = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `E${String(i + 1).padStart(2, '0')}`,
    name: `Entity ${i + 1}`,
    popularity: (i + 1) / (n + 1),
    affinity: (i + 1) / (n + 1),
  }));

test('banality index: fame minus justified specificity', () => {
  // Fame fully proportional to relevance -> fully banal.
  assert.equal(banalityIndex(c({ popularity: 0.9, affinity: 0.9 })), 0.9);
  // Over-performing hit loses banality points.
  assert.equal(banalityIndex(c({ popularity: 0.9, affinity: 1.0 })), 0.8);
  // Specific entity: relevance >= twice the fame -> zero banality
  // (0.9 >= 2 * 0.4); at 2x minus a hair it is merely small.
  assert.equal(banalityIndex(c({ popularity: 0.4, affinity: 0.9 })), 0);
  assert.equal(banalityIndex(c({ popularity: 0.5, affinity: 0.9 })), 0.1);
  // Under-performing fame is maximally banal (uncapped above):
  // 0.9 - (0.5 - 0.9) = 1.3.
  assert.equal(banalityIndex(c({ popularity: 0.9, affinity: 0.5 })), 1.3);
  // Missing affinity -> bare popularity (unmeasured specificity).
  assert.equal(banalityIndex(c({ popularity: 0.7 })), 0.7);
  // Missing popularity -> unmeasurable.
  assert.equal(banalityIndex(c({ affinity: 0.9 })), null);
  assert.equal(banalityIndex(null), null);
});

test('default 15%: exactly floor(n * 0.15) most-banal entries cut', () => {
  const result = cutMassCliches(proportional(20));

  assert.equal(result.stats.cutCount, 3, 'floor(20 * 0.15) = 3');
  assert.deepEqual(
    result.removed.map((e) => e.id),
    ['E20', 'E19', 'E18'],
    'ledger in quantile order (most banal first)'
  );
  assert.deepEqual(
    result.removed.map((e) => e.quantileRank),
    [1, 2, 3]
  );
  assert.equal(result.kept.length, 17);
  assert.deepEqual(
    result.kept.map((e) => e.id).slice(-1),
    ['E17'],
    'kept stays in input order'
  );
  assert.equal(result.stats.thresholdBanality, round6(18 / 21), 'lowest cut banality');
  assert.deepEqual({ ...result.stats }, {
    input: 20,
    kept: 17,
    removed: 3,
    cutRate: CLICHE_DEFAULTS.cutRate,
    cutCount: 3,
    thresholdBanality: round6(18 / 21),
    unmeasured: 0,
    zeroBanality: 0,
    protectedFallback: 0,
  });
});

test('cutRate override and the felt-minimum valve', () => {
  assert.equal(cutMassCliches(proportional(20), { cutRate: 0.5 }).stats.cutCount, 10);

  // 4 items: floor(0.6) = 0 -> the default valve still cuts 1.
  const felt = cutMassCliches(proportional(4));
  assert.equal(felt.stats.cutCount, 1);
  assert.deepEqual(felt.removed.map((e) => e.id), ['E04']);

  // Valve off: the pure floor applies (nothing below 15% of 4).
  const purist = cutMassCliches(proportional(4), { alwaysCutAtLeastOne: false });
  assert.equal(purist.stats.cutCount, 0);
  assert.deepEqual(purist.removed, []);

  // cutRate 0 never cuts.
  assert.equal(cutMassCliches(proportional(20), { cutRate: 0 }).stats.cutCount, 0);
});

test('zero banality is PROVEN not-a-stamp: protected at any cutRate', () => {
  const specific = c({ id: 'deep', name: 'Deep Cut', popularity: 0.2, affinity: 0.95 });
  const result = cutMassCliches([specific, { ...specific, id: 'deep2' }], { cutRate: 1 });

  assert.equal(result.stats.cutCount, 0, 'index 0 proves specificity');
  assert.equal(result.stats.zeroBanality, 2);
  assert.deepEqual(result.removed, []);
  assert.equal(result.kept[0].cliche.banality, 0);
});

test('ties break by input order: earlier entries cut first (deterministic)', () => {
  const tied = Array.from({ length: 5 }, (_, i) => ({
    id: `T${i + 1}`,
    name: `Tied ${i + 1}`,
    popularity: 0.8,
    affinity: 0.8,
  }));

  const result = cutMassCliches(tied, { cutRate: 0.6 });
  assert.equal(result.stats.cutCount, 3);
  assert.deepEqual(result.removed.map((e) => e.id), ['T1', 'T2', 'T3']);
});

test('unmeasured popularity is protected and counted', () => {
  const list = [
    c({ id: 'no-pop-a', affinity: 0.9 }),
    c({ id: 'no-pop-b', affinity: 0.1 }),
    c({ id: 'banal', popularity: 0.95, affinity: 0.4 }),
    c({ id: 'mid', popularity: 0.5, affinity: 0.5 }),
  ];

  const result = cutMassCliches(list, { cutRate: 1 });

  assert.deepEqual(result.removed.map((e) => e.id), ['banal', 'mid'], 'only measurable cut');
  assert.deepEqual(result.kept.map((e) => e.id), ['no-pop-a', 'no-pop-b']);
  assert.equal(result.stats.unmeasured, 2);
  assert.equal(result.stats.cutCount, 2);

  // A list of only unmeasured entries loses nothing.
  const allUnmeasured = cutMassCliches([c({ id: 'x' }), c({ id: 'y' })], { cutRate: 1 });
  assert.equal(allUnmeasured.stats.cutCount, 0);
  assert.equal(allUnmeasured.stats.thresholdBanality, null);
});

test('ledger metrics and kept diagnostics are complete and frozen', () => {
  const result = cutMassCliches([
    c({ id: 'stamp', name: 'Pop Stamp', popularity: 0.9, affinity: 0.7 }),
    c({ id: 'keeper', name: 'Keeper', popularity: 0.3, affinity: 0.8 }),
  ]);

  const stamp = result.removed[0];
  assert.equal(stamp.reason, CLICHE_REASONS.TOP_BANALITY_QUANTILE);
  assert.deepEqual({ ...stamp.metrics }, {
    popularity: 0.9,
    affinity: 0.7,
    excess: -0.2,
    banality: 1.1,
  });

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.kept));
  assert.ok(Object.isFrozen(result.kept[0]));
  assert.ok(Object.isFrozen(result.kept[0].cliche));
  assert.ok(Object.isFrozen(result.removed[0].metrics));
  assert.ok(Object.isFrozen(result.stats));
  assert.equal(result.kept[0].cliche.banality, 0, 'specific keeper annotated');
  assert.throws(() => {
    result.kept[0].cliche.banality = 1;
  }, TypeError);
});

test('composition: LongTailFilter survivors then the 15% quantile cut', () => {
  const filtered = filterLongTail([
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.8, popularity: 0.25 },
    { id: 'E2', name: 'Cult Deep Cut', affinity: 0.75, popularity: 0.002 },
    { id: 'E3', name: 'Blockbuster', affinity: 0.72, popularity: 0.95 },
  ]);

  const cut = cutMassCliches(filtered.kept);

  // Both survivors are provably specific (banality 0) -> the quantile
  // cut removes nothing more: Via Negativa already did the work.
  assert.equal(cut.stats.cutCount, 0);
  assert.deepEqual(cut.kept.map((e) => e.name), ['Obscure Auteur', 'Cult Deep Cut']);
  assert.ok(cut.kept.every((e) => e.cliche.banality === 0));
});

test('validation, degenerate inputs, determinism', () => {
  for (const bad of [{ cutRate: 1.5 }, { cutRate: -0.1 }, { cutRate: 'x' }, { alwaysCutAtLeastOne: 'yes' }]) {
    assert.throws(() => cutMassCliches([], bad), TypeError, JSON.stringify(bad));
  }

  const empty = cutMassCliches([]);
  assert.deepEqual({ ...empty.stats }, {
    input: 0, kept: 0, removed: 0, cutRate: 0.15, cutCount: 0,
    thresholdBanality: null, unmeasured: 0, zeroBanality: 0, protectedFallback: 0,
  });
  assert.deepEqual(cutMassCliches(undefined).kept, []);
  assert.deepEqual(cutMassCliches([null, 'x', 42]).kept, []);

  const data = () => proportional(7);
  assert.deepEqual(cutMassCliches(data()), cutMassCliches(data()), 'cross-run identical');
  assert.equal(cutMassCliches(data()).stats.cutCount, 1, 'floor(7 * 0.15) = 1, felt');
  assert.equal(
    JSON.parse(JSON.stringify(cutMassCliches(data()))).stats.cutCount,
    1,
    'serializable'
  );
});

test('composition: a longTail FALLBACK survivor is protected from the 15% cut', () => {
  // Everything was mainstream -> longTail kept top-K as fallbacks; the
  // relative cut must NOT undo that and empty the section (the two
  // filters otherwise compound to zero on live, mainstream-biased data).
  const fallbacks = [
    { id: 'f1', name: 'F1', affinity: 0.91, popularity: 0.99, longTail: { excessAffinity: -0.08, fallback: true } },
    { id: 'f2', name: 'F2', affinity: 0.92, popularity: 0.98, longTail: { excessAffinity: -0.06, fallback: true } },
  ];
  const result = cutMassCliches(fallbacks);
  assert.equal(result.stats.protectedFallback, 2, 'both counted as protected');
  assert.equal(result.stats.cutCount, 0, 'nothing is cuttable');
  assert.equal(result.kept.length, 2, 'the section is NOT emptied');
  assert.deepEqual(result.removed, [], 'empty removal ledger');
});

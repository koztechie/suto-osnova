/**
 * TasteInverter gate (task 95) — the taste-vector inversion
 * algorithm:
 *   - the coefficient chain (declared signed `correlation` first,
 *     then the unsigned task-60 chain; range checks; corruption
 *     rejected, never salvaged);
 *   - BOTH divergence conventions (signed (1-c)/2, unsigned 1-a),
 *     bounded to [0, 1], no cross-coercion;
 *   - selection strategies ('lowest' take-cut vs 'negative' — only
 *     proven signed negatives, an honest empty on unsigned-only
 *     pools);
 *   - ordering (divergence DESC, popularity DESC, name, id), stats
 *     and coefficientDomain pins;
 *   - the AntithesisMode integration (signed rows -> the
 *     negative_correlation tier; the task-94 report shape intact).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'taste-inverter-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  invertTasteVector, coefficientOf,
  INVERTER_STRATEGIES, COEFFICIENT_KINDS, INVERTER_REASONS,
} = await import('../src/engine/TasteInverter.js');
const {
  buildAntithesisBlock, renderAntithesisReport, ANTITHESIS_TIERS,
} = await import('../src/modes/AntithesisMode.js');

test('signed convention: divergence = (1 - c) / 2, negative flags', () => {
  const result = invertTasteVector([
    { id: 'a', name: 'Agree', correlation: 0.9 },
    { id: 'b', name: 'Indifferent', correlation: 0 },
    { id: 'c', name: 'Opposed', correlation: -0.8, popularity: 0.2 },
    { id: 'd', name: 'Max Opposed', correlation: -1 },
  ]);

  assert.equal(result.coefficientDomain, 'signed');
  assert.deepEqual(result.records.map((r) => r.name),
    ['Max Opposed', 'Opposed', 'Indifferent', 'Agree']);
  assert.deepEqual(result.records.map((r) => r.divergencePercent),
    [100, 90, 50, 5]);
  assert.deepEqual(result.records.map((r) => r.coefficientKind),
    Array(4).fill(COEFFICIENT_KINDS.SIGNED));
  assert.deepEqual(result.records.map((r) => r.negativeCorrelation),
    [true, true, false, false], 'c < 0 is proven negative; c = 0 is not');
  assert.deepEqual(result.records.map((r) => r.zeroAffinity),
    Array(4).fill(null), 'zeroAffinity is honestly null on signed rows');
  assert.equal(result.stats.signed, 4);
  assert.equal(result.stats.negatives, 2);
  assert.equal(result.stats.zeros, 0);
});

test('unsigned convention: divergence = 1 - a, zero proven not negative', () => {
  const result = invertTasteVector([
    { id: 'z', name: 'Zero', affinity: 0 },
    { id: 'w', name: 'Weak', affinity: 0.3 },
    { id: 's', name: 'Strong', affinity: 1 },
  ]);

  assert.equal(result.coefficientDomain, 'unsigned');
  assert.deepEqual(result.records.map((r) => r.name), ['Zero', 'Weak', 'Strong']);
  assert.deepEqual(result.records.map((r) => r.divergencePercent), [100, 70, 0]);
  assert.equal(result.records[0].zeroAffinity, true, 'affinity 0 is a proven zero');
  assert.deepEqual(result.records.map((r) => r.negativeCorrelation),
    [null, null, null], 'absence of negatives is never claimed as opposition');
  assert.equal(result.stats.zeros, 1);
  assert.equal(result.stats.negatives, 0);
});

test('the coefficient chain: priority, ranges, corruption', () => {
  assert.deepEqual({ ...coefficientOf({ correlation: -0.5, affinity: 0.9 }) },
    { coefficient: -0.5, kind: COEFFICIENT_KINDS.SIGNED },
  'a declared signed correlation outranks the unsigned chain');
  assert.deepEqual({ ...coefficientOf({ correlation: null, affinity: 0.4 }) },
    { coefficient: 0.4, kind: COEFFICIENT_KINDS.UNSIGNED });
  assert.deepEqual({ ...coefficientOf({ affinity: 1.5 }) },
    { reason: INVERTER_REASONS.OUT_OF_RANGE }, 'unsigned range is [0, 1]');
  for (const bad of [{ correlation: 1.5 }, { correlation: -1.0001 },
    { correlation: Number.NaN }, { correlation: 'x' }]) {
    assert.deepEqual({ ...coefficientOf(bad) },
      { reason: INVERTER_REASONS.OUT_OF_RANGE },
      `corrupt declared correlation is rejected: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual({ ...coefficientOf({}) },
    { reason: INVERTER_REASONS.NO_COEFFICIENT });
  assert.deepEqual({ ...coefficientOf(null) },
    { reason: INVERTER_REASONS.NO_COEFFICIENT });

  // Mixed pool: domains reported, corruption counted, never salvaged.
  const mixed = invertTasteVector([
    { id: '1', name: 'Signed', correlation: -0.2 },
    { id: '2', name: 'Affined', affinity: 0.6 },
    { id: '3', name: 'Corrupt', correlation: 2 },
    { id: '4', name: 'Empty' },
  ]);
  assert.equal(mixed.coefficientDomain, 'mixed');
  assert.equal(mixed.stats.measurable, 2);
  assert.equal(mixed.stats.unmeasurable, 2);
  assert.equal(mixed.stats.outOfRange, 1);
  assert.equal(mixed.stats.input, 4);
});

test('selection strategies: take-cut vs proven negatives only', () => {
  const pool = [
    { id: '1', name: 'Agree', correlation: 0.8 },
    { id: '2', name: 'Mild', correlation: 0.1 },
    { id: '3', name: 'Opposed', correlation: -0.3 },
    { id: '4', name: 'Max Opposed', correlation: -0.9 },
  ];

  const lowest = invertTasteVector(pool, { take: 2 });
  assert.deepEqual(lowest.selected.map((r) => r.name), ['Max Opposed', 'Opposed']);
  assert.equal(lowest.strategy, INVERTER_STRATEGIES.LOWEST);

  const negative = invertTasteVector(pool, {
    strategy: INVERTER_STRATEGIES.NEGATIVE, take: 10,
  });
  assert.deepEqual(negative.selected.map((r) => r.name), ['Max Opposed', 'Opposed'],
    'only proven signed negatives qualify');
  assert.equal(negative.stats.selected, 2);

  const unsignedOnly = invertTasteVector(
    [{ id: '1', name: 'Zero', affinity: 0 }],
    { strategy: INVERTER_STRATEGIES.NEGATIVE }
  );
  assert.deepEqual([...unsignedOnly.selected], [],
    'an unsigned-only pool yields an HONEST empty negative selection');
  assert.equal(unsignedOnly.stats.selected, 0);

  const capped = invertTasteVector(pool, {
    strategy: INVERTER_STRATEGIES.NEGATIVE, take: 1,
  });
  assert.deepEqual(capped.selected.map((r) => r.name), ['Max Opposed'], 'take caps');
});

test('ordering tiebreaks and the TypeError matrix', () => {
  const tied = invertTasteVector([
    { id: '2', name: 'Same', affinity: 0.5, popularity: 0.1 },
    { id: '1', name: 'Same', affinity: 0.5, popularity: 0.1 },
    { id: '3', name: 'Same', affinity: 0.5, popularity: 0.9 },
    { id: '4', name: 'Other', affinity: 0.5, popularity: 0.1 },
  ]);
  assert.deepEqual(tied.records.map((r) => [r.name, r.id]),
    [['Same', '3'], ['Other', '4'], ['Same', '1'], ['Same', '2']],
    'popularity DESC, then name, then id');

  for (const bad of [{ take: 0 }, { take: 1001 }, { take: 1.5 },
    { strategy: 'bogus' }]) {
    assert.throws(() => invertTasteVector([], bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => invertTasteVector(null), TypeError);
});

test('determinism and deep-freeze', () => {
  const pool = [
    { id: '1', name: 'A', correlation: -0.1 },
    { id: '2', name: 'B', affinity: 0.4 },
  ];
  const a = invertTasteVector(pool, { take: 5 });
  const b = invertTasteVector(pool, { take: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.records[0]));
  assert.ok(Object.isFrozen(a.selected));
});

test('mode integration: signed rows earn the negative_correlation tier', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: [
      { id: 'm2', name: 'Zzz Corrupt', domain: 'music', affinity: 0.02, popularity: 0.99 },
      { id: 's1', name: 'Signed Opposed', domain: 'music', correlation: -0.4, popularity: 0.5 },
      { id: 'm1', name: 'No Signal', domain: 'music' },
    ],
    domains: ['music'],
    perDomain: 2,
    conflictLimit: 2,
  });

  const [zzz, signed] = block.matrix[0].entries;
  assert.deepEqual([zzz.name, zzz.divergencePercent], ['Zzz Corrupt', 98]);
  assert.equal(zzz.tier, ANTITHESIS_TIERS.LOWEST_CORRELATION);
  assert.equal(zzz.affinity, 0.02, 'unsigned rows keep the historical affinity shape');

  assert.deepEqual([signed.name, signed.divergencePercent], ['Signed Opposed', 70]);
  assert.equal(signed.tier, ANTITHESIS_TIERS.NEGATIVE_CORRELATION);
  assert.equal(signed.correlation, -0.4, 'the signed coefficient rides VERBATIM');
  assert.equal(signed.affinity, null, 'never coerced into the unsigned convention');
  assert.equal(signed.affinityPercent, null);
  assert.equal(signed.negativeCorrelation, true);

  assert.equal(block.coefficientDomain, 'mixed');
  assert.deepEqual({ ...block.stats }, {
    candidates: 3, measurable: 2, unmeasurable: 1, noiseCut: 0, selected: 2,
    domainsCovered: 1, zeroAffinity: 0, negatives: 1, mainstreamRisks: 2,
    // both matrix picks carry mainstream popularity (0.99 and 0.5),
    // so both survive the task-96 noise filter (broad encounter)
  });

  const document = renderAntithesisReport(block);
  assert.match(document,
    /^ {6}- Signed Opposed — 70% divergence \(negative correlation, sponsorship risk\)$/m);
});

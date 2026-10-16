/**
 * NonObviousSorter tests (task 61) — pins the non-obvious-first
 * re-ranking: the confirmed-surprise identity (composed from tasks
 * 56/57/60 metrics), equal-confirmation discrimination by excess,
 * weaker-but-specific beating a stronger mass hit, null sinking,
 * deterministic ties, option semantics and validation, frozen
 * non-mutating outputs and the full filter->normalize->sort chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortByNonObvious,
  surpriseIndex,
  SORT_DEFAULTS,
} from '../src/engine/NonObviousSorter.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';
import { normalizeArtifactScores } from '../src/engine/ScoreNormalizer.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const U = (p) => uniquenessCoefficient(p).coefficient;

test('surprise index: exact composed identity', () => {
  const entry = { id: 'a', affinity: 0.9, popularity: 0.2 };
  const expected = round6(0.9 * (1 + 0.7 + 0.5 * U(0.2)));
  assert.ok(Math.abs(surpriseIndex(entry) - expected) < 1e-9, `${surpriseIndex(entry)} vs ${expected}`);
});

test('equal confirmation: the higher-excess entry wins', () => {
  const specific = surpriseIndex({ id: 'specific', affinity: 0.9, popularity: 0.2 });
  const massHit = surpriseIndex({ id: 'mass', affinity: 0.9, popularity: 0.95 });
  assert.ok(specific > massHit, `${specific} > ${massHit}`);
});

test('weaker-but-specific correlation outranks a stronger mass hit', () => {
  const result = sortByNonObvious([
    { id: 'mass', name: 'Mass Hit', affinity: 0.9, popularity: 0.95 },
    { id: 'specific', name: 'Obscure Gem', affinity: 0.7, popularity: 0.1 },
  ]);

  assert.deepEqual(result.entries.map((e) => e.id), ['specific', 'mass']);
  assert.ok(result.entries[0].sorting.surprise > result.entries[1].sorting.surprise);
});

test('diagnostics: full breakdown frozen on every entry', () => {
  const result = sortByNonObvious([
    { id: 'a', affinity: 0.8, popularity: 0.25 },
  ]);
  const sorting = result.entries[0].sorting;
  assert.equal(sorting.confirmation, 0.8);
  assert.equal(sorting.excess, 0.55);
  assert.equal(sorting.obscurity, U(0.25));
  assert.equal(sorting.surprise, round6(0.8 * (1 + 0.55 + 0.5 * U(0.25))));
  assert.ok(Object.isFrozen(sorting));
  assert.ok(Object.isFrozen(result.entries[0]));
});

test('unmeasured entries sink last, in input order', () => {
  const result = sortByNonObvious([
    { id: 'blind-a', name: 'Blind A' },
    { id: 'measured', affinity: 0.6, popularity: 0.5 },
    { id: 'blind-b', name: 'Blind B' },
  ]);

  assert.deepEqual(result.entries.map((e) => e.id), ['measured', 'blind-a', 'blind-b']);
  assert.equal(result.entries[1].sorting.surprise, null, 'popularity alone is not a connection');
  assert.deepEqual({ ...result.stats }, { count: 3, measured: 1, unmeasured: 2 });
});

test('ties: equal surprise and confirmation fall back to input order', () => {
  const tied = Array.from({ length: 3 }, (_, i) => ({
    id: `t${i + 1}`,
    affinity: 0.7,
    popularity: 0.3,
  }));
  const result = sortByNonObvious(tied);
  assert.deepEqual(result.entries.map((e) => e.id), ['t1', 't2', 't3']);
});

test('option semantics: zero weights collapse to pure confirmation', () => {
  const entries = [
    { id: 'low-conf-specific', affinity: 0.6, popularity: 0.0001 },
    { id: 'high-conf-mass', affinity: 0.9, popularity: 0.99 },
  ];

  const pure = sortByNonObvious(entries, { excessWeight: 0, rarityWeight: 0 });
  assert.deepEqual(pure.entries.map((e) => e.id), ['high-conf-mass', 'low-conf-specific']);
  assert.equal(pure.entries[0].sorting.surprise, 0.9, 'surprise === confirmation at zero weights');

  // Defaults DO flip the order: the rare, high-excess correlation at
  // 0.6 confirmation outranks the fame-explained 0.9 one.
  assert.deepEqual(sortByNonObvious(entries).entries.map((e) => e.id), [
    'low-conf-specific',
    'high-conf-mass',
  ]);
});

test('validation: out-of-range weights are TypeErrors', () => {
  for (const bad of [{ excessWeight: -1 }, { rarityWeight: 11 }, { excessWeight: 'x' }]) {
    assert.throws(() => sortByNonObvious([], bad), TypeError, JSON.stringify(bad));
    assert.throws(() => surpriseIndex({ affinity: 0.5 }, bad), TypeError);
  }
  assert.equal(SORT_DEFAULTS.excessWeight, 1);
  assert.equal(SORT_DEFAULTS.rarityWeight, 0.5);
});

test('the sort never mutates its input and stays deterministic', () => {
  const input = [
    { id: 'mass', affinity: 0.9, popularity: 0.95 },
    { id: 'specific', affinity: 0.7, popularity: 0.1 },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));

  const run = () => sortByNonObvious(input);
  assert.deepEqual(run(), run(), 'cross-run identical');
  assert.deepEqual(input, snapshot, 'input array untouched');

  const serialized = JSON.parse(JSON.stringify(run()));
  assert.equal(typeof serialized.entries[0].sorting.surprise, 'number', 'serializable');
});

test('empty and degenerate inputs', () => {
  const empty = sortByNonObvious([]);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual({ ...empty.stats }, { count: 0, measured: 0, unmeasured: 0 });
  assert.deepEqual(sortByNonObvious(undefined).entries, []);
  assert.deepEqual(sortByNonObvious([null, 'x', 42]).entries, []);
});

test('full chain: filter -> normalize -> non-obvious sort', () => {
  const filtered = filterLongTail([
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.85, popularity: 0.15 },
    { id: 'E2', name: 'Cult Classic', affinity: 0.8, popularity: 0.4 },
    { id: 'E3', name: 'Blockbuster', affinity: 0.72, popularity: 0.95 },
  ]);
  const normalized = normalizeArtifactScores(filtered.kept);
  const sorted = sortByNonObvious(normalized.entries);

  // Both survivors are specific; the MORE specific/rare one leads,
  // with the 0-100% connection carried through the chain.
  assert.deepEqual(sorted.entries.map((e) => e.id), ['E1', 'E2']);
  assert.ok(sorted.entries[0].connection.percent > sorted.entries[1].connection.percent);
  assert.ok(sorted.entries[0].sorting.surprise > sorted.entries[1].sorting.surprise);
});

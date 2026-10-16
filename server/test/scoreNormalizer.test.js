/**
 * ScoreNormalizer tests (task 60) — pins the unified 0-100% connection
 * scoring: the priority reader (affinity -> correlation -> weight ->
 * index, counts excluded), percent math with clamping and honest
 * nulls, absolute vs relative (min-max) scales with the degenerate
 * rule, stats, validation, frozen outputs and composition with the
 * extractor/filter/scorer outputs of tasks 51-59.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeArtifactScores,
  connectionScoreOf,
  toPercent,
  SCORE_DEFAULTS,
  SCORE_MODES,
} from '../src/engine/ScoreNormalizer.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';
import { coherenceIndex } from '../src/engine/AffinityScorer.js';

test('toPercent: clamped, one decimal, honest nulls', () => {
  assert.equal(toPercent(0), 0);
  assert.equal(toPercent(1), 100);
  assert.equal(toPercent(0.8), 80);
  assert.equal(toPercent(0.5678), 56.8);
  assert.equal(toPercent(-0.2), 0, 'clamped low');
  assert.equal(toPercent(1.5), 100, 'clamped high');
  assert.equal(toPercent(null), null, 'unmeasured is never zero');
  assert.equal(toPercent('x'), null);
});

test('connectionScoreOf: documented priority, counts are not scores', () => {
  assert.equal(connectionScoreOf({ affinity: 0.8, weight: 0.3 }), 0.8, 'affinity first');
  assert.equal(connectionScoreOf({ correlation: 0.65, weight: 0.3 }), 0.65, 'task-52 alias');
  assert.equal(connectionScoreOf({ index: 0.9, weight: 1.25 }), 0.9, 'bounded kinship beats the rarity multiplier');
  assert.equal(connectionScoreOf({ weight: 0.25 }), 0.25, 'carrier share');
  assert.equal(connectionScoreOf({ carriers: 5, rank: 2 }), null, 'counts are batch arithmetic');
  assert.equal(connectionScoreOf({}), null);
  assert.equal(connectionScoreOf(null), null);
});

test('absolute mode: percentage of the full scale, comparable across batches', () => {
  const result = normalizeArtifactScores([
    { id: 'entity', name: 'Entity', affinity: 0.8 },
    { id: 'tag', name: 'Tag', weight: 0.25 },
    { id: 'literary', name: 'Entry', correlation: 0.65 },
    { id: 'blind', name: 'No Score' },
  ]);

  assert.deepEqual(result.entries.map((e) => e.connection.percent), [80, 25, 65, null]);
  assert.deepEqual(result.entries.map((e) => e.connection.scale), ['absolute', 'absolute', 'absolute', 'absolute']);
  assert.deepEqual(result.entries.map((e) => e.connection.score), [0.8, 0.25, 0.65, null]);
  assert.deepEqual({ ...result.stats }, {
    count: 4,
    measured: 3,
    unmeasured: 1,
    minPercent: 25,
    maxPercent: 80,
    meanPercent: 56.7,
    degenerate: false,
  });
});

test('relative mode: min-max within the batch', () => {
  const result = normalizeArtifactScores(
    [
      { id: 'weak', affinity: 0.2 },
      { id: 'mid', affinity: 0.5 },
      { id: 'strong', affinity: 0.8 },
      { id: 'blind' },
    ],
    { mode: 'relative' }
  );

  assert.deepEqual(result.entries.map((e) => e.connection.percent), [0, 50, 100, null]);
  assert.deepEqual([...result.entries.map((e) => e.id)], ['weak', 'mid', 'strong', 'blind'], 'order preserved');
  assert.deepEqual({ ...result.stats }, {
    count: 4,
    measured: 3,
    unmeasured: 1,
    minPercent: 0,
    maxPercent: 100,
    meanPercent: 50,
    degenerate: false,
  });
});

test('degenerate batches: every measured score equally the strongest', () => {
  const allEqual = normalizeArtifactScores(
    [{ id: 'a', affinity: 0.7 }, { id: 'b', affinity: 0.7 }],
    { mode: 'relative' }
  );
  assert.deepEqual(allEqual.entries.map((e) => e.connection.percent), [100, 100]);
  assert.equal(allEqual.stats.degenerate, true);
  assert.equal(allEqual.stats.minPercent, 100);

  const single = normalizeArtifactScores([{ id: 'a', affinity: 0.3 }], { mode: 'relative' });
  assert.equal(single.entries[0].connection.percent, 100, 'one artifact is the strongest');
  assert.equal(single.stats.degenerate, true);
});

test('validation: unknown mode is a TypeError', () => {
  assert.throws(() => normalizeArtifactScores([], { mode: 'percentile' }), TypeError);
  assert.equal(SCORE_DEFAULTS.mode, 'absolute');
  assert.deepEqual([...SCORE_MODES], ['absolute', 'relative']);
});

test('outputs are frozen, serializable and deterministic', () => {
  const data = () => [
    { id: 'a', affinity: 0.42 },
    { id: 'b', weight: 0.9 },
  ];

  const result = normalizeArtifactScores(data());
  assert.deepEqual(normalizeArtifactScores(data()), result, 'cross-run identical');

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.entries));
  assert.ok(Object.isFrozen(result.entries[0]));
  assert.ok(Object.isFrozen(result.entries[0].connection));
  assert.ok(Object.isFrozen(result.stats));
  assert.throws(() => {
    result.entries[0].connection.percent = 0;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(result)).entries[0].connection.percent, 42, 'serializable');
});

test('composition: extractor-shaped artifacts (entities + genres + artists)', () => {
  // Shapes mirroring tasks 51/53/54 outputs.
  const artifacts = [
    { id: 'E1', name: 'Vangelis', affinity: 0.9 }, // artist entry
    { id: 'T1', name: 'Slow Cinema', weight: 0.2 }, // genre tag entry
    { id: 'E2', name: 'Kettle House', affinity: 0.8 }, // place entry
    { id: 'T2', name: 'Drama', weight: 0.95 }, // carrier-heavy tag
  ];

  const absolute = normalizeArtifactScores(artifacts);
  assert.deepEqual(absolute.entries.map((e) => e.connection.percent), [90, 20, 80, 95]);

  const relative = normalizeArtifactScores(artifacts, { mode: 'relative' });
  // min .2, max .95: (v - .2) / .75 — exact min-max percentages.
  assert.deepEqual(relative.entries.map((e) => e.connection.percent), [93.3, 0, 80, 100]);
});

test('composition: task-59 kinship pairs normalize via the index field', () => {
  const anchor = { name: 'Blade Runner', domain: 'film' };
  const kinship = coherenceIndex(anchor, [
    { name: 'Blade Runner (1982)', domain: 'film', affinity: 0.9 },
    { name: 'Heat', domain: 'film', affinity: 0.5 },
  ]);

  const normalized = normalizeArtifactScores(kinship.pairs);

  assert.equal(normalized.stats.measured, 2, 'pairs carry `index` -> measurable');
  for (const entry of normalized.entries) {
    assert.equal(entry.connection.score, entry.index, 'score IS the kinship index');
    assert.equal(entry.connection.percent, toPercent(entry.index));
  }
});

test('composition: LongTailFilter survivors with affinity-only shapes', () => {
  const filtered = filterLongTail([
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.8, popularity: 0.25 },
    { id: 'E2', name: 'Cult Deep Cut', affinity: 0.75, popularity: 0.002 },
    { id: 'E3', name: 'Blockbuster', affinity: 0.72, popularity: 0.95 },
  ]);

  const normalized = normalizeArtifactScores(filtered.kept, { mode: 'relative' });

  assert.equal(normalized.stats.measured, 2);
  assert.deepEqual(normalized.entries.map((e) => e.connection.percent), [100, 0], 'min-max over survivors');
});

test('empty and degenerate-safe inputs', () => {
  const empty = normalizeArtifactScores([]);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual({ ...empty.stats }, {
    count: 0,
    measured: 0,
    unmeasured: 0,
    minPercent: null,
    maxPercent: null,
    meanPercent: null,
    degenerate: false,
  });

  const allUnmeasured = normalizeArtifactScores([{ id: 'x' }, { id: 'y' }], { mode: 'relative' });
  assert.deepEqual(allUnmeasured.entries.map((e) => e.connection.percent), [null, null]);
  assert.equal(allUnmeasured.stats.degenerate, false, 'nothing measured -> not degenerate');

  assert.deepEqual(normalizeArtifactScores(undefined).entries, []);
  assert.deepEqual(normalizeArtifactScores([null, 'x', 42]).entries, []);
});

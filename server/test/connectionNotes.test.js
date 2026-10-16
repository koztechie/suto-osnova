/**
 * ConnectionNotes tests (task 65) — pins the per-connection
 * explanatory notes: evidence assembly (bridge, percent, shared
 * markers, rarity, specificity), deterministic templates with the
 * honesty clause, confidence derivation, batch stats, frozen
 * deterministic outputs and composition with the tasks 56/57/60 math.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  explainConnection,
  annotateConnections,
  NOTE_CONFIDENCE,
  NOTE_DEFAULTS,
} from '../src/engine/ConnectionNotes.js';
import { normalizeArtifactScores } from '../src/engine/ScoreNormalizer.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';

const tag = (value, name) => ({ id: `urn:tag:genre:media:${value}`, name, type: 'urn:tag:genre:media' });

const FILM = {
  name: 'Blade Runner',
  domain: 'film',
  tags: [tag('slow_cinema', 'Slow Cinema'), tag('neon', 'Neon')],
};
const SOUND = {
  name: 'Vangelis',
  category: 'music',
  popularity: 0.001,
  affinity: 0.9,
  tags: [tag('slow_cinema', 'Slow Cinema'), tag('ambient', 'Ambient')],
};

test('rich connection: full evidence and every template phrase', () => {
  const explained = explainConnection({ source: FILM, target: SOUND, percent: 92.5 });

  const e = explained.evidence;
  assert.equal(e.sourceName, 'Blade Runner');
  assert.equal(e.targetName, 'Vangelis');
  assert.equal(e.bridge, true, 'film -> music');
  assert.equal(e.percent, 92.5);
  assert.deepEqual([...e.sharedMarkers], ['Slow Cinema'], 'shared by tag id');
  assert.equal(e.specific, true);
  assert.equal(e.excessPoints, 89.9);
  assert.equal(e.rarity.coefficient, uniquenessCoefficient(0.001).coefficient);
  assert.equal(e.longTail, true);

  assert.equal(explained.confidence, NOTE_CONFIDENCE.EVIDENCE_BACKED);
  assert.ok(explained.note.includes('Qloo reports 92.5% affinity across the film -> music bridge.'));
  assert.ok(explained.note.includes('Shared markers: Slow Cinema.'));
  assert.ok(explained.note.includes('Long-tail pick: uniqueness 50% (long_tail)'));
  assert.ok(explained.note.includes('outpaces the target\'s fame by 89.9 points'));
  assert.ok(!explained.note.includes('Mechanism unverified'), 'backed notes skip the honesty clause');
  assert.ok(Object.isFrozen(explained));
  assert.ok(Object.isFrozen(explained.evidence));
  assert.ok(Object.isFrozen(explained.evidence.sharedMarkers));
});

test('thin connection: data_only with the honesty clause', () => {
  const explained = explainConnection({
    source: { name: 'Heat' },
    target: { name: 'Generic Score', popularity: 0.8, affinity: 0.82 },
  });

  assert.equal(explained.confidence, NOTE_CONFIDENCE.DATA_ONLY);
  assert.deepEqual([...explained.evidence.sharedMarkers], []);
  assert.equal(explained.evidence.bridge, false, 'no domains supplied');
  assert.equal(explained.evidence.longTail, false);
  assert.equal(explained.evidence.specific, false, 'excess 0.02 below the floor');
  assert.ok(explained.note.includes('Mechanism unverified: Qloo reports the correlation'));
  assert.ok(explained.note.includes('Qloo reports 82% affinity.'));
  assert.ok(!explained.note.includes('bridge'), 'no bridge phrase without domains');
});

test('score sourcing: percent passthrough, computed default, alias, missing', () => {
  assert.equal(
    explainConnection({ source: FILM, target: SOUND, percent: 50 }).evidence.percent,
    50
  );
  assert.equal(
    explainConnection({ source: FILM, target: SOUND }).evidence.percent,
    90,
    'computed from the target via the task-60 reader'
  );
  assert.equal(
    explainConnection({ source: {}, target: { correlation: 0.65 } }).evidence.percent,
    65,
    'task-52 alias'
  );
  const bare = explainConnection({ source: {}, target: { name: 'X' } });
  assert.equal(bare.evidence.percent, null);
  assert.ok(bare.note.includes('without a normalized score'));
});

test('shared markers: tag-name fallback and display names', () => {
  const byName = explainConnection({
    source: { name: 'A', tags: [{ name: 'Neo Noir' }] },
    target: { name: 'B', tags: [{ name: 'neo noir' }] },
  });
  assert.deepEqual([...byName.evidence.sharedMarkers], ['Neo Noir'], 'name-keyed, original display');
  assert.equal(byName.confidence, NOTE_CONFIDENCE.EVIDENCE_BACKED);
});

test('threshold semantics: floors are inclusive/exclusive as documented', () => {
  // Specificity: strictly ABOVE the 0.05 floor.
  const atFloor = explainConnection({
    source: {},
    target: { popularity: 0.5, affinity: 0.55 },
  });
  assert.equal(atFloor.evidence.specific, false, 'excess exactly 0.05 is not specific');
  const aboveFloor = explainConnection({
    source: {},
    target: { popularity: 0.5, affinity: 0.551 },
  });
  assert.equal(aboveFloor.evidence.specific, true);
  assert.equal(NOTE_DEFAULTS.specificityFloor, 0.05);
  assert.equal(NOTE_DEFAULTS.rarityFloor, 0.35);

  // Negative excess never produces a specificity phrase.
  const negative = explainConnection({
    source: {},
    target: { popularity: 0.9, affinity: 0.5 },
  });
  assert.equal(negative.evidence.excessPoints, 0);
  assert.ok(!negative.note.includes('outpaces'));
});

test('annotateConnections: batch stats, order preserved, frozen', () => {
  const batch = annotateConnections([
    { source: FILM, target: SOUND, percent: 92.5 },
    { source: { name: 'Heat' }, target: { name: 'Generic', popularity: 0.8, affinity: 0.82 } },
  ]);

  assert.equal(batch.entries.length, 2);
  assert.equal(typeof batch.entries[0].note, 'string', 'entries annotated in place');
  assert.deepEqual({ ...batch.stats }, {
    count: 2,
    backed: 1,
    dataOnly: 1,
    meanPercent: 87.3,
  });
  assert.ok(Object.isFrozen(batch));
  assert.ok(Object.isFrozen(batch.entries));
  assert.ok(Object.isFrozen(batch.entries[0].evidence));

  const empty = annotateConnections([]);
  assert.deepEqual({ ...empty.stats }, { count: 0, backed: 0, dataOnly: 0, meanPercent: null });
});

test('validation and determinism', () => {
  assert.throws(() => explainConnection(null), TypeError);
  assert.throws(() => explainConnection('x'), TypeError);

  const connection = { source: FILM, target: SOUND, percent: 92.5 };
  assert.deepEqual(explainConnection(connection), explainConnection(connection));
  assert.deepEqual(
    JSON.parse(JSON.stringify(explainConnection(connection))),
    JSON.parse(JSON.stringify(explainConnection(connection))),
    'serializable'
  );
  assert.deepEqual(annotateConnections(undefined).entries, []);
});

test('composition: task-60 normalized artifacts become annotated connections', () => {
  const normalized = normalizeArtifactScores([
    { id: 'E1', name: 'Vangelis', affinity: 0.9, popularity: 0.001, tags: SOUND.tags },
    { id: 'E2', name: 'Generic Band', affinity: 0.85, popularity: 0.85 },
  ]);

  const batch = annotateConnections(
    normalized.entries.map((entry) => ({
      source: { name: 'Blade Runner', domain: 'film', tags: FILM.tags },
      target: entry,
      percent: entry.connection.percent,
    }))
  );

  assert.equal(batch.stats.backed, 1, 'only the rare specific one is explained by evidence');
  assert.ok(batch.entries[0].note.includes('90% affinity'), 'task-60 percent verbatim');
  assert.ok(batch.entries[1].confidence === NOTE_CONFIDENCE.DATA_ONLY);
  assert.ok(batch.entries[1].note.includes('Mechanism unverified'));
});

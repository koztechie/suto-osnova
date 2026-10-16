/**
 * TonalityEngine tests (task 66) — pins the single-aesthetic-tonality
 * coherence pipeline: five-pole tone classification with honest
 * unclassifieds, evidence-weighted centroid math, deviation over
 * comparable axes, the outlier-vs-contradiction semantics (a lone
 * dissenter is an outlier; two camps are an axis contradiction that
 * exempts itself from deviation), validation, frozen deterministic
 * outputs and composition with task-65 note-shaped connections.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTone,
  coherenceCentroid,
  checkTonalCoherence,
  TONE_POLES,
  TONALITY_DEFAULTS,
} from '../src/engine/TonalityEngine.js';
import { annotateConnections } from '../src/engine/ConnectionNotes.js';

const tag = (name) => ({ id: `urn:tag:genre:media:${name.toLowerCase().replace(/\s+/g, '_')}`, name });
const conn = (name, tagNames) => ({ target: { name, tags: tagNames.map(tag) } });

test('classifyTone: five-pole vectors, mixed evidence, honest unclassified', () => {
  const dark = classifyTone(conn('Dark Pick', ['Cyberpunk', 'Noir', 'Rain']));
  assert.equal(dark.classified, true);
  assert.equal(dark.axes.dark_light, -1, '3 negative, 0 positive');
  assert.equal(dark.axes.melancholic_uplifting, null, 'no evidence on that axis');
  assert.deepEqual([...dark.evidenceWords].sort(), ['cyberpunk', 'noir', 'rain']);

  const mixed = classifyTone(conn('Mixed Pick', ['Noir', 'Cheerful']));
  assert.equal(mixed.axes.dark_light, 0, '(1 - 1) / 2');

  const plain = classifyTone(conn('Plain Pick', ['Drama']));
  assert.equal(plain.classified, false, 'no tone evidence -> unclassified, never forced');
  assert.ok(Object.values(plain.axes).every((v) => v === null));
  assert.equal(TONE_POLES.length, 5);
});

test('coherenceCentroid: evidence-weighted mean per axis', () => {
  const heavy = classifyTone(conn('Heavy', ['Cyberpunk', 'Noir'])); // -1, evidence 2
  const light = classifyTone(conn('Light', ['Pastel'])); // +1, evidence 1

  const centroid = coherenceCentroid([heavy, light]);
  assert.equal(centroid.axes.dark_light, -0.333333, '(-2 + 1) / 3');
  assert.equal(centroid.axes.melancholic_uplifting, null);
  assert.deepEqual(
    Object.keys(centroid.axes).sort(),
    TONE_POLES.map((p) => p.id).sort()
  );
});

test('coherent set: one tonality, zero deviations, no contradictions', () => {
  const result = checkTonalCoherence([
    conn('A', ['Cyberpunk', 'Noir', 'Industrial']),
    conn('B', ['Dark', 'Rain', 'Night']),
    conn('C', ['Cyberpunk', 'Sinister']),
  ]);

  assert.equal(result.coherent, true);
  assert.equal(result.stats.outliers, 0);
  assert.deepEqual(result.contradictions, []);
  assert.ok(result.connections.every((c) => c.deviation === 0));
  assert.deepEqual({ ...result.stats }, { total: 3, classified: 3, unclassified: 0, outliers: 0, contradictionAxes: 0 });
});

test('lone dissenter: an outlier, not a contradiction', () => {
  const result = checkTonalCoherence([
    conn('Dark A', ['Cyberpunk', 'Noir', 'Rain']),
    conn('Dark B', ['Cyberpunk', 'Noir', 'Rain']),
    conn('Dark C', ['Cyberpunk', 'Noir', 'Rain']),
    conn('Cheerful One', ['Pastel', 'Daylight']),
  ]);

  assert.equal(result.coherent, false);
  assert.equal(result.stats.contradictionAxes, 0, 'one voice on the light flank');
  const outlier = result.connections.find((c) => c.name === 'Cheerful One');
  assert.equal(outlier.outlier, true);
  assert.ok(outlier.deviation >= TONALITY_DEFAULTS.outlierThreshold);
  assert.equal(result.stats.outliers, 1);
  assert.equal(result.stats.classified, 4);
});

test('two camps: a contradiction axis, exempt from deviation', () => {
  const result = checkTonalCoherence([
    conn('Dark A', ['Cyberpunk', 'Noir']),
    conn('Dark B', ['Dark', 'Rain']),
    conn('Dark C', ['Gothic', 'Night']),
    conn('Light A', ['Pastel', 'Cheerful']),
    conn('Light B', ['Bright', 'Sunny']),
    conn('Light C', ['Airy', 'Luminous']),
  ]);

  assert.equal(result.coherent, false);
  assert.equal(result.stats.contradictionAxes, 1);
  assert.equal(result.contradictions[0].axis, 'dark_light');
  assert.deepEqual([...result.contradictions[0].negative], ['Dark A', 'Dark B', 'Dark C']);
  assert.deepEqual([...result.contradictions[0].positive], ['Light A', 'Light B', 'Light C']);
  assert.equal(result.stats.outliers, 0, 'bimodal axis exempt — the camp is not an outlier');
  assert.ok(result.connections.every((c) => c.deviation === null));
});

test('unclassified connections are honestly reported, not counted coherent-by-default', () => {
  const result = checkTonalCoherence([
    conn('Dark A', ['Cyberpunk', 'Noir']),
    conn('Dark B', ['Dark', 'Night']),
    conn('Plain', ['Drama', 'Based On A Book']),
  ]);

  assert.equal(result.coherent, true, 'classified >= 1, no dissenters');
  assert.deepEqual({ ...result.stats }, { total: 3, classified: 2, unclassified: 1, outliers: 0, contradictionAxes: 0 });
  const plain = result.connections.find((c) => c.name === 'Plain');
  assert.equal(plain.tone.classified, false);
  assert.equal(plain.deviation, null);
});

test('validation and degenerate inputs', () => {
  for (const bad of [{ outlierThreshold: -0.1 }, { contradictionPole: 0 }, { contradictionMinFlank: 1.5 }]) {
    assert.throws(() => checkTonalCoherence([], bad), TypeError, JSON.stringify(bad));
  }

  const empty = checkTonalCoherence([]);
  assert.equal(empty.coherent, false, 'nothing classified is not coherent');
  assert.deepEqual({ ...empty.stats }, { total: 0, classified: 0, unclassified: 0, outliers: 0, contradictionAxes: 0 });
  assert.deepEqual(checkTonalCoherence(undefined).connections, []);
});

test('outputs are frozen, serializable and deterministic', () => {
  const data = () => [
    conn('A', ['Cyberpunk', 'Noir']),
    conn('B', ['Pastel', 'Cheerful']),
  ];

  const result = checkTonalCoherence(data());
  assert.deepEqual(checkTonalCoherence(data()), result, 'cross-run identical');

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.centroid));
  assert.ok(Object.isFrozen(result.connections));
  assert.ok(Object.isFrozen(result.connections[0].tone));
  assert.ok(Object.isFrozen(result.stats));
  assert.throws(() => {
    result.connections[0].outlier = true;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(result)).stats.total, 2, 'serializable');
});

test('composition: task-65 note-shaped connections flow through the pipeline', () => {
  // Connections as produced after annotateConnections: source/target +
  // evidence with sharedMarkers.
  const raw = annotateConnections([
    {
      source: { name: 'Blade Runner', domain: 'film', tags: [tag('Cyberpunk')] },
      target: { name: 'Vangelis', category: 'music', affinity: 0.9, popularity: 0.001, tags: [tag('Cyberpunk'), tag('Rain')] },
    },
    {
      source: { name: 'Blade Runner', domain: 'film', tags: [tag('Cyberpunk')] },
      target: { name: 'Neon Diner', category: 'dining', affinity: 0.8, popularity: 0.5, tags: [tag('Neon'), tag('Night')] },
    },
  ]).entries;

  const result = checkTonalCoherence(raw);

  assert.equal(result.stats.classified, 2, 'shared markers + tags carry the tone');
  assert.equal(result.coherent, true, 'one dark-cyberpunk tonality');
  assert.ok(result.centroid.axes.dark_light < 0, 'the dossier leans dark');
});

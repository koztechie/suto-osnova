/**
 * GraphWeights tests (task 69) — pins the numeric edge-weight
 * generation for the client-side interactive graph: type priors for
 * structural (null-weight) edges, the rarity boost with its cap, both
 * normalization modes, exact node-strength math (probabilistic OR),
 * per-type stats, non-mutation, frozen deterministic outputs and the
 * end-to-end composition with the task-68 graph assembly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateEdgeWeights,
  WEIGHT_DEFAULTS,
  WEIGHT_MODES,
} from '../src/engine/GraphWeights.js';
import { buildContextGraph } from '../src/engine/ContextGraph.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;

const graph = (nodes, edges) => ({ nodes, edges });
const node = (id, over = {}) => ({ id, kind: 'entity', label: id, domain: null, popularity: null, uniqueness: null, ...over });
const edge = (source, target, type, weight) => ({ source, target, type, weight, confidence: null });

test('null weights get the type priors; every weight becomes numeric', () => {
  const weighted = generateEdgeWeights(
    graph(
      [node('a'), node('b'), node('t', { kind: 'tag' })],
      [edge('a', 'b', 'resolves', null), edge('a', 't', 'tagged', null), edge('a', 'b', 'connection', null)]
    )
  );

  assert.equal(weighted.edges.find((e) => e.type === 'resolves').weight, 1, 'anchor edge prior');
  assert.equal(weighted.edges.find((e) => e.type === 'tagged').weight, 0.3, 'carrier-share prior');
  assert.equal(weighted.edges.find((e) => e.type === 'connection').weight, 0.6);
  assert.ok(weighted.edges.every((e) => Number.isFinite(e.weight) && e.weight > 0 && e.weight <= 1));
});

test('rarity boost: the target uniqueness buys visual prominence, capped', () => {
  const weighted = generateEdgeWeights(
    graph(
      [node('a'), node('mainstream', { popularity: 1 }), node('microtail', { popularity: 1e-6 })],
      [edge('a', 'mainstream', 'affinity', 0.5), edge('a', 'microtail', 'affinity', 0.5)]
    )
  );

  const mainstream = weighted.edges.find((e) => e.target === 'mainstream');
  const microtail = weighted.edges.find((e) => e.target === 'microtail');
  assert.equal(mainstream.weight, 0.5, 'no rarity to boost');
  assert.equal(microtail.weight, round6(0.5 * (1 + 0.25 * uniquenessCoefficient(1e-6).coefficient)));
  assert.ok(microtail.weight > mainstream.weight);

  // The cap holds at the ceiling.
  const capped = generateEdgeWeights(
    graph(
      [node('a'), node('m', { popularity: 1e-6 })],
      [edge('a', 'm', 'resolves', null)]
    )
  );
  assert.equal(capped.edges[0].weight, 1, 'prior 1.0 capped, never above');

  // rarityBoost 0 disables the boost entirely.
  const flat = generateEdgeWeights(
    graph([node('a'), node('m', { popularity: 1e-6 })], [edge('a', 'm', 'affinity', 0.5)]),
    { rarityBoost: 0 }
  );
  assert.equal(flat.edges[0].weight, 0.5);
});

test('modes: absolute as-is, relative min-max, degenerate unchanged', () => {
  const nodes = [node('a'), node('x'), node('y'), node('z')];
  const edges = [edge('a', 'x', 'affinity', 0.2), edge('a', 'y', 'affinity', 0.6), edge('a', 'z', 'affinity', 1)];

  const absolute = generateEdgeWeights(graph(nodes, edges), { rarityBoost: 0 });
  assert.deepEqual(absolute.edges.map((e) => e.weight), [0.2, 0.6, 1]);

  const relative = generateEdgeWeights(graph(nodes, edges), { rarityBoost: 0, mode: 'relative' });
  assert.deepEqual(relative.edges.map((e) => e.weight), [0, 0.5, 1]);
  assert.equal(relative.stats.minWeight, 0);
  assert.equal(relative.stats.maxWeight, 1);

  // Degenerate (no spread): values stay absolute.
  const degenerate = generateEdgeWeights(
    graph([node('a'), node('x'), node('y')], [edge('a', 'x', 'affinity', 0.4), edge('a', 'y', 'affinity', 0.4)]),
    { rarityBoost: 0, mode: 'relative' }
  );
  assert.deepEqual(degenerate.edges.map((e) => e.weight), [0.4, 0.4]);
  assert.deepEqual([...WEIGHT_MODES], ['absolute', 'relative']);
});

test('node strength: the probabilistic OR, exact math', () => {
  const weighted = generateEdgeWeights(
    graph(
      [node('hub'), node('a'), node('b'), node('lonely')],
      [
        edge('hub', 'a', 'affinity', 0.5),
        edge('hub', 'b', 'affinity', 0.75),
        edge('a', 'b', 'tagged', 0.2),
      ]
    ),
    { rarityBoost: 0 }
  );

  const strength = (id) => weighted.nodes.find((n) => n.id === id).strength;
  assert.equal(strength('hub'), 1 - (1 - 0.5) * (1 - 0.75), 'only two incident edges');
  assert.equal(strength('a'), 1 - (1 - 0.5) * (1 - 0.2));
  assert.equal(strength('b'), 1 - (1 - 0.75) * (1 - 0.2));
  assert.equal(strength('lonely'), 0, 'isolates are 0');
  assert.ok(weighted.nodes.every((n) => n.strength >= 0 && n.strength <= 1));
});

test('stats: final weights per type, min/max/mean', () => {
  const weighted = generateEdgeWeights(
    graph(
      [node('a'), node('x'), node('y')],
      [edge('a', 'x', 'affinity', 0.2), edge('a', 'x', 'affinity', 0.6), edge('a', 'y', 'tagged', null)]
    ),
    { rarityBoost: 0 }
  );

  assert.deepEqual({ ...weighted.stats.byType.affinity }, { count: 2, meanWeight: 0.4 });
  assert.deepEqual({ ...weighted.stats.byType.tagged }, { count: 1, meanWeight: 0.3 });
  assert.equal(weighted.stats.minWeight, 0.2);
  assert.equal(weighted.stats.maxWeight, 0.6);
  assert.ok(Math.abs(weighted.stats.meanWeight - round6((0.2 + 0.6 + 0.3) / 3)) < 1e-9);
});

test('non-mutation, freezing, determinism, validation, empty graph', () => {
  const input = graph([node('a'), node('x')], [edge('a', 'x', 'affinity', null)]);
  const snapshot = JSON.parse(JSON.stringify(input));

  const run = () => generateEdgeWeights(input);
  assert.deepEqual(run(), run(), 'cross-run identical');
  assert.deepEqual(input, snapshot, 'input graph untouched');

  const weighted = run();
  assert.ok(Object.isFrozen(weighted));
  assert.ok(Object.isFrozen(weighted.nodes[0]));
  assert.ok(Object.isFrozen(weighted.edges[0]));
  assert.ok(Object.isFrozen(weighted.stats.byType));
  assert.throws(() => {
    weighted.edges[0].weight = 0;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(weighted)).edges[0].weight, 0.5, 'serializable');

  for (const bad of [{ mode: 'percentile' }, { rarityBoost: 1.5 }, { typePriors: { affinity: 0 } }]) {
    assert.throws(() => generateEdgeWeights(graph([], []), bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => generateEdgeWeights(graph([], []), { typePriors: null }), TypeError);

  const empty = generateEdgeWeights({});
  assert.deepEqual(empty.edges, []);
  assert.equal(empty.stats.minWeight, null);
  assert.equal(empty.stats.meanWeight, null);
});

test('tolerance: corrupt edges fall back to defaults', () => {
  const weighted = generateEdgeWeights(
    graph([node('a'), node('b')], [{}, { source: 'a', target: 'b', type: 'unknown_kind' }])
  );
  assert.equal(weighted.edges[0].weight, 0.5, 'no type -> default prior');
  assert.equal(weighted.edges[1].weight, 0.5, 'unknown type -> default prior');
});

test('composition: task-68 graph becomes client-ready', () => {
  const raw = buildContextGraph({
    anchor: { id: 'seed', name: 'Blade Runner', domain: 'film' },
    resolved: { entity: { id: 'e-br', name: 'Blade Runner', category: 'film' } },
    layers: {
      sound: {
        artists: [{ id: 'm1', name: 'Vangelis', affinity: 0.9, popularity: 0.001 }],
        genres: [{ id: 'urn:tag:genre:music:ambient', name: 'Ambient', weight: 0.5 }],
      },
    },
  });

  const client = generateEdgeWeights(raw);

  assert.ok(client.edges.every((e) => Number.isFinite(e.weight) && e.weight > 0), 'no nulls survive');
  const anchor = client.nodes.find((n) => n.id === 'seed');
  assert.ok(anchor.strength > 0.8, 'the hub is visually dominant');
  const tagged = client.edges.find((e) => e.type === 'tagged');
  assert.equal(tagged.weight, 0.5, 'tag nodes carry no popularity -> prior, no boost');
  assert.equal(client.stats.edges, raw.stats.edges, 'edge count preserved');
  assert.equal(client.nodes.length, raw.stats.nodes);
});

/**
 * ContextGraph tests (task 68) — pins the visualization graph
 * assembly: node/edge contracts and id policy, every section walk
 * (anchor, resolved, expansion, extractor layers, annotated
 * connections), node and edge dedup (max-weight rule), tag inclusion
 * option, task-57 uniqueness on entity nodes, malformed tolerance,
 * frozen deterministic outputs and a full-dossier composition count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextGraph,
  GRAPH_NODE_KINDS,
  GRAPH_EDGE_TYPES,
  GRAPH_DEFAULTS,
} from '../src/engine/ContextGraph.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';

const ANCHOR = { id: 'seed-1', name: 'Blade Runner', domain: 'film' };

test('minimal: anchor only', () => {
  const graph = buildContextGraph({ anchor: ANCHOR });

  assert.equal(graph.stats.nodes, 1);
  assert.equal(graph.nodes[0].kind, 'anchor');
  assert.equal(graph.nodes[0].label, 'Blade Runner');
  assert.equal(graph.nodes[0].domain, 'film');
  assert.deepEqual(graph.edges, []);
  assert.deepEqual({ ...graph.stats.edgesByType }, {
    resolves: 0, cross_domain: 0, affinity: 0, tagged: 0, connection: 0,
  });
});

test('resolved: anchor -resolves-> entity (task-47 shape)', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    resolved: { entity: { id: 'e-br', name: 'Blade Runner', category: 'film' } },
  });

  assert.equal(graph.stats.nodes, 2);
  const edge = graph.edges[0];
  assert.deepEqual({ ...edge }, {
    source: 'seed-1', target: 'e-br', type: 'resolves', weight: 1, confidence: null,
  });
  assert.equal(graph.nodes.find((n) => n.id === 'e-br').domain, 'film', 'category -> domain');
});

test('expansion: cross_domain edges with affinity weights and rarity colors', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    expansion: {
      domains: [
        { domain: 'music', entities: [{ id: 'm1', name: 'Vangelis', affinity: 0.9, popularity: 0.001 }] },
      ],
    },
  });

  const node = graph.nodes.find((n) => n.id === 'm1');
  assert.equal(node.kind, 'entity');
  assert.equal(node.uniqueness, uniquenessCoefficient(0.001).coefficient, 'task-57 color scale');
  assert.equal(graph.edges[0].type, 'cross_domain');
  assert.equal(graph.edges[0].weight, 0.9);
});

test('layers: entity and tag nodes with their edge types', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    layers: {
      sound: {
        artists: [{ id: 'a1', name: 'Vangelis', affinity: 0.9 }],
        albums: [{ id: 'al1', name: 'Blade Runner OST', connection: { percent: 80 } }],
        genres: [{ id: 'urn:tag:genre:music:ambient', name: 'Ambient', weight: 0.5 }],
      },
      visual: {
        films: [{ id: 'f1', name: 'Neon City', affinity: 0.8 }],
        cinematography: [{ id: 'urn:tag:genre:media:deep_focus', name: 'Deep Focus' }],
      },
    },
  });

  assert.equal(graph.stats.nodesByKind.anchor, 1);
  assert.equal(graph.stats.nodesByKind.entity, 3);
  assert.equal(graph.stats.nodesByKind.tag, 2);

  const albumEdge = graph.edges.find((e) => e.target === 'al1');
  assert.equal(albumEdge.type, 'affinity');
  assert.equal(albumEdge.weight, 0.8, 'task-60 percent scaled to 0..1');

  const tagEdge = graph.edges.find((e) => e.target === 'urn:tag:genre:music:ambient');
  assert.equal(tagEdge.type, 'tagged');
  assert.equal(tagEdge.weight, 0.5, 'carrier share');
  const bareTag = graph.edges.find((e) => e.target === 'urn:tag:genre:media:deep_focus');
  assert.equal(bareTag.weight, null, 'structural edge without weight');
});

test('dedup: nodes merge by id, edges keep the max weight', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    layers: {
      sound: {
        genres: [
          { id: 'urn:tag:genre:music:ambient', name: 'Ambient', weight: 0.2 },
          { id: 'urn:tag:genre:music:ambient', name: 'Ambient', weight: 0.7 },
        ],
        artists: [{ id: 'a1', name: 'Vangelis', affinity: 0.9 }],
      },
      literary: {
        authors: [{ id: 'a1', name: 'Vangelis', affinity: 0.6 }], // same entity id
      },
    },
  });

  assert.equal(graph.nodes.filter((n) => n.id === 'urn:tag:genre:music:ambient').length, 1);
  assert.equal(graph.nodes.filter((n) => n.id === 'a1').length, 1, 'first occurrence wins');
  const tagged = graph.edges.filter((e) => e.type === 'tagged');
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].weight, 0.7, 'max weight kept');
  const affinityEdges = graph.edges.filter((e) => e.type === 'affinity' && e.target === 'a1');
  assert.equal(affinityEdges.length, 1, 'same type+endpoints dedup across layers');
  assert.equal(affinityEdges[0].weight, 0.9, 'the stronger evidence survives');
});

test('connections: synthetic name nodes, weight and confidence on the edge', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    connections: [
      {
        source: { name: 'Blade Runner' },
        target: { name: 'Vangelis', affinity: 0.9 },
        evidence: { percent: 90 },
        confidence: 'evidence_backed',
      },
    ],
  });

  assert.ok(graph.nodes.some((n) => n.id === 'name:blade-runner'), 'name fallback id');
  const edge = graph.edges.find((e) => e.type === 'connection');
  assert.equal(edge.source, 'name:blade-runner');
  assert.equal(edge.target, 'name:vangelis');
  assert.equal(edge.weight, 0.9, 'evidence percent / 100');
  assert.equal(edge.confidence, 'evidence_backed');
});

test('options and tolerance: includeTags off, malformed skipped, self-edges dropped', () => {
  const withTags = buildContextGraph({
    anchor: ANCHOR,
    layers: { sound: { genres: [{ id: 'g1', name: 'Ambient' }] } },
  });
  assert.equal(withTags.stats.nodesByKind.tag, 1);
  assert.equal(GRAPH_DEFAULTS.includeTags, true);

  const withoutTags = buildContextGraph(
    { anchor: ANCHOR, layers: { sound: { genres: [{ id: 'g1', name: 'Ambient' }] } } },
    { includeTags: false }
  );
  assert.equal(withoutTags.stats.nodesByKind.tag, 0);
  assert.equal(withoutTags.stats.nodes, 1);

  const tolerant = buildContextGraph({
    anchor: ANCHOR,
    layers: { sound: { artists: [null, {}, { name: '' }, { id: 'a1', name: 'Ok' }] } },
    connections: [{ source: { name: 'Blade Runner' }, target: { name: 'Blade Runner' } }],
  });
  assert.ok(tolerant.stats.skipped >= 3, 'malformed counted, never thrown');
  assert.equal(tolerant.stats.nodesByKind.entity, 2, 'a1 + the connection name node');
  assert.ok(!tolerant.edges.some((e) => e.source === e.target), 'self-edges dropped');
});

test('outputs: frozen, serializable, deterministic; empty dossier safe', () => {
  const data = () => ({
    anchor: ANCHOR,
    resolved: { entity: { id: 'e-br', name: 'Blade Runner', category: 'film' } },
  });

  const graph = buildContextGraph(data());
  assert.deepEqual(buildContextGraph(data()), graph, 'cross-run identical');
  assert.ok(Object.isFrozen(graph));
  assert.ok(Object.isFrozen(graph.nodes));
  assert.ok(Object.isFrozen(graph.nodes[0]));
  assert.ok(Object.isFrozen(graph.edges));
  assert.ok(Object.isFrozen(graph.stats));
  assert.throws(() => {
    graph.nodes[0].kind = 'tag';
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(graph)).stats.nodes, 2, 'serializable');
  assert.deepEqual([...GRAPH_NODE_KINDS], ['anchor', 'entity', 'tag']);
  assert.deepEqual([...GRAPH_EDGE_TYPES], ['resolves', 'cross_domain', 'affinity', 'tagged', 'connection']);

  const empty = buildContextGraph();
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
  assert.equal(empty.stats.nodes, 0);
});

test('composition: a full mini-dossier assembles into one graph', () => {
  const graph = buildContextGraph({
    anchor: ANCHOR,
    resolved: { entity: { id: 'e-br', name: 'Blade Runner', category: 'film' } },
    expansion: {
      domains: [
        { domain: 'music', entities: [{ id: 'm1', name: 'Vangelis', affinity: 0.9 }] },
        { domain: 'books', entities: [{ id: 'b1', name: 'Meditations', affinity: 0.75 }] },
      ],
    },
    layers: {
      sound: {
        artists: [{ id: 'm1', name: 'Vangelis', affinity: 0.9 }],
        genres: [{ id: 'urn:tag:genre:music:ambient', name: 'Ambient', weight: 0.5 }],
      },
      visual: {
        films: [{ id: 'f1', name: 'Neon City', affinity: 0.8 }],
        cinematography: [{ id: 'urn:tag:genre:media:deep_focus', name: 'Deep Focus' }],
      },
    },
    connections: [
      {
        source: { name: 'Blade Runner' },
        target: { name: 'Vangelis', affinity: 0.9 },
        evidence: { percent: 90 },
        confidence: 'evidence_backed',
      },
    ],
  });

  assert.deepEqual({ ...graph.stats.nodesByKind }, { anchor: 1, entity: 6, tag: 2 });
  assert.deepEqual({ ...graph.stats.edgesByType }, {
    resolves: 1, cross_domain: 2, affinity: 2, tagged: 2, connection: 1,
  });
  assert.equal(graph.stats.nodes, 9);
  assert.equal(graph.stats.edges, 8);
  // Every edge endpoint exists as a node (the assembly invariant).
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.ok(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});

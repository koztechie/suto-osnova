/**
 * ContextGraph (task 68) — assembly of the CONTEXT GRAPH for
 * relationship visualization: deterministic `nodes[]` + `edges[]`
 * arrays in the shape every force-directed renderer consumes.
 *
 * WHAT IT COLLECTS (tolerant walk over the dossier, fixed section
 * order = deterministic output):
 *   anchor     — the seed itself (kind `anchor`);
 *   resolved   — the task-47 resolution: anchor -resolves-> entity;
 *   expansion  — task-49/50 domain buckets: anchor -cross_domain->
 *                each neighbor entity (weight = affinity);
 *   layers     — tasks 51-55 extractor records: entity arrays
 *                (artists, albums, authors, objects, venues, films)
 *                become `entity` nodes with anchor -affinity-> edges;
 *                tag arrays (genres, architecture, textures, clothing
 *                styles, drinks, traditions, venue types,
 *                cinematography, colors, art schools) become `tag`
 *                nodes with anchor -tagged-> edges (weight = the
 *                entry's carrier share when present);
 *   connections — task-65 annotated connections: -connection-> edges
 *                carrying weight (evidence percent / 100) and the
 *                derived confidence.
 *
 * ID POLICY: prefer the real entity id / tag URN; fall back to
 * `name:<slug>` for connection endpoints that carry only names.
 * DEDUP: nodes merge by id (first occurrence wins, missing fields
 * filled); edges dedup by type+source+target keeping the MAX weight.
 * Entity nodes carry the task-57 uniqueness coefficient when
 * popularity exists (the renderer's rarity color scale).
 *
 * Every edge references an existing node by construction; malformed
 * entries are dropped and counted (stats.skipped), never thrown. Pure
 * engine module: reuses the task-57 coefficient; no I/O, no clocks,
 * no RNG.
 */

import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Node kinds and edge types (exported visualization contract). */
export const GRAPH_NODE_KINDS = Object.freeze(['anchor', 'entity', 'tag']);
export const GRAPH_EDGE_TYPES = Object.freeze([
  'resolves',
  'cross_domain',
  'affinity',
  'tagged',
  'connection',
]);

/** Options (exported contract). */
export const GRAPH_DEFAULTS = Object.freeze({
  includeTags: true,
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const normalizeName = (value) =>
  (typeof value === 'string' ? value : '').trim().toLowerCase().replace(/\s+/g, ' ');

const slug = (value) => normalizeName(value).replace(/[^\p{L}\p{N}]+/gu, '-');

const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Stable node id: real id, URN, or a name slug fallback. */
function nodeKey(entry, prefix = '') {
  const id = nonEmptyString(entry?.id);
  if (id) return id;
  const name = nonEmptyString(entry?.name);
  return name ? `${prefix}name:${slug(name)}` : null;
}

/**
 * Assembles the context graph from a dossier record.
 *
 * @param {object} dossier {anchor, resolved, expansion, layers:
 *        {sound, literary, material, gastronomy, visual}, connections}.
 * @param {object} [options] GRAPH_DEFAULTS overrides.
 * @returns {Readonly<{nodes, edges, stats}>} frozen: nodes carry
 *          {id, kind, label, domain, popularity, uniqueness}; edges
 *          carry {source, target, type, weight, confidence}; stats
 *          {nodes, edges, nodesByKind, edgesByType, skipped}.
 */
export function buildContextGraph(dossier = {}, options = {}) {
  const { includeTags } = { ...GRAPH_DEFAULTS, ...options };

  const nodes = new Map();
  const edges = new Map();
  let skipped = 0;

  const addNode = (entry, kind, prefix = '') => {
    if (!entry || typeof entry !== 'object') {
      skipped += 1;
      return null;
    }
    const id = nodeKey(entry, prefix);
    if (id === null) {
      skipped += 1;
      return null;
    }
    if (!nodes.has(id)) {
      const popularity = finiteNumber(entry.popularity);
      nodes.set(
        id,
        Object.freeze({
          id,
          kind,
          label: nonEmptyString(entry.name) ?? id,
          domain: nonEmptyString(entry.domain ?? entry.category) ?? null,
          popularity,
          uniqueness:
            popularity === null
              ? null
              : uniquenessCoefficient(popularity).coefficient,
        })
      );
    } else if (kind === 'anchor') {
      // The anchor outranks any earlier incidental mention.
      const existing = nodes.get(id);
      nodes.set(
        id,
        Object.freeze({ ...existing, kind: 'anchor', label: nonEmptyString(entry.name) ?? existing.label })
      );
    }
    return id;
  };

  const addEdge = (source, target, type, weight, confidence = null) => {
    if (source === null || target === null || source === target) return;
    const key = `${type}:${source}:${target}`;
    const existing = edges.get(key);
    const rounded = weight === null ? null : round6(Math.min(1, Math.max(0, weight)));
    if (existing !== undefined) {
      // Dedup: keep the strongest evidence for the same relationship.
      if ((rounded ?? -1) > (existing.weight ?? -1)) {
        edges.set(key, Object.freeze({ ...existing, weight: rounded }));
      }
      return;
    }
    edges.set(
      key,
      Object.freeze({ source, target, type, weight: rounded, confidence })
    );
  };

  const anchor = dossier?.anchor ?? {};
  const anchorId = addNode(anchor, 'anchor');

  // resolved (task 47).
  const resolvedEntity = dossier?.resolved?.entity ?? dossier?.resolved ?? null;
  if (resolvedEntity && typeof resolvedEntity === 'object') {
    const resolvedId = addNode(resolvedEntity, 'entity');
    addEdge(anchorId, resolvedId, 'resolves', 1);
  }

  // expansion (tasks 49/50).
  for (const record of dossier?.expansion?.domains ?? []) {
    for (const entity of record?.entities ?? []) {
      const id = addNode(entity, 'entity');
      addEdge(anchorId, id, 'cross_domain', finiteNumber(entity?.affinity));
    }
  }

  // extractor layers (tasks 51-55).
  const LAYER_ENTITY_KEYS = ['artists', 'albums', 'authors', 'objects', 'venues', 'films'];
  const LAYER_TAG_KEYS = [
    'genres', 'architecture', 'textures', 'clothingStyles',
    'drinks', 'traditions', 'venueTypes', 'cinematography',
    'colorSolutions', 'artSchools',
  ];
  for (const layer of Object.values(dossier?.layers ?? {})) {
    if (!layer || typeof layer !== 'object') continue;
    for (const key of LAYER_ENTITY_KEYS) {
      for (const entity of layer[key] ?? []) {
        const id = addNode(entity, 'entity');
        const weight =
          finiteNumber(entity?.affinity) ??
          (entity?.connection?.percent !== undefined
            ? finiteNumber(entity.connection.percent) / 100
            : null);
        addEdge(anchorId, id, 'affinity', weight);
      }
    }
    if (includeTags) {
      for (const key of LAYER_TAG_KEYS) {
        for (const tag of layer[key] ?? []) {
          const id = addNode(tag, 'tag', 'tag:');
          const weight = finiteNumber(tag?.weight);
          addEdge(anchorId, id, 'tagged', weight);
        }
      }
    }
  }

  // annotated connections (task 65).
  for (const connection of dossier?.connections ?? []) {
    if (!connection || typeof connection !== 'object') continue;
    const source = addNode(connection.source, 'entity');
    const target = addNode(connection.target, 'entity');
    const percent = finiteNumber(connection?.evidence?.percent);
    const weight =
      percent !== null
        ? percent / 100
        : finiteNumber(connection?.target?.affinity) ??
          finiteNumber(connection?.source?.affinity);
    addEdge(source, target, 'connection', weight, connection.confidence ?? null);
  }

  const nodesByKind = { anchor: 0, entity: 0, tag: 0 };
  for (const node of nodes.values()) nodesByKind[node.kind] += 1;
  const edgesByType = {};
  for (const type of GRAPH_EDGE_TYPES) edgesByType[type] = 0;
  for (const edge of edges.values()) edgesByType[edge.type] += 1;

  return Object.freeze({
    nodes: Object.freeze([...nodes.values()]),
    edges: Object.freeze([...edges.values()]),
    stats: Object.freeze({
      nodes: nodes.size,
      edges: edges.size,
      nodesByKind: Object.freeze(nodesByKind),
      edgesByType: Object.freeze(edgesByType),
      skipped,
    }),
  });
}

const contextGraph = {
  buildContextGraph,
  GRAPH_NODE_KINDS,
  GRAPH_EDGE_TYPES,
  GRAPH_DEFAULTS,
};

export default contextGraph;

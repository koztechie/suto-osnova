/**
 * GraphWeights (task 69) — generation of NUMERIC edge weights for the
 * client-side interactive graph map.
 *
 * WHAT IT FIXES: task-68 emits structural edges with `weight: null`
 * (no measurement attached). Interactive renderers need EVERY link to
 * be a finite number in (0, 1] to drive link distance/thickness. This
 * module post-processes a context graph and guarantees that.
 *
 * THE WEIGHT MODEL (deterministic, documented):
 *   base      = the measured weight when present, else the exported
 *               TYPE PRIOR (resolves 1.0 — the anchor's own edge;
 *               connection 0.6; cross_domain/affinity 0.5; tagged 0.3
 *               — carrier-share edges are abundant and thin);
 *   boosted   = min(1, base * (1 + rarityBoost * U(target))) — the
 *               TASK-57 uniqueness of the TARGET node buys visual
 *               prominence (default rarityBoost 0.25: a microtail
 *               target adds up to 25% link weight — the project's
 *               long-tail emphasis made visible, capped at 1);
 *   scale     = 'absolute' (default: the boosted value as-is) or
 *               'relative' (min-max across THIS graph, weakest -> 0,
 *               strongest -> 1; a degenerate all-equal graph -> all 1,
 *               the task-60 convention).
 *
 * NODE STRENGTH (client sizing): strength(n) = 1 - Π(1 - w) over the
 * incident edges — the probabilistic OR: many strong links make a
 * strong node; order-independent, bounded [0, 1], 0 for isolates.
 *
 * Output: a NEW frozen graph (input never mutated): nodes gain
 * `strength`, edges carry {weight (numeric), base, boosted}, stats
 * report {minWeight, maxWeight, meanWeight, byType}. Pure engine
 * module; reuses the task-57 coefficient; no I/O, no clocks, no RNG.
 */

import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Documented defaults (exported tuning contract). */
export const WEIGHT_DEFAULTS = Object.freeze({
  rarityBoost: 0.25,
  mode: 'absolute',
  typePriors: Object.freeze({
    resolves: 1,
    cross_domain: 0.5,
    affinity: 0.5,
    tagged: 0.3,
    connection: 0.6,
  }),
});

export const WEIGHT_MODES = Object.freeze(['absolute', 'relative']);

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const validateOptions = (options) => {
  if (!WEIGHT_MODES.includes(options.mode)) {
    throw new TypeError(`generateEdgeWeights: mode must be one of ${WEIGHT_MODES.join(' | ')}`);
  }
  const { rarityBoost, typePriors } = options;
  if (typeof rarityBoost !== 'number' || !(rarityBoost >= 0 && rarityBoost <= 1)) {
    throw new TypeError('generateEdgeWeights: rarityBoost must be a number in [0, 1]');
  }
  if (!typePriors || typeof typePriors !== 'object') {
    throw new TypeError('generateEdgeWeights: typePriors must be an object');
  }
  for (const [type, prior] of Object.entries(typePriors)) {
    if (typeof prior !== 'number' || !(prior > 0 && prior <= 1)) {
      throw new TypeError(`generateEdgeWeights: typePriors.${type} must be a number in (0, 1]`);
    }
  }
};

/**
 * The client-ready weighted graph.
 *
 * @param {{nodes, edges}} graph a task-68 context graph (tolerated:
 *        missing arrays treated as empty).
 * @param {object} [options] WEIGHT_DEFAULTS overrides (validated).
 * @returns {Readonly<{nodes, edges, stats}>} frozen; input untouched.
 */
export function generateEdgeWeights(graph = {}, options = {}) {
  const resolved = { ...WEIGHT_DEFAULTS, ...options };
  validateOptions(resolved);

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const weighted = edges.map((edge) => {
    const target = nodeById.get(edge?.target);
    const rarity =
      finiteNumber(target?.uniqueness) ??
      (finiteNumber(target?.popularity) !== null
        ? uniquenessCoefficient(target.popularity).coefficient
        : 0);
    const base =
      finiteNumber(edge?.weight) ?? resolved.typePriors[edge?.type] ?? 0.5;
    const boosted = clamp01(base * (1 + resolved.rarityBoost * (rarity ?? 0)));
    return { edge, base: round6(base), boosted: round6(boosted) };
  });

  let min = weighted.length > 0 ? Math.min(...weighted.map((w) => w.boosted)) : null;
  let max = weighted.length > 0 ? Math.max(...weighted.map((w) => w.boosted)) : null;
  const relative = resolved.mode === 'relative' && min !== null && min !== max;

  const outEdges = Object.freeze(
    weighted.map(({ edge, base, boosted }) =>
      Object.freeze({
        ...edge,
        weight: relative ? round6((boosted - min) / (max - min)) : boosted,
        base,
        boosted,
      })
    )
  );

  // Node strength: 1 - Π(1 - w) over incident edges (order-independent).
  const strengthById = new Map(nodes.map((node) => [node.id, 1]));
  for (const edge of outEdges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (strengthById.has(endpoint)) {
        strengthById.set(endpoint, strengthById.get(endpoint) * (1 - (edge.weight ?? 0)));
      }
    }
  }
  const outNodes = Object.freeze(
    nodes.map((node) =>
      Object.freeze({
        ...node,
        strength: round6(1 - (strengthById.get(node.id) ?? 1)),
      })
    )
  );

  const weights = outEdges.map((e) => e.weight);
  const byType = {};
  for (const edge of outEdges) {
    if (byType[edge.type] === undefined) {
      byType[edge.type] = { count: 0, sum: 0 };
    }
    byType[edge.type].count += 1;
    byType[edge.type].sum += edge.weight;
  }
  const frozenByType = Object.freeze(
    Object.fromEntries(
      Object.entries(byType).map(([type, v]) => [
        type,
        Object.freeze({ count: v.count, meanWeight: round6(v.sum / v.count) }),
      ])
    )
  );

  return Object.freeze({
    nodes: outNodes,
    edges: outEdges,
    stats: Object.freeze({
      nodes: outNodes.length,
      edges: outEdges.length,
      minWeight: min === null ? null : round6(Math.min(...weights)),
      maxWeight: max === null ? null : round6(Math.max(...weights)),
      meanWeight:
        weights.length > 0 ? round6(weights.reduce((s, w) => s + w, 0) / weights.length) : null,
      byType: frozenByType,
    }),
  });
}

const graphWeights = {
  generateEdgeWeights,
  WEIGHT_DEFAULTS,
  WEIGHT_MODES,
};

export default graphWeights;

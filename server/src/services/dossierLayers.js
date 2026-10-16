/**
 * DossierLayers (task 75) — CONCURRENT composition of the five
 * extraction layers (tasks 51-55): one wave instead of five
 * sequential round-trips.
 *
 * Before this module the golden scenarios awaited the layers one by
 * one (`await sound; await literary; ...`) — five serial network
 * round-trips where each layer internally parallelized only ITS OWN
 * legs. extractAllLayers lifts the parallelism to the orchestration
 * level: all five services start together through runParallelTasks
 * (allSettled isolation + bounded lanes), so on real upstreams the
 * wall time collapses from sum(RTT) to ~max(RTT).
 *
 * FAILURE MODEL (mirrors tasks 51-55): a failing layer never aborts
 * its siblings — it lands in `failures` as {layer, message} with
 * `coverage[layer] = false`; every layer result is frozen by its
 * service already. Clients (affinityFn/searchFn/tagsFn) are injected
 * ONCE and shared by all five services — each ignores options it does
 * not use, so a single stub/config serves the whole batch.
 *
 * Pure orchestration: no I/O of its own (the services do the I/O),
 * no clocks, no RNG.
 */

import { extractSoundProfile } from './soundExtractor.js';
import { extractLiteraryProfile } from './literaryExtractor.js';
import { extractMaterialProfile } from './materialCultureExtractor.js';
import { extractGastronomyContext } from './gastronomyExtractor.js';
import { extractVisualContext } from './visualContextExtractor.js';
import { runParallelTasks } from './parallelTasks.js';

/** The five dossier layers, in canonical report order. */
export const DOSSIER_LAYERS = Object.freeze([
  'sound', 'literary', 'material', 'gastronomy', 'visual',
]);

/**
 * Extracts ALL dossier layers for one anchor, concurrently.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the resolved seed (task 47 shape).
 * @param {object} [clients] shared injectables (affinityFn, searchFn,
 *        tagsFn) passed to every service.
 * @param {{concurrency?: number}} [options] bounded lanes (default: all
 *        five at once).
 * @returns {Readonly<{layers, failures, coverage}>} frozen: layers
 *          holds each service record (null when that layer failed);
 *          failures lists {layer, message}; coverage flags the
 *          successful layers.
 * @throws {TypeError} on an invalid anchor shape (programmer error —
 *         the services' own typed validation covers data errors).
 */
export async function extractAllLayers(anchor, clients = {}, options = {}) {
  if (!anchor || typeof anchor !== 'object' || typeof anchor.id !== 'string' || anchor.id.length === 0) {
    throw new TypeError('extractAllLayers: anchor must carry a non-empty string id');
  }

  const specs = {
    sound: () => extractSoundProfile(anchor, clients),
    literary: () => extractLiteraryProfile(anchor, clients),
    material: () => extractMaterialProfile(anchor, clients),
    gastronomy: () => extractGastronomyContext(anchor, clients),
    visual: () => extractVisualContext(anchor, clients),
  };

  const results = await runParallelTasks(
    DOSSIER_LAYERS.map((layer) => ({ name: layer, run: specs[layer] })),
    { concurrency: options.concurrency }
  );

  const layers = {};
  const coverage = {};
  const failures = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      layers[result.name] = result.value;
      coverage[result.name] = true;
    } else {
      layers[result.name] = null;
      coverage[result.name] = false;
      failures.push(
        Object.freeze({
          layer: result.name,
          message: String(result.reason?.message ?? result.reason).slice(0, 300),
        })
      );
    }
  }

  return Object.freeze({
    layers: Object.freeze(layers),
    failures: Object.freeze(failures),
    coverage: Object.freeze(coverage),
  });
}

const dossierLayers = {
  extractAllLayers,
  DOSSIER_LAYERS,
};

export default dossierLayers;

/**
 * JsonExporter (task 103) — STANDARDIZED JSON export of a mode's
 * results for third-party pipelines over the API.
 *
 * THE CONTRACT, NOT THE ACCIDENT: unlike JSON.stringify(bundle),
 * this exporter emits a CLOSED, VERSIONED envelope — a fixed key
 * order, an explicit data/meta split, and a json-safe transform —
 * so a consumer's parser does not break when the internal bundle
 * grows a new field. Only the keys on the exported lists ever leave:
 *
 *   fixed  : schema, version, mode, output, requestId, seed,
 *            entity (the stable identity triple id/name/category);
 *   data   : the DOMAIN PAYLOAD (exported DATA_KEYS) — ranked,
 *            layers, curation, resonance, antithesis, ...;
 *   meta   : the PROVENANCE / LEDGER (exported META_KEYS) —
 *            resolution, expansion, chain, coverage, synthesis,
 *            validation, failures, stats.
 * Anything else on the bundle (internal session FSM records,
 * scratch fields) is DROPPED by design — the raw bundle remains the
 * internal surface; this is the external contract.
 *
 * JSON-SAFETY: a recursive transform maps non-finite numbers to
 * null (JSON cannot hold Infinity/NaN — honest null, never a
 * silently-corrupted 0), drops undefined/function/symbol values from
 * objects, and keeps array positions (a dropped slot becomes null).
 *
 * DETERMINISM (no clocks): there is NO timestamp unless the CALLER
 * supplies one via `options.now` — a pure run stays byte-identical;
 * an API caller that wants `generatedAt` injects it explicitly.
 *
 * Surfaces: exportJson(bundle, options) -> the frozen envelope;
 * stringifyJson(bundle, options) -> the JSON string (options.indent,
 * default 2, 0 = compact). Pinned by server/test/jsonExporter.test.js.
 */

import { MODES } from '../engine/ModeDispatcher.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** The schema id + exporter version (the API contract identity). */
export const DOSSIER_SCHEMA = 'suto-osnova.dossier/v1';
export const JSON_EXPORTER_VERSION = 1;

/** The DOMAIN PAYLOAD keys (exported tuning contract). */
export const DATA_KEYS = Object.freeze([
  'scene', 'ranked', 'layers', 'connections', 'tonality', 'graph', 'weights',
  'audience', 'curation', 'resonance', 'foodZones', 'afterparty',
  'antithesis', 'selection',
]);

/** The PROVENANCE / LEDGER keys (exported tuning contract). */
export const META_KEYS = Object.freeze([
  'resolution', 'expansion', 'chain', 'coverage', 'synthesis',
  'validation', 'failures', 'stats',
]);

const jsonSafe = (value) => {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'number') return Number.isFinite(value) ? value : null;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    return undefined; // dropped from objects
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const safe = jsonSafe(item);
      return safe === undefined ? null : safe; // array slots keep their position
    });
  }
  if (type === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const safe = jsonSafe(item);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }
  return undefined;
};

const pick = (source, keys) => {
  const out = {};
  for (const key of keys) {
    if (source?.[key] !== undefined) out[key] = source[key];
  }
  return out;
};

/**
 * Build the standardized JSON envelope for a mode bundle.
 *
 * @param {object} bundle a frozen runWorldbuilder / runExperiential
 *        / runAntithesis result.
 * @param {object} [options] { now } an optional caller-supplied ISO
 *        timestamp (emitted as `generatedAt`; absent by default to
 *        keep pure runs deterministic).
 * @returns {Readonly<object>} the frozen, json-safe envelope.
 */
export function exportJson(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.mode !== 'string') {
    throw new TypeError('exportJson: bundle must carry a string `mode`');
  }
  if (options.now !== undefined && typeof options.now !== 'string') {
    throw new TypeError('exportJson: options.now must be an ISO timestamp string');
  }

  const envelope = {
    schema: DOSSIER_SCHEMA,
    version: JSON_EXPORTER_VERSION,
    ...(options.now !== undefined ? { generatedAt: options.now } : {}),
    mode: bundle.mode,
    output: MODES[bundle.mode]?.output ?? null,
    requestId: bundle.requestId ?? null,
    seed: bundle.seed ?? null,
    entity: pick(bundle.entity, ['id', 'name', 'category']),
    data: pick(bundle, DATA_KEYS),
    meta: pick(bundle, META_KEYS),
  };
  return deepFreeze(jsonSafe(envelope));
}

/**
 * The JSON string form (options.indent: 2 by default, 0 = compact).
 */
export function stringifyJson(bundle, options = {}) {
  const indent = options.indent ?? 2;
  if (!Number.isInteger(indent) || indent < 0 || indent > 8) {
    throw new TypeError('stringifyJson: options.indent must be an integer in 0..8');
  }
  const envelope = exportJson(bundle, options);
  return indent > 0 ? JSON.stringify(envelope, null, indent) : JSON.stringify(envelope);
}

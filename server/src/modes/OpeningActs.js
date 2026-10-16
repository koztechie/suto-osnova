/**
 * OpeningActs (task 90) — the OPENING ACTS SELECTION ALGORITHM: pick
 * the support bill whose fans are MOSTLY ALSO the headliner's fans,
 * measured on three independent, honestly-renormalized signals:
 *
 *   1. GRAPH AFFINITY — the candidate's taste-graph affinity to the
 *      headliner's expansion vector (the Mode-2 music-domain picks);
 *   2. AUDIENCE OVERLAP — containment of the candidate's audience
 *      fingerprint in the headliner's: |candidate∩headliner| /
 *      |candidate| over the Qloo audience-insights top lists (task
 *      88 fingerprints). Containment, NOT Jaccard: an opening act
 *      earns its slot when ITS fans mostly already belong to the
 *      main audience — a big act sharing 3 of its 100 fans with the
 *      headliner is not an opening act;
 *   3. TAG KINSHIP — the engine's rarity-weighted Jaccard (task 59
 *      tagKinship, reused) between headliner and candidate tags.
 *
 * THE SCORE: weighted sum with ABSENT-SIGNAL RENORMALIZATION (the
 * house discipline, task 48): weights redistribute over the
 * components a candidate actually has; a candidate with NO evidence
 * at all is rejected (`no_evidence`), never silently zero-scored.
 * Default weights: graph 0.45 / audience 0.40 / tags 0.15.
 *
 * THE GATES (auditable rejection ledger):
 *   - below_min_audience_overlap — audience data present but the
 *     containment ratio is under minAudienceOverlap (default 0.2):
 *     the "high taste overlap" requirement of the brief, machine-
 *     checked; a candidate WITHOUT audience data is not rejected by
 *     this gate (unproven is not proven-failing — it just cannot
 *     earn the audience component);
 *   - max_popularity — optional ceiling for headliner-friendly
 *     support booking (a support act outshining the bill);
 *   - no_evidence.
 *
 * Deterministic (score round to 12dp, ties break by name), pure, no
 * clocks. Surfaces: selectOpeningActs(pieces, options); the adapters
 * piecesFromActivation(bundle, options) and fingerprintMapFromReport
 * report) bridge a runExperiential bundle + an analyzeAudience
 * report into the algorithm's pieces. Pinned by
 * server/test/openingActs.test.js.
 */

import { tagKinship } from '../engine/AffinityScorer.js';

/** Algorithm version. */
export const OPENING_ACTS_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const OPENING_ACTS_DEFAULTS = Object.freeze({
  maxActs: 5,
  minAudienceOverlap: 0.2,
  weights: Object.freeze({ graph: 0.45, audience: 0.4, tags: 0.15 }),
});

/** Machine-readable rejection reasons. */
export const OPENING_ACTS_REASONS = Object.freeze({
  NO_EVIDENCE: 'no_evidence',
  BELOW_MIN_OVERLAP: 'below_min_audience_overlap',
  MAX_POPULARITY: 'max_popularity',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const names = (list) => (Array.isArray(list)
  ? [...new Set(list.filter((n) => typeof n === 'string' && n.length > 0))]
  : []);

/** Containment of the candidate fingerprint in the headliner's. */
export const audienceOverlap = (headlinerTop, candidateTop) => {
  const a = names(headlinerTop);
  const b = names(candidateTop);
  if (a.length === 0 || b.length === 0) return null;
  const setA = new Set(a.map((n) => n.toLowerCase()));
  let shared = 0;
  for (const n of b) if (setA.has(n.toLowerCase())) shared += 1;
  return Object.freeze({ ratio: round12(shared / b.length), shared, size: b.length });
};

/**
 * Select the opening acts.
 *
 * @param {object} pieces { headliner: {name, tags?, audienceTop?},
 *        candidates: [{id?, name, graphAffinity?, popularity?,
 *        tags?, audienceTop?}] }.
 * @param {object} [options] { maxActs, minAudienceOverlap, weights,
 *        maxPopularity }.
 * @returns {Readonly<object>} the frozen selection.
 */
export function selectOpeningActs(pieces, options = {}) {
  if (!pieces || typeof pieces !== 'object' || !pieces.headliner
    || typeof pieces.headliner.name !== 'string'
    || pieces.headliner.name.length === 0) {
    throw new TypeError('selectOpeningActs: pieces.headliner must carry a non-empty name');
  }
  if (!Array.isArray(pieces.candidates)) {
    throw new TypeError('selectOpeningActs: pieces.candidates must be an array');
  }

  const maxActs = options.maxActs ?? OPENING_ACTS_DEFAULTS.maxActs;
  if (!Number.isInteger(maxActs) || maxActs < 1 || maxActs > 25) {
    throw new TypeError('selectOpeningActs: maxActs must be an integer in 1..25');
  }
  const minOverlap = options.minAudienceOverlap ?? OPENING_ACTS_DEFAULTS.minAudienceOverlap;
  if (typeof minOverlap !== 'number' || !Number.isFinite(minOverlap)
    || minOverlap < 0 || minOverlap > 1) {
    throw new TypeError('selectOpeningActs: minAudienceOverlap must be in 0..1');
  }
  const maxPopularity = options.maxPopularity ?? null;
  if (maxPopularity !== null && (typeof maxPopularity !== 'number'
    || !Number.isFinite(maxPopularity) || maxPopularity < 0 || maxPopularity > 1)) {
    throw new TypeError('selectOpeningActs: maxPopularity must be in 0..1');
  }
  const weights = { ...OPENING_ACTS_DEFAULTS.weights, ...(options.weights ?? {}) };
  for (const [key, value] of Object.entries(weights)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`selectOpeningActs: weights.${key} must be a finite number >= 0`);
    }
    if (!['graph', 'audience', 'tags'].includes(key)) {
      throw new TypeError(`selectOpeningActs: unknown weight "${key}"`);
    }
  }
  if (weights.graph + weights.audience + weights.tags <= 0) {
    throw new TypeError('selectOpeningActs: at least one weight must be positive');
  }

  const headlinerTags = Array.isArray(pieces.headliner.tags) ? pieces.headliner.tags : [];
  const headlinerTop = pieces.headliner.audienceTop;

  const selected = [];
  const rejected = [];
  let withAudienceData = 0;

  for (const candidate of pieces.candidates) {
    if (!candidate || typeof candidate.name !== 'string' || candidate.name.length === 0) {
      throw new TypeError('selectOpeningActs: every candidate needs a non-empty name');
    }

    const graph = finite(candidate.graphAffinity);
    const overlap = audienceOverlap(headlinerTop, candidate.audienceTop);
    if (overlap !== null) withAudienceData += 1;
    // tagKinship returns a record ({value, jaccard, shared}) or null
    // when either side has no tags — the component is the value.
    const kinship = Array.isArray(candidate.tags) && candidate.tags.length > 0
      ? tagKinship({ tags: headlinerTags }, { tags: candidate.tags })
      : null;
    const tags = kinship !== null ? kinship.value : null;

    // Gates first: popularity ceiling, then the overlap floor.
    const popularity = finite(candidate.popularity);
    if (maxPopularity !== null && popularity !== null && popularity > maxPopularity) {
      rejected.push(Object.freeze({
        name: candidate.name,
        reason: OPENING_ACTS_REASONS.MAX_POPULARITY,
        popularity,
      }));
      continue;
    }
    if (overlap !== null && overlap.ratio < minOverlap) {
      rejected.push(Object.freeze({
        name: candidate.name,
        reason: OPENING_ACTS_REASONS.BELOW_MIN_OVERLAP,
        overlapRatio: overlap.ratio,
      }));
      continue;
    }

    // The score: weighted sum over AVAILABLE components only.
    const components = { graph, audience: overlap?.ratio ?? null, tags };
    const active = Object.entries(components)
      .filter(([, value]) => value !== null);
    if (active.length === 0) {
      rejected.push(Object.freeze({
        name: candidate.name,
        reason: OPENING_ACTS_REASONS.NO_EVIDENCE,
      }));
      continue;
    }
    const weightSum = active.reduce((sum, [key]) => sum + weights[key], 0);
    const score = round12(
      active.reduce((sum, [key, value]) => sum + weights[key] * value, 0) / weightSum
    );

    selected.push(Object.freeze({
      name: candidate.name,
      id: candidate.id ?? null,
      score,
      components: Object.freeze({
        graph,
        audience: components.audience,
        tags,
      }),
      overlap,
      popularity,
    }));
  }

  selected.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return Object.freeze({
    version: OPENING_ACTS_VERSION,
    headliner: Object.freeze({ name: pieces.headliner.name }),
    weights: Object.freeze({ ...weights }),
    minAudienceOverlap: minOverlap,
    acts: Object.freeze(selected.slice(0, maxActs)),
    rejected: Object.freeze(rejected),
    stats: Object.freeze({
      candidates: pieces.candidates.length,
      selected: Math.min(selected.length, maxActs),
      rejected: rejected.length,
      withAudienceData,
    }),
  });
}

/**
 * Adapter: a runExperiential() bundle (+ optional audience inputs)
 * into algorithm pieces. Music-domain ranked entries become the
 * candidate pool; the headliner's own audience top list comes from
 * `headlinerAudienceTop` (e.g. the single-act analyzeAudience()
 * blended list); `fingerprints` maps candidate names to their
 * audience top lists (e.g. the per-act report rows).
 */
export function piecesFromActivation(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || !bundle.entity
    || typeof bundle.entity.name !== 'string') {
    throw new TypeError('piecesFromActivation: bundle must carry a named entity');
  }
  const fingerprints = options.fingerprints ?? {};
  if (typeof fingerprints !== 'object' || fingerprints === null || Array.isArray(fingerprints)) {
    throw new TypeError('piecesFromActivation: fingerprints must be an object');
  }
  return Object.freeze({
    headliner: Object.freeze({
      name: bundle.entity.name,
      tags: [],
      audienceTop: names(options.headlinerAudienceTop),
    }),
    candidates: Object.freeze(
      (Array.isArray(bundle.ranked) ? bundle.ranked : [])
        .filter((entry) => entry?.domain === 'music')
        .map((entry) => Object.freeze({
          id: entry.id ?? null,
          name: entry.name,
          graphAffinity: finite(entry.affinity),
          popularity: finite(entry.popularity),
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          audienceTop: names(fingerprints[entry.name]),
        }))
    ),
  });
}

/**
 * Adapter: an analyzeAudience() report into the fingerprint map
 * (per-act top names; the blended list is returned separately as the
 * natural headliner audience when the report was a single-act run).
 */
export function fingerprintMapFromReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.perAct)) {
    throw new TypeError('fingerprintMapFromReport: expected an analyzeAudience() report');
  }
  const map = {};
  for (const act of report.perAct) {
    if (act?.name && Array.isArray(act.top)) {
      map[act.name] = act.top.map((row) => row.name).filter(Boolean);
    }
  }
  return Object.freeze({
    fingerprints: Object.freeze(map),
    blendedTop: names(report.blended?.top?.map((row) => row.name)),
  });
}

/**
 * CulturalDistance (task 99) — `calculateCulturalDistance(entityA,
 * entityB)`: a deterministic mechanism for comparing TWO arbitrary
 * cultural entities on a 0..1 distance scale (0 = indistinguishable
 * taste, 1 = maximal MEASURED distance).
 *
 * THE HONEST PREMISE: the system never invents a direct "similarity"
 * the graph did not measure. The distance is a RENORMALIZED weighted
 * mean (task-48 discipline) over the evidence axes the caller
 * actually has:
 *
 *   tags   (weight 0.40) — 1 minus the task-59 rarity-weighted tag
 *          kinship between the two entities' tag sets (a metadata
 *          axis: shared cultural vocabulary);
 *   vector (weight 0.60) — the mean absolute deviation between the
 *          two entities' per-domain AFFINITY PROFILES over the
 *          SHARED domains (a direct taste axis: who the graph says
 *          each entity resonates with). Domains present on only one
 *          side are honestly not comparable and contribute nothing.
 *
 * An axis with no evidence on one side is MISSING and RENORMALIZED
 * OUT — never scored as zero; when NOTHING is comparable the
 * distance is honestly null ("stays uncomputed"). The readout is
 * banded via the exported DISTANCE_BANDS (a documented tuning
 * contract, not psychology): kindred [0, 0.2), adjacent [0.2, 0.5),
 * divergent [0.5, 0.8), antipodal [0.8, 1].
 *
 * SYMMETRIC by construction (tag kinship and absolute deviation are
 * symmetric; component order is fixed). profileFromVector(vector)
 * adapts the task-50 fetchAffinityVector result into a profile
 * ({domain: meanAffinity}) — domains without a single finite
 * affinity are excluded, never zero-filled.
 *
 * Pure module: no I/O, no clocks, no RNG. Pinned by
 * server/test/culturalDistance.test.js.
 */

import { tagKinship } from './AffinityScorer.js';

/** Module version. */
export const CULTURAL_DISTANCE_VERSION = 1;

/** The evidence axes and their weights (exported tuning contract). */
export const DISTANCE_WEIGHTS = Object.freeze({ tags: 0.4, vector: 0.6 });

/** The readout bands (exported tuning contract). */
export const DISTANCE_BANDS = Object.freeze([
  Object.freeze({ band: 'kindred', max: 0.2 }),
  Object.freeze({ band: 'adjacent', max: 0.5 }),
  Object.freeze({ band: 'divergent', max: 0.8 }),
  Object.freeze({ band: 'antipodal', max: 1 }),
]);

/** Machine-readable missing-axis reasons. */
export const DISTANCE_REASONS = Object.freeze({
  NO_TAGS: 'no_tags',
  NO_SHARED_DOMAINS: 'no_shared_domains',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const usableTags = (entity) =>
  (Array.isArray(entity?.tags) ? entity.tags : [])
    .filter((tag) => tag && (typeof tag.id === 'string' || typeof tag.name === 'string'));

/** The band label of a measured distance. */
export const bandOf = (distance) => {
  const value = finite(distance);
  if (value === null) return null;
  return DISTANCE_BANDS.find((entry) => value < entry.max)?.band ?? 'antipodal';
};

/**
 * Adapt a task-50 fetchAffinityVector() result into an affinity
 * profile: {domain: meanAffinity}. Domains without a single finite
 * affinity (error legs, empty pages) are EXCLUDED, never
 * zero-filled.
 */
export function profileFromVector(vector) {
  if (!vector || typeof vector !== 'object' || !Array.isArray(vector.domains)) {
    throw new TypeError('profileFromVector: expected a fetchAffinityVector() result');
  }
  const profile = {};
  for (const record of vector.domains) {
    if (record?.status !== 'ok') continue;
    const rows = Array.isArray(record.page?.results) ? record.page.results : [];
    const values = rows.map((row) => finite(row?.affinity)).filter((v) => v !== null);
    if (values.length === 0) continue;
    profile[record.domain] = round12(
      values.reduce((sum, value) => sum + value, 0) / values.length
    );
  }
  return Object.freeze(profile);
}

/**
 * Calculate the cultural distance between two entities.
 *
 * @param {object} entityA {name?, tags?, profile?}.
 * @param {object} entityB {name?, tags?, profile?}.
 * @param {object} [options] { weights } validated overrides.
 * @returns {Readonly<object>} the frozen result (distance null when
 *          nothing is comparable).
 */
export function calculateCulturalDistance(entityA, entityB, options = {}) {
  if (!entityA || typeof entityA !== 'object' || Array.isArray(entityA)) {
    throw new TypeError('calculateCulturalDistance: entityA must be an object');
  }
  if (!entityB || typeof entityB !== 'object' || Array.isArray(entityB)) {
    throw new TypeError('calculateCulturalDistance: entityB must be an object');
  }
  const weights = { ...DISTANCE_WEIGHTS, ...(options.weights ?? {}) };
  for (const [key, value] of Object.entries(weights)) {
    if (!(key in DISTANCE_WEIGHTS)) {
      throw new TypeError(`calculateCulturalDistance: unknown weight "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`calculateCulturalDistance: weights.${key} must be a finite number >= 0`);
    }
  }
  if (weights.tags + weights.vector <= 0) {
    throw new TypeError('calculateCulturalDistance: at least one weight must be positive');
  }

  const nameA = typeof entityA.name === 'string' ? entityA.name : 'entity A';
  const nameB = typeof entityB.name === 'string' ? entityB.name : 'entity B';

  const components = [];
  const missing = [];
  const record = (key, value, reason, evidence) => {
    if (value === null) {
      missing.push(Object.freeze({ key, reason }));
      return;
    }
    components.push(Object.freeze({
      key,
      weight: weights[key],
      value: round12(value),
      contribution: round12(weights[key] * value),
      evidence,
    }));
  };

  // 1. TAGS axis: 1 minus the task-59 rarity-weighted kinship.
  const tagsA = usableTags(entityA);
  const tagsB = usableTags(entityB);
  if (tagsA.length === 0 || tagsB.length === 0) {
    record('tags', null, DISTANCE_REASONS.NO_TAGS, null);
  } else {
    const kinship = tagKinship({ tags: tagsA }, { tags: tagsB });
    record('tags', 1 - kinship.value, null,
      `${kinship.sharedCount} shared of ${tagsA.length + tagsB.length - kinship.sharedCount} union tag(s)`);
  }

  // 2. VECTOR axis: mean absolute deviation over the SHARED domains.
  const profileA = entityA.profile && typeof entityA.profile === 'object'
    ? entityA.profile : {};
  const profileB = entityB.profile && typeof entityB.profile === 'object'
    ? entityB.profile : {};
  const shared = Object.keys(profileA).filter(
    (domain) => finite(profileA[domain]) !== null && finite(profileB[domain]) !== null
  );
  if (shared.length === 0) {
    record('vector', null, DISTANCE_REASONS.NO_SHARED_DOMAINS, null);
  } else {
    const deviation = shared.reduce(
      (sum, domain) => sum + Math.abs(profileA[domain] - profileB[domain]), 0
    ) / shared.length;
    record('vector', round12(deviation), null, `${shared.length} shared domain(s)`);
  }

  // Renormalized weighted mean over the AVAILABLE axes.
  const totalWeight = weights.tags + weights.vector;
  const availableWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const distance = components.length === 0
    ? null
    : round12(
      components.reduce((sum, c) => sum + c.contribution, 0) / availableWeight
    );

  return Object.freeze({
    version: CULTURAL_DISTANCE_VERSION,
    between: Object.freeze({ a: nameA, b: nameB }),
    distance,
    distancePercent: distance === null ? null : Math.round(distance * 100),
    band: bandOf(distance),
    components: Object.freeze(components),
    missing: Object.freeze(missing),
    method: 'renormalized weighted mean over available axes',
    summary: distance === null
      ? `No shared evidence between ${nameA} and ${nameB} — the cultural distance stays uncomputed.`
      : `Cultural distance ${Math.round(distance * 100)}% (${bandOf(distance)}) between ` +
        `${nameA} and ${nameB}.`,
  });
}

/**
 * AffinityScorer (task 59) — the CULTURAL KINSHIP INDEX between two
 * entities (anchor vs candidate, or any pair), plus the aggregate
 * coherence of a candidate set.
 *
 * INDEX = weighted mean of FOUR named components, RENORMALIZED over
 * the PRESENT ones (the shared convention of tasks 48/56/57 — absent
 * evidence is never scored as zero):
 *
 *   graphAffinity    (0.45) Qloo's own opinion: the cross-domain
 *                          affinity/correlation between the pair;
 *   tagKinship       (0.25) RARITY-WEIGHTED Jaccard over genre tags —
 *                          the distinctive math of this module (below);
 *   nameResemblance  (0.20) hybrid Levenshtein + token containment,
 *                          reused verbatim from the task-48
 *                          candidateRanker (single source of truth);
 *   domainFit        (0.10) same mandatory domain (domainMapper
 *                          vocabulary) = 1; absent when either side is
 *                          unclassified.
 *
 * RARITY-WEIGHTED TAG KINSHIP (why a plain Jaccard is wrong): sharing
 * "Drama" proves nothing — every anchor shares it; sharing a
 * microtail tag proves kinship. Each tag's contribution is weighted by
 * w(t) = 1 + rarityWeight * U(t) with U from the task-57 uniqueness
 * coefficient (tags without popularity -> U null -> base weight 1,
 * honestly unboosted). The value is Σshared w / Σunion w — a weighted
 * Jaccard bounded in [0, 1]: identical tag sets -> 1, disjoint -> 0,
 * and rare shared tags out-count mass shared tags.
 *
 * COHERENCE (aggregate): `coherenceIndex(anchor, candidates)` is the
 * rarity-weighted mean of the pairwise indices — a rare candidate's
 * kinship counts more than a mass one's (weight
 * 1 + coherenceRarityWeight * U(candidate)) — with min/max/mean and
 * the full pair list for audit.
 *
 * HONEST HANDLING: a pair with NO measurable component yields
 * index null (nothing measurable is never guessed as 0). Every result
 * carries the full per-component breakdown. Options validated with
 * TypeError (programmer errors). Pure engine module: no I/O, no
 * clocks, no RNG — imports only sibling engine modules and the
 * task-48 service scorer.
 */

import { MANDATORY_DOMAINS } from '../services/domainMapper.js';
import { nameSimilarity } from '../services/candidateRanker.js';
import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Signal weights (exported tuning contract; partial overrides merge). */
export const KINSHIP_WEIGHTS = Object.freeze({
  graphAffinity: 0.45,
  tagKinship: 0.25,
  nameResemblance: 0.2,
  domainFit: 0.1,
});

/** Rarity boost strength for shared tags (weighted Jaccard bound). */
export const KINSHIP_DEFAULTS = Object.freeze({
  rarityWeight: 0.5,
  coherenceRarityWeight: 0.5,
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const normalizeName = (value) =>
  (typeof value === 'string' ? value : '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Merged weights with validation (mirrors the task-48 convention). */
function mergedWeights(weights) {
  const resolved = { ...KINSHIP_WEIGHTS, ...weights };
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new TypeError('culturalKinship: weights must be a plain object');
  }
  for (const [key, value] of Object.entries(weights)) {
    if (!(key in KINSHIP_WEIGHTS)) {
      throw new TypeError(
        `culturalKinship: unknown weight "${key}" — declared signals: ` +
          Object.keys(KINSHIP_WEIGHTS).join(', ')
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new TypeError(
        `culturalKinship: weight "${key}" must be a finite number > 0`
      );
    }
  }
  return resolved;
}

const validateRarity = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${name} must be a number in [0, 1]`);
  }
};

/** Tag map keyed by URN (fallback: normalized name). */
function tagMap(entity) {
  const map = new Map();
  for (const tag of Array.isArray(entity?.tags) ? entity.tags : []) {
    if (!tag || typeof tag !== 'object') continue;
    const key = nonEmptyString(tag.id) ?? normalizeName(tag.name);
    if (!key || map.has(key)) continue;
    map.set(key, { key, popularity: finiteNumber(tag.popularity) });
  }
  return map;
}

/**
 * RARITY-WEIGHTED Jaccard over two entities' genre tags.
 *
 * @returns {Readonly<{value: number, jaccard: number, sharedCount:
 *          number, shared: string[]}>|null} null when either side has
 *          no tags (component absent -> renormalized out).
 */
export function tagKinship(a, b, options = {}) {
  const rarityWeight = options.rarityWeight ?? KINSHIP_DEFAULTS.rarityWeight;
  validateRarity(rarityWeight, 'tagKinship: rarityWeight');

  const mapA = tagMap(a);
  const mapB = tagMap(b);
  if (mapA.size === 0 || mapB.size === 0) return null;

  const weightOf = (tag) =>
    1 + rarityWeight * (uniquenessCoefficient(tag.popularity ?? null).coefficient ?? 0);

  let sharedWeight = 0;
  let unionWeight = 0;
  const shared = [];

  for (const [key, tagA] of mapA) {
    const tagB = mapB.get(key);
    const wA = weightOf(tagA);
    unionWeight += wA;
    if (tagB !== undefined) {
      sharedWeight += wA; // identical tag -> one shared weight entry
      shared.push(key);
    }
  }
  for (const [key, tagB] of mapB) {
    if (!mapA.has(key)) unionWeight += weightOf(tagB);
  }

  return Object.freeze({
    value: unionWeight > 0 ? round6(sharedWeight / unionWeight) : 0,
    jaccard: round6(shared.length / (mapA.size + mapB.size - shared.length)),
    sharedCount: shared.length,
    shared: Object.freeze(shared),
  });
}

const domainOf = (entity) => {
  const raw = entity?.domain ?? entity?.category ?? null;
  return typeof raw === 'string' && MANDATORY_DOMAINS.includes(raw) ? raw : null;
};

const relevanceOf = (entity) =>
  finiteNumber(entity?.affinity) ?? finiteNumber(entity?.correlation);

/**
 * The cultural kinship index of ONE pair.
 *
 * @param {object} a,b entities: {name?, domain?|category?, tags?,
 *        affinity?|correlation?}.
 * @param {object} [options] {weights (partial override), rarityWeight}.
 * @returns {Readonly<{index: number|null, components: object,
 *          present: string[], missing: string[]}>} frozen; index null
 *          when no component is measurable.
 * @throws {TypeError} on invalid weights/rarity (programmer errors).
 */
export function culturalKinship(a, b, options = {}) {
  const weights = mergedWeights(options.weights ?? {});
  const rarityWeight = options.rarityWeight ?? KINSHIP_DEFAULTS.rarityWeight;
  validateRarity(rarityWeight, 'culturalKinship: rarityWeight');

  const present = {};
  const missing = [];

  // The pair affinity: the CANDIDATE's measured affinity to the
  // anchor first (extractor convention), the anchor's own as a
  // symmetric fallback, or an explicit override.
  const affinity =
    options.affinity ?? relevanceOf(b) ?? relevanceOf(a);
  if (affinity !== null) present.graphAffinity = round6(Math.min(1, Math.max(0, affinity)));
  else missing.push('graphAffinity');

  const tags = tagKinship(a, b, { rarityWeight });
  if (tags !== null) present.tagKinship = tags.value;
  else missing.push('tagKinship');

  const nameA = nonEmptyString(a?.name);
  const nameB = nonEmptyString(b?.name);
  if (nameA !== null && nameB !== null) {
    present.nameResemblance = round6(nameSimilarity(normalizeName(nameA), normalizeName(nameB)));
  } else {
    missing.push('nameResemblance');
  }

  const domainA = domainOf(a);
  const domainB = domainOf(b);
  if (domainA !== null && domainB !== null) {
    present.domainFit = domainA === domainB ? 1 : 0;
  } else {
    missing.push('domainFit');
  }

  let numerator = 0;
  let denominator = 0;
  for (const [signal, value] of Object.entries(present)) {
    numerator += weights[signal] * value;
    denominator += weights[signal];
  }

  return Object.freeze({
    index: denominator > 0 ? round6(numerator / denominator) : null,
    components: Object.freeze(present),
    present: Object.freeze(Object.keys(present)),
    missing: Object.freeze(missing),
  });
}

const validateCoherenceOptions = (options) => {
  validateRarity(
    options.coherenceRarityWeight ?? KINSHIP_DEFAULTS.coherenceRarityWeight,
    'coherenceIndex: coherenceRarityWeight'
  );
};

/**
 * Aggregate coherence of a candidate set with one anchor: the
 * rarity-weighted mean of the pairwise indices.
 *
 * @returns {Readonly<{coherence: number|null, count, measured,
 *          unmeasured, mean, min, max, pairs}>} frozen; coherence null
 *          when no pair is measurable.
 */
export function coherenceIndex(anchor, candidates, options = {}) {
  validateCoherenceOptions(options);
  const coherenceRarityWeight =
    options.coherenceRarityWeight ?? KINSHIP_DEFAULTS.coherenceRarityWeight;

  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && typeof c === 'object')
    : [];

  const pairs = [];
  let weightSum = 0;
  let weightedSum = 0;
  let measured = 0;

  for (const candidate of list) {
    const kinship = culturalKinship(anchor, candidate, options);
    const rarity =
      1 +
      coherenceRarityWeight *
        (uniquenessCoefficient(candidate.popularity ?? null).coefficient ?? 0);
    pairs.push(
      Object.freeze({
        id: candidate.id ?? null,
        name: candidate.name ?? null,
        index: kinship.index,
        weight: round6(rarity),
        components: kinship.components,
      })
    );
    if (kinship.index !== null) {
      measured += 1;
      weightSum += rarity;
      weightedSum += rarity * kinship.index;
    }
  }

  const indices = pairs.map((p) => p.index).filter((v) => v !== null);

  return Object.freeze({
    coherence: measured > 0 ? round6(weightedSum / weightSum) : null,
    count: list.length,
    measured,
    unmeasured: list.length - measured,
    mean: measured > 0 ? round6(indices.reduce((s, v) => s + v, 0) / measured) : null,
    min: indices.length > 0 ? Math.min(...indices) : null,
    max: indices.length > 0 ? Math.max(...indices) : null,
    pairs: Object.freeze(pairs),
  });
}

const affinityScorer = {
  culturalKinship,
  tagKinship,
  coherenceIndex,
  KINSHIP_WEIGHTS,
  KINSHIP_DEFAULTS,
};

export default affinityScorer;

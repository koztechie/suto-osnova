/**
 * CrossDomainExpander (task 49) — the PURE core of cross-domain taste
 * expansion (the AFFINITY_EXPANSION pipeline phase, task 42): from a
 * resolved seed entity, expand the taste profile into the OTHER agent
 * domains and fold the raw Qloo answers into one deterministic,
 * frozen, explainable expansion record.
 *
 * This module is engine-pure: no I/O, no clocks, no RNG. The executor
 * (future task) drives it in two steps:
 *
 *   1. `expansionPlan(seed, options)` — which domains to expand into:
 *      all five mandatory domains EXCEPT the seed's own (a domain does
 *      not expand into itself), in canonical order, or an explicit
 *      caller-ordered subset (validated through domainMapper aliases);
 *   2. the executor calls `getCrossDomainAffinities(seedId, domain)`
 *      per planned domain (crossDomainClient — live I/O with rate
 *      limiting, caching, privacy guard and MOCK_MODE) and hands the
 *      raw pages back:
 *   3. `expandTastes(plan, payloadsByDomain, options)` — tolerant
 *      normalization (client-shaped rows OR raw Qloo rows), self-loop
 *      removal, per-domain and GLOBAL dedup, deterministic ordering
 *      (affinity desc, nulls last, then name, then id), per-domain
 *      weight = share of the domain's affinity mass, per-domain cap
 *      with a `truncated` flag, and explicit COVERAGE reporting (which
 *      planned domains returned nothing — the executor may retry them
 *      with relaxed parameters instead of silently reporting a
 *      half-expanded profile).
 *
 * Anti-fragile properties (pinned by server/test/crossDomainExpander.test.js):
 *   - the seed entity can never appear in its own expansion, and an
 *     entity reached through two domains is kept ONCE (best domain =
 *     the first in canonical plan order that carried it);
 *   - malformed rows are dropped, never thrown (Qloo publishes no
 *     formal schema for these payloads);
 *   - missing affinities rank last with weight 0 — absent data is
 *     visible, never faked;
 *   - `flattenExpansion` yields one global ranked list (weight desc,
 *     then name, then id) for dossier synthesis.
 */

import {
  resolveDomain,
  MANDATORY_DOMAINS,
  DomainMappingError,
} from '../services/domainMapper.js';
import { deepFreeze } from './deepFreeze.js';

/** Typed error for unusable seeds, plans and domain selections. */
export class ExpansionInputError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ExpansionInputError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const EXPANSION_CODES = Object.freeze({
  INVALID_SEED: 'invalid_seed',
  NO_TARGET_DOMAINS: 'no_target_domains',
  INVALID_PLAN: 'invalid_plan',
});

/** Per-domain caps (aligned with the client's documented take ceiling). */
export const EXPANSION_LIMITS = Object.freeze({
  DEFAULT_MAX_PER_DOMAIN: 8,
  MAX_PER_DOMAIN: 50,
});

const clampMax = (value) => {
  if (value === undefined) return EXPANSION_LIMITS.DEFAULT_MAX_PER_DOMAIN;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExpansionInputError(
      'maxPerDomain must be a finite number',
      { code: EXPANSION_CODES.INVALID_PLAN, details: { maxPerDomain: value } }
    );
  }
  return Math.min(EXPANSION_LIMITS.MAX_PER_DOMAIN, Math.max(1, Math.trunc(value)));
};

/**
 * Builds the deterministic expansion plan for a resolved seed.
 *
 * @param {{id: string, domain?: string, category?: string}} seed the
 *        resolved entity (task 47 shape: `entity.category`, or a
 *        plain `{id, domain}`).
 * @param {object} [options]
 * @param {string[]} [options.domains] explicit target domains (agent
 *        vocabulary or aliases, caller order preserved); the seed's
 *        own domain is removed UNLESS `includeSeedDomain` is true.
 * @param {boolean} [options.includeSeedDomain=false] keep the source
 *        domain in the ladder (task 50: the full 5-domain affinity
 *        vector includes same-domain neighbors of the seed).
 * @param {number} [options.maxPerDomain] cap per domain (1..50).
 * @returns {Readonly<{seed: {id: string, domain: string},
 *          domains: string[], maxPerDomain: number}>}
 * @throws {ExpansionInputError} INVALID_SEED | NO_TARGET_DOMAINS
 */
export function expansionPlan(seed, options = {}) {
  if (!seed || typeof seed !== 'object' || typeof seed.id !== 'string' || seed.id.length === 0) {
    throw new ExpansionInputError(
      'expansionPlan: seed must carry a non-empty string id (resolve it first)',
      { code: EXPANSION_CODES.INVALID_SEED, details: { seed } }
    );
  }
  const rawDomain = seed.domain ?? seed.category;
  let domain;
  try {
    domain = resolveDomain(rawDomain);
  } catch (cause) {
    if (!(cause instanceof DomainMappingError)) throw cause;
    throw new ExpansionInputError(
      `expansionPlan: seed domain ${JSON.stringify(rawDomain)} is not one ` +
        `of the five agent domains`,
      { code: EXPANSION_CODES.INVALID_SEED, details: { domain: rawDomain }, cause }
    );
  }

  const includeSeedDomain = options.includeSeedDomain === true;

  let domains;
  if (options.domains === undefined) {
    domains = MANDATORY_DOMAINS.filter((d) => includeSeedDomain || d !== domain);
  } else {
    if (!Array.isArray(options.domains) || options.domains.length === 0) {
      throw new ExpansionInputError(
        'expansionPlan: options.domains must be a non-empty array',
        { code: EXPANSION_CODES.NO_TARGET_DOMAINS, details: { domains: options.domains } }
      );
    }
    const resolved = [];
    for (const entry of options.domains) {
      try {
        const id = resolveDomain(entry);
        if ((includeSeedDomain || id !== domain) && !resolved.includes(id)) {
          resolved.push(id);
        }
      } catch (cause) {
        if (!(cause instanceof DomainMappingError)) throw cause;
        throw new ExpansionInputError(
          `expansionPlan: unknown target domain ${JSON.stringify(entry)}`,
          { code: EXPANSION_CODES.NO_TARGET_DOMAINS, details: { domain: entry }, cause }
        );
      }
    }
    domains = resolved;
  }

  if (domains.length === 0) {
    throw new ExpansionInputError(
      `expansionPlan: no target domains remain after removing the seed's ` +
        `own domain "${domain}" — cross-domain expansion needs at least one ` +
        `(or pass includeSeedDomain: true to expand within it)`,
      { code: EXPANSION_CODES.NO_TARGET_DOMAINS, details: { seedDomain: domain } }
    );
  }

  return Object.freeze({
    seed: Object.freeze({ id: seed.id, domain }),
    domains: Object.freeze([...domains]),
    maxPerDomain: clampMax(options.maxPerDomain),
  });
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Tolerantly normalizes ONE affinity row. Accepts the client's
 * normalized shape ({id, name, affinity, subtype, tags}) and the raw
 * Qloo shape ({entity_id, name, query: {affinity}}); returns null when
 * the row is unusable (no id or no name).
 */
export function normalizeExpansionRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = nonEmptyString(raw.id) ?? nonEmptyString(raw.entity_id);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const queryMeta = raw.query && typeof raw.query === 'object' ? raw.query : {};
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => {
          if (!t || typeof t !== 'object') return null;
          const id_ = nonEmptyString(t.id) ?? nonEmptyString(t.tag_id);
          const tagName = nonEmptyString(t.name);
          if (!id_ && !tagName) return null;
          return Object.freeze({ id: id_, name: tagName, type: nonEmptyString(t.type) });
        })
        .filter(Boolean)
    : [];

  return {
    id,
    name,
    subtype: nonEmptyString(raw.subtype) ?? null,
    popularity: finiteNumber(raw.popularity),
    affinity: finiteNumber(raw.affinity) ?? finiteNumber(queryMeta.affinity),
    tags: Object.freeze(tags),
  };
}

/** Accepts a client page object, a raw payload or a bare row array. */
function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.results?.entities)) return payload.results.entities;
  }
  return [];
}

const byAffinityThenDeterminism = (a, b) =>
  (b.affinity ?? -1) - (a.affinity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/**
 * Folds the raw cross-domain answers into the frozen expansion record.
 *
 * @param {ReturnType<typeof expansionPlan>} plan
 * @param {Record<string, object|object[]>} payloadsByDomain keyed by
 *        canonical domain id; values may be client pages, raw payloads
 *        or bare row arrays. Keys outside the plan are ignored and
 *        counted (the plan is the contract).
 * @param {object} [options] reserved (maxPerDomain override via plan).
 * @returns frozen record {seed, domains, coverage, totals}.
 */
export function expandTastes(plan, payloadsByDomain = {}, options = {}) {
  if (
    !plan ||
    typeof plan !== 'object' ||
    !plan.seed ||
    typeof plan.seed.id !== 'string' ||
    !Array.isArray(plan.domains)
  ) {
    throw new ExpansionInputError(
      'expandTastes: plan must come from expansionPlan()',
      { code: EXPANSION_CODES.INVALID_PLAN, details: { plan } }
    );
  }
  const maxPerDomain = clampMax(options.maxPerDomain ?? plan.maxPerDomain);
  const payloads =
    payloadsByDomain && typeof payloadsByDomain === 'object' ? payloadsByDomain : {};

  const seenGlobal = new Set([plan.seed.id]);
  const domainRecords = [];
  const uncovered = [];
  let totalEntities = 0;
  let totalDuplicates = 0;
  let totalDroppedSelf = 0;
  let totalDroppedInvalid = 0;
  let totalTruncated = 0;

  for (const domain of plan.domains) {
    const rows = extractRows(payloads[domain]);

    const normalized = [];
    let droppedInvalid = 0;
    for (const row of rows) {
      const entity = normalizeExpansionRow(row);
      if (entity === null) {
        droppedInvalid += 1;
        continue;
      }
      normalized.push(entity);
    }

    // Per-domain dedup by id: keep the row with the higher affinity
    // (ties keep the earlier row — Qloo orders by affinity already).
    const byId = new Map();
    for (const entity of normalized) {
      const existing = byId.get(entity.id);
      if (existing === undefined || (entity.affinity ?? -1) > (existing.affinity ?? -1)) {
        byId.set(entity.id, entity);
      }
    }

    let droppedSelf = 0;
    let duplicates = 0;
    const eligible = [];
    for (const entity of byId.values()) {
      if (entity.id === plan.seed.id) {
        droppedSelf += 1;
        continue;
      }
      if (seenGlobal.has(entity.id)) {
        duplicates += 1;
        continue;
      }
      eligible.push(entity);
    }

    eligible.sort(byAffinityThenDeterminism);

    const affinityMass = eligible.reduce(
      (sum, e) => sum + (e.affinity ?? 0),
      0
    );
    const entities = eligible.slice(0, maxPerDomain).map((entity, index) =>
      Object.freeze({
        id: entity.id,
        name: entity.name,
        subtype: entity.subtype,
        popularity: entity.popularity,
        affinity: entity.affinity,
        weight:
          affinityMass > 0 && entity.affinity !== null
            ? entity.affinity / affinityMass
            : 0,
        rank: index + 1,
        tags: entity.tags,
      })
    );
    for (const entity of eligible) seenGlobal.add(entity.id);

    const truncated = eligible.length > maxPerDomain;
    domainRecords.push(
      Object.freeze({
        domain,
        count: entities.length,
        truncated,
        entities: Object.freeze(entities),
      })
    );

    if (entities.length === 0) uncovered.push(domain);
    totalEntities += entities.length;
    totalDuplicates += duplicates;
    totalDroppedSelf += droppedSelf;
    totalDroppedInvalid += droppedInvalid;
    if (truncated) totalTruncated += 1;
  }

  const plannedPayloadKeys = Object.keys(payloads).filter(
    (key) => !plan.domains.includes(key)
  );

  return deepFreeze({
    seed: plan.seed,
    domains: Object.freeze(domainRecords),
    coverage: Object.freeze({
      planned: plan.domains.length,
      covered: plan.domains.length - uncovered.length,
      uncovered: Object.freeze(uncovered),
    }),
    totals: Object.freeze({
      entities: totalEntities,
      duplicates: totalDuplicates,
      droppedSelf: totalDroppedSelf,
      droppedInvalid: totalDroppedInvalid,
      truncatedDomains: totalTruncated,
      unplannedPayloads: plannedPayloadKeys.length,
    }),
  });
}

/**
 * Flattens an expansion into ONE global ranked list for dossier
 * synthesis: weight desc, then name, then id; each entry carries its
 * domain and 1-based globalRank. NOTE: `weight` is the per-domain
 * affinity SHARE — a single-entity domain therefore has share 1.0 and
 * leads the global list. Deterministic and frozen.
 */
export function flattenExpansion(expansion) {
  if (!expansion || typeof expansion !== 'object' || !Array.isArray(expansion.domains)) {
    throw new ExpansionInputError(
      'flattenExpansion: input must be an expandTastes() record',
      { code: EXPANSION_CODES.INVALID_PLAN, details: { expansion } }
    );
  }
  const entries = [];
  for (const record of expansion.domains) {
    for (const entity of record.entities) {
      entries.push({ domain: record.domain, ...entity });
    }
  }
  entries.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
  return Object.freeze(entries.map((e, i) => Object.freeze({ ...e, globalRank: i + 1 })));
}

const crossDomainExpander = {
  expansionPlan,
  expandTastes,
  flattenExpansion,
  normalizeExpansionRow,
  ExpansionInputError,
  EXPANSION_CODES,
  EXPANSION_LIMITS,
};

export default crossDomainExpander;

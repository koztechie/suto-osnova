/**
 * Mapping layer between the agent's FIVE MANDATORY product domains
 * (`film`, `music`, `books`, `dining`, `fashion`) and Qloo entity types.
 *
 * The Qloo type system has no notion of "dining" or "fashion": those
 * domains are expressed through other entity types plus tag families
 * (verified LIVE against the hackathon host on 2026-10-14):
 *
 *   film   -> urn:entity:movie + urn:entity:tv_show        (both endpoints)
 *   music  -> urn:entity:artist (+ urn:entity:album for /search ONLY —
 *            album is absent from the insights `filter.type` enum)
 *   books  -> urn:entity:book
 *   dining -> urn:entity:place CARRIED BY restaurant tags
 *            (urn:tag:genre:place:restaurant[:…], urn:tag:category:place:restaurant);
 *            a plain place (a park, a museum) is NOT dining.
 *   fashion-> urn:entity:brand CARRIED BY the fashion tag family
 *            (urn:tag:genre:brand:fashion[:…]); a service brand such as
 *            "Nike Training Club" (urn:tag:genre:brand:mobile_app) is NOT
 *            fashion even though it is a brand.
 *
 * This module is pure (no I/O, no config, no Qloo client): it resolves
 * domain NAMES/ALIASES for outbound queries, provides per-endpoint type
 * lists, and classifies inbound entities back into the five domains using
 * subtype + tag families. It composes with the service clients through
 * raw-URN pass-through (e.g. `searchEntities(q, searchTypesFor('film'))`).
 *
 * Anti-fragile self-checks run AT LOAD TIME: the registry must contain
 * exactly the five mandatory domains, every entry must be well-formed,
 * insight types must be a subset of search types (the insights enum is
 * stricter — verified live), and no alias may resolve to two domains.
 * A broken registry therefore cannot ship: the module refuses to load.
 */

/** The five mandatory agent domains, in canonical order. */
export const MANDATORY_DOMAINS = Object.freeze([
  'film',
  'music',
  'books',
  'dining',
  'fashion',
]);

/**
 * Canonical domain registry.
 * - `searchTypes`:   entity types accepted by `GET /search` `types=`
 *                    (comma-joined; order defines priority).
 * - `insightTypes`:  entity types accepted by `GET /v2/insights`
 *                    `filter.type=` (SINGLE-valued — callers use
 *                    `primaryInsightType`).
 * - `tagFamilies`:   tag URN prefixes that additionally qualify an entity
 *                    of a matching type as part of this domain (used by
 *                    `classifyEntity`).
 * - `aliases`:       friendly names accepted by `resolveDomain`.
 */
export const DOMAIN_REGISTRY = Object.freeze({
  film: Object.freeze({
    id: 'film',
    label: 'Film & TV',
    searchTypes: Object.freeze(['urn:entity:movie', 'urn:entity:tv_show']),
    insightTypes: Object.freeze(['urn:entity:movie', 'urn:entity:tv_show']),
    tagFamilies: Object.freeze([]),
    aliases: Object.freeze([
      'film', 'movie', 'movies', 'cinema', 'tv', 'tv_show', 'television',
      'series', 'show', 'shows',
    ]),
  }),
  music: Object.freeze({
    id: 'music',
    label: 'Music',
    // album: accepted by /search (live-verified 200) …
    searchTypes: Object.freeze(['urn:entity:artist', 'urn:entity:album']),
    // … but NOT by /v2/insights filter.type (absent from the enum).
    insightTypes: Object.freeze(['urn:entity:artist']),
    tagFamilies: Object.freeze([]),
    aliases: Object.freeze([
      'music', 'artist', 'artists', 'band', 'bands', 'song', 'songs',
      'album', 'albums', 'singer',
    ]),
  }),
  books: Object.freeze({
    id: 'books',
    label: 'Books & Literature',
    searchTypes: Object.freeze(['urn:entity:book']),
    insightTypes: Object.freeze(['urn:entity:book']),
    tagFamilies: Object.freeze([]),
    aliases: Object.freeze([
      'books', 'book', 'literature', 'reading', 'novel', 'novels', 'authors',
    ]),
  }),
  dining: Object.freeze({
    id: 'dining',
    label: 'Dining & Restaurants',
    searchTypes: Object.freeze(['urn:entity:place']),
    insightTypes: Object.freeze(['urn:entity:place']),
    // A place is dining ONLY when it carries a restaurant tag family —
    // verified live on real restaurant results (Lucali, Joe's Pizza).
    tagFamilies: Object.freeze([
      'urn:tag:genre:place:restaurant',
      'urn:tag:category:place:restaurant',
    ]),
    aliases: Object.freeze([
      'dining', 'food', 'restaurant', 'restaurants', 'cuisine', 'eat',
      'cafe', 'bars',
    ]),
  }),
  fashion: Object.freeze({
    id: 'fashion',
    label: 'Fashion & Brands',
    searchTypes: Object.freeze(['urn:entity:brand']),
    insightTypes: Object.freeze(['urn:entity:brand']),
    // A brand is fashion ONLY under the fashion genre family — verified
    // live: Nike qualifies, "Nike Training Club" (mobile_app) does not.
    tagFamilies: Object.freeze(['urn:tag:genre:brand:fashion']),
    aliases: Object.freeze([
      'fashion', 'clothing', 'apparel', 'style', 'wardrobe', 'outfits',
    ]),
  }),
});

/** Error for invalid domain inputs and (test-injected) broken registries. */
export class DomainMappingError extends Error {
  constructor(message, { code = 'INVALID_DOMAIN', details } = {}) {
    super(message);
    this.name = 'DomainMappingError';
    this.code = code;
    this.details = details;
  }
}

const ENTITY_TYPE_URN = /^urn:entity:[a-z0-9_]+$/;
const TAG_URN = /^urn:tag:[a-z0-9_]+(:[a-z0-9_]+)*$/;

/**
 * Load-time registry invariants. Exported so tests can prove that a
 * broken registry is REJECTED rather than silently shipped:
 *   - exactly the mandatory domains, no more, no less;
 *   - entry.id matches its key;
 *   - type lists are non-empty arrays of well-formed entity URNs;
 *   - insight types ⊆ search types (the insights enum is stricter);
 *   - tag families are well-formed tag URNs;
 *   - aliases exist, are unique across domains and resolve to their owner.
 *
 * @throws {DomainMappingError} code `INVALID_REGISTRY`.
 */
export function validateRegistry(registry, mandatory = MANDATORY_DOMAINS) {
  const fail = (message, details) => {
    throw new DomainMappingError(message, { code: 'INVALID_REGISTRY', details });
  };

  if (!registry || typeof registry !== 'object') {
    return fail('registry must be an object');
  }
  const ids = Object.keys(registry);

  const missing = mandatory.filter((d) => !ids.includes(d));
  if (missing.length > 0) {
    return fail(`registry is missing mandatory domains: ${missing.join(', ')}`, {
      missing,
    });
  }
  const extra = ids.filter((d) => !mandatory.includes(d));
  if (extra.length > 0) {
    return fail(
      `registry contains non-mandatory domains: ${extra.join(', ')} ` +
        `(the contract fixes exactly: ${mandatory.join(', ')})`,
      { extra }
    );
  }

  const aliasOwner = new Map();
  for (const id of ids) {
    const entry = registry[id];
    if (!entry || typeof entry !== 'object') return fail(`entry ${id} must be an object`);
    if (entry.id !== id) {
      return fail(`entry ${id} has mismatched id "${entry.id}"`, { id, entryId: entry.id });
    }

    for (const field of ['searchTypes', 'insightTypes']) {
      const list = entry[field];
      if (!Array.isArray(list) || list.length === 0) {
        return fail(`entry ${id}: ${field} must be a non-empty array`, { id, field });
      }
      for (const type of list) {
        if (typeof type !== 'string' || !ENTITY_TYPE_URN.test(type)) {
          return fail(`entry ${id}: ${field} contains a malformed URN "${type}"`, {
            id,
            field,
            type,
          });
        }
      }
    }
    for (const type of entry.insightTypes) {
      if (!entry.searchTypes.includes(type)) {
        return fail(
          `entry ${id}: insight type "${type}" is not in searchTypes — ` +
            'the insights filter.type enum is stricter than search; do not ' +
            'advertise types insights cannot serve',
          { id, type }
        );
      }
    }

    const families = entry.tagFamilies ?? [];
    if (!Array.isArray(families)) {
      return fail(`entry ${id}: tagFamilies must be an array`, { id });
    }
    for (const family of families) {
      if (typeof family !== 'string' || !TAG_URN.test(family)) {
        return fail(`entry ${id}: malformed tag family "${family}"`, { id, family });
      }
    }

    const aliases = entry.aliases;
    if (!Array.isArray(aliases) || aliases.length === 0) {
      return fail(`entry ${id}: aliases must be a non-empty array`, { id });
    }
    for (const alias of aliases) {
      if (typeof alias !== 'string' || alias.trim().length === 0) {
        return fail(`entry ${id}: alias must be a non-empty string`, { id, alias });
      }
      const key = normalizeAliasKey(alias);
      const owner = aliasOwner.get(key);
      if (owner !== undefined && owner !== id) {
        return fail(
          `alias "${alias}" is claimed by both "${owner}" and "${id}" — ` +
            'an ambiguous alias would silently route queries to the wrong domain',
          { alias, owner, id }
        );
      }
      aliasOwner.set(key, id);
    }
  }
  return { domains: ids.length, aliases: aliasOwner.size };
}

/** Canonical alias key: trimmed, lowercased, spaces/hyphens -> underscore. */
function normalizeAliasKey(value) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// Refuse to export a broken registry: this throws at module load.
validateRegistry(DOMAIN_REGISTRY);

const ALIAS_INDEX = (() => {
  const index = new Map();
  for (const domain of MANDATORY_DOMAINS) {
    for (const alias of DOMAIN_REGISTRY[domain].aliases) {
      index.set(normalizeAliasKey(alias), domain);
    }
  }
  return index;
})();

/**
 * Resolves a domain name (canonical id or any alias, case/whitespace
 * tolerant) to the canonical domain id.
 *
 * @param {string} input e.g. "Film", "tv show", "restaurants", "books"
 * @returns {'film'|'music'|'books'|'dining'|'fashion'}
 * @throws {DomainMappingError} code `INVALID_DOMAIN` — unknown or empty
 *         input fails fast with the full alias vocabulary in the message,
 *         so an agent never burns a Qloo round-trip on a typo'd domain.
 */
export function resolveDomain(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new DomainMappingError(
      `domain must be a non-empty string; mandatory domains: ` +
        MANDATORY_DOMAINS.join(', '),
      { code: 'INVALID_DOMAIN', details: { domain: input } }
    );
  }
  const domain = ALIAS_INDEX.get(normalizeAliasKey(input));
  if (domain === undefined) {
    throw new DomainMappingError(
      `Unknown domain "${input}". Mandatory domains and their aliases: ` +
        MANDATORY_DOMAINS.map((d) => `${d} (${DOMAIN_REGISTRY[d].aliases.slice(0, 4).join('/')})`).join('; '),
      { code: 'INVALID_DOMAIN', details: { domain: input } }
    );
  }
  return domain;
}

/**
 * Resolves a list of domain names, deduplicated, order preserved.
 * @throws {DomainMappingError} code `INVALID_DOMAIN`.
 */
export function resolveDomains(inputs) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  const resolved = list.map(resolveDomain);
  return [...new Set(resolved)];
}

/**
 * Entity types to feed into `GET /search` `types=` for a domain.
 * @returns {string[]} non-empty array of `urn:entity:*` URNs.
 * @throws {DomainMappingError} code `INVALID_DOMAIN`.
 */
export function searchTypesFor(domain) {
  const id = resolveDomain(domain);
  return [...DOMAIN_REGISTRY[id].searchTypes];
}

/**
 * Primary entity type for `GET /v2/insights` `filter.type=` — that
 * parameter is SINGLE-valued, so a multi-type domain (film, music) needs
 * a priority pick. Callers wanting broader coverage issue one insights
 * call per type.
 * @throws {DomainMappingError} code `INVALID_DOMAIN`.
 */
export function primaryInsightType(domain) {
  const id = resolveDomain(domain);
  return DOMAIN_REGISTRY[id].insightTypes[0];
}

/** All insights-capable types for a domain (one call each). */
export function insightTypesFor(domain) {
  const id = resolveDomain(domain);
  return [...DOMAIN_REGISTRY[id].insightTypes];
}

/**
 * Normalize ANY affinity domain to the form `getCrossDomainAffinities`
 * accepts (task 193). `fetchAffinityVector`'s fetchFn contract hands the
 * RAW agent vocabulary (`books`, `dining`, `fashion`, `film`…), but the
 * client's alias table only knows `TARGET_DOMAINS` keys or raw
 * `urn:entity:*` URNs — so the injected production affinityFn must map
 * BEFORE the call, or those domains are rejected locally
 * (INVALID_TARGET_DOMAIN) and, on a book/videogame seed, ALL five domains
 * fail -> 500 `all_domains_failed`. Rules: raw URNs pass through
 * untouched (primaryInsightType throws on them), agent vocabulary maps to
 * the insights URN, and unknown vocabulary falls through unchanged so the
 * client's own INVALID_TARGET_DOMAIN guidance still applies.
 *
 * @param {string} domain raw agent domain, canonical key or raw URN
 * @returns {string} a value resolveTargetDomain accepts
 */
export function toInsightsDomain(domain) {
  if (typeof domain === 'string' && domain.trim().toLowerCase().startsWith('urn:')) {
    return domain;
  }
  try {
    return primaryInsightType(domain);
  } catch {
    return domain;
  }
}

/** Collects well-formed tag URNs from raw or normalized entity shapes. */
function collectTagIds(entity) {
  if (!Array.isArray(entity.tags)) return [];
  const ids = [];
  for (const tag of entity.tags) {
    if (typeof tag === 'string') {
      if (TAG_URN.test(tag)) ids.push(tag);
      continue;
    }
    if (tag && typeof tag === 'object') {
      const id = typeof tag.id === 'string' ? tag.id
        : typeof tag.tag_id === 'string' ? tag.tag_id
        : null;
      if (id && TAG_URN.test(id)) ids.push(id);
    }
  }
  return ids;
}

/** True when any tag equals the family or extends it (":value" suffix). */
function hasTagFamily(tagIds, family) {
  return tagIds.some((id) => id === family || id.startsWith(`${family}:`));
}

/** Subtype candidates from any of the observed entity shapes. */
function collectSubtypes(entity) {
  const subtypes = [];
  if (typeof entity.subtype === 'string') subtypes.push(entity.subtype);
  if (Array.isArray(entity.types)) {
    for (const t of entity.types) if (typeof t === 'string') subtypes.push(t);
  }
  if (typeof entity.type === 'string') subtypes.push(entity.type);
  return subtypes;
}

/** Type -> domain for the unambiguous (tag-free) mappings. */
const TYPE_TO_DOMAIN = Object.freeze({
  'urn:entity:movie': 'film',
  'urn:entity:tv_show': 'film',
  'urn:entity:artist': 'music',
  'urn:entity:album': 'music',
  'urn:entity:book': 'books',
});

/**
 * Classifies an inbound Qloo entity into one of the five mandatory
 * domains. Accepts raw Qloo shapes (`types: [...]` + `tags: [{id}]`) and
 * the normalized shapes produced by the service clients (`subtype` +
 * `tags: [{id, name, type}]`).
 *
 * dining/fashion require BOTH the matching entity type AND a qualifying
 * tag family — a park is not dining, a service brand is not fashion.
 *
 * @returns {'film'|'music'|'books'|'dining'|'fashion'|null} null when the
 *          entity does not belong to any mandatory domain (or input is
 *          unusable) — callers treat null as "unmapped", never as an error.
 */
export function classifyEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;

  const subtypes = collectSubtypes(entity);

  for (const subtype of subtypes) {
    const domain = TYPE_TO_DOMAIN[subtype];
    if (domain) return domain;
  }

  const tagIds = collectTagIds(entity);
  if (subtypes.includes('urn:entity:place')) {
    for (const family of DOMAIN_REGISTRY.dining.tagFamilies) {
      if (hasTagFamily(tagIds, family)) return 'dining';
    }
  }
  if (subtypes.includes('urn:entity:brand')) {
    for (const family of DOMAIN_REGISTRY.fashion.tagFamilies) {
      if (hasTagFamily(tagIds, family)) return 'fashion';
    }
  }
  return null;
}

/**
 * Groups a list of entities by domain, preserving input order within each
 * bucket. Entities that map to none of the five domains land in
 * `unmapped` (never dropped — an agent must be able to see what it could
 * not classify).
 *
 * @returns {{film: object[], music: object[], books: object[],
 *            dining: object[], fashion: object[], unmapped: object[]}}
 */
export function groupByDomain(entities) {
  const groups = {
    film: [],
    music: [],
    books: [],
    dining: [],
    fashion: [],
    unmapped: [],
  };
  if (!Array.isArray(entities)) return groups;
  for (const entity of entities) {
    const domain = classifyEntity(entity);
    if (domain === null) groups.unmapped.push(entity);
    else groups[domain].push(entity);
  }
  return groups;
}

const domainMapper = {
  MANDATORY_DOMAINS,
  DOMAIN_REGISTRY,
  DomainMappingError,
  validateRegistry,
  resolveDomain,
  resolveDomains,
  searchTypesFor,
  primaryInsightType,
  insightTypesFor,
  toInsightsDomain,
  classifyEntity,
  groupByDomain,
};

export default domainMapper;

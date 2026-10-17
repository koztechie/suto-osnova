/**
 * Categories metadata (task 114) — GET /api/categories.
 *
 * Returns the SUPPORTED CATEGORIES (the five mandatory agent domains)
 * with their full registry metadata, so an API consumer can discover
 * what cultural domains the agent understands and how to address them
 * (aliases) before calling a generate route.
 *
 * The response is a pure, static projection of the domainMapper's
 * DOMAIN_REGISTRY — no Qloo network, no key, no per-request data. It
 * is genuinely static, so the response carries a cache header.
 *
 * Each category exposes:
 *   - id           the canonical domain id (the `domain` in requests);
 *   - label        the human-readable name;
 *   - aliases      friendly names `resolveDomain` accepts;
 *   - searchTypes  the Qloo entity types for GET /search `types=`;
 *   - insightTypes the entity types for GET /v2/insights `filter.type=`;
 *   - tagFamilies  the tag URN families that qualify an entity of a
 *                  matching type as part of the domain.
 */

import { MANDATORY_DOMAINS, DOMAIN_REGISTRY } from './services/domainMapper.js';

/** The supported categories (a frozen, static projection). */
export function categoriesReport() {
  return Object.freeze(MANDATORY_DOMAINS.map((id) => {
    const entry = DOMAIN_REGISTRY[id];
    return Object.freeze({
      id: entry.id,
      label: entry.label,
      aliases: Object.freeze([...entry.aliases]),
      searchTypes: Object.freeze([...entry.searchTypes]),
      insightTypes: Object.freeze([...entry.insightTypes]),
      tagFamilies: Object.freeze([...entry.tagFamilies]),
    });
  }));
}

/** HTTP handler for GET /api/categories (200, static metadata). */
export async function handleCategories(req, res, requestId) {
  const categories = categoriesReport();
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
    'Cache-Control': 'public, max-age=300',
  });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'suto-osnova',
    count: categories.length,
    categories,
  }));
}

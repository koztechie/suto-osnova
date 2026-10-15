/**
 * MCP resources for the Qloo entity graph: URI-addressable, read-only
 * views a client can browse as standardized context (list -> read ->
 * follow links), complementing the imperative tools (task 28).
 *
 * Resource surface:
 *   qloo://domains                  the 5 mandatory agent domains (local)
 *   qloo://domains/{domain}         one domain; aliases resolve (local)
 *   qloo://entity/{id}              entity GRAPH NODE via the live
 *                                   `GET /entities?entity_ids=` endpoint
 *                                   (verified 2026-10-15: param must be
 *                                   entity_ids; id/ids answer 400) with
 *                                   normalized fields, domain
 *                                   classification and links to its tags
 *   qloo://tags/{tagUrn}            tag node via `GET /v2/tags
 *                                   ?filter.tags=` with parents/history
 *                                   and links to parent-type domains
 *   qloo://audiences/{audienceUrn}  audience node via `GET /v2/audiences
 *                                   ?filter.results.audiences=` (verified
 *                                   2026-10-15)
 *
 * Every payload is application/json in the project's NORMALIZED field
 * vocabulary (the same shapes the tools return) plus a `links` array of
 * related resource URIs — the graph traversal surface. All reads inherit
 * the transport stack (auth, rate limiting, retries, cache, single
 * flight, privacy guard, MOCK_MODE fixtures) via qlooClient.
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { qlooClient } from '../services/qlooClient.js';
import {
  MANDATORY_DOMAINS,
  DOMAIN_REGISTRY,
  resolveDomain,
  classifyEntity,
} from '../services/domainMapper.js';
import { normalizeAudience } from '../services/audienceInsightsClient.js';
import { buildContractPayload } from './contract.js';

const MIME = 'application/json';

const finiteNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nonEmptyString = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const asObject = (v) => (v && typeof v === 'object' ? v : {});

/** Reverse map: entity-type URN -> one of the 5 agent domains. */
const TYPE_TO_DOMAIN = (() => {
  const map = new Map();
  for (const domain of MANDATORY_DOMAINS) {
    for (const type of DOMAIN_REGISTRY[domain].searchTypes) {
      if (!map.has(type)) map.set(type, domain);
    }
  }
  return map;
})();

/** Standardized entity node (normalized fields + graph links). */
export function entityNode(raw, { id }) {
  if (!raw || typeof raw !== 'object') return null;
  const entityId = nonEmptyString(raw.entity_id) ?? nonEmptyString(raw.id) ?? id;
  const name = nonEmptyString(raw.name);
  if (!entityId || !name) return null;

  const props = asObject(raw.properties);
  const types = Array.isArray(raw.types)
    ? raw.types.filter((t) => typeof t === 'string')
    : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => {
          const obj = asObject(t);
          const tagId =
            nonEmptyString(obj.id) ?? nonEmptyString(obj.tag_id) ?? nonEmptyString(obj.value);
          const tagName = nonEmptyString(obj.name);
          if (!tagId || !tagName) return null;
          return { id: tagId, name: tagName, type: nonEmptyString(obj.type) };
        })
        .filter(Boolean)
    : [];

  const domain = classifyEntity({ types, subtype: types[0], tags });
  const links = [`qloo://entity/${entityId}`];
  if (domain) links.push(`qloo://domains/${domain}`);
  for (const tag of tags.slice(0, 25)) links.push(`qloo://tags/${tag.id}`);

  return {
    id: entityId,
    name,
    types,
    type: types[0] ?? 'urn:entity',
    domain,
    popularity: finiteNumber(raw.popularity),
    // /entities returns short_description; insights-style bodies use description.
    description: nonEmptyString(props.description) ?? nonEmptyString(props.short_description),
    imageUrl: nonEmptyString(asObject(props.image).url),
    external: props.external ?? null,
    tags,
    links,
  };
}

/** Standardized tag node with parent-type domain links. */
export function tagNode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = nonEmptyString(raw.id) ?? nonEmptyString(raw.tag_id) ?? nonEmptyString(raw.tag_value);
  const name = nonEmptyString(raw.name);
  if (!id || !name) return null;

  const props = asObject(raw.properties);
  const parents = Array.isArray(raw.parents)
    ? raw.parents
        .map((p) => nonEmptyString(asObject(p).type) ?? (typeof p === 'string' ? p : null))
        .filter(Boolean)
    : [];

  const links = [`qloo://tags/${id}`];
  for (const parentType of parents) {
    const domain = TYPE_TO_DOMAIN.get(parentType);
    if (domain) links.push(`qloo://domains/${domain}`);
  }

  return {
    id,
    name,
    type: nonEmptyString(raw.type) ?? nonEmptyString(raw.subtype) ?? null,
    popularity: finiteNumber(raw.popularity),
    description: nonEmptyString(props.description),
    history: nonEmptyString(props.history),
    parents,
    links,
  };
}

/**
 * Registers the entity-graph resources on the given McpServer.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerResources(server) {
  // --- server contract (harness parity: qloo://contracts/*) ------------
  server.registerResource(
    'contract',
    'qloo://contracts/suto-osnova',
    {
      title: 'SUTO OSNOVA server contract',
      description:
        'Contract version, SHA-256 checksum and the full tool/resource ' +
        'surface of this server (the qloo-harness contract convention). ' +
        'Offline: never contacts Qloo.',
      mimeType: MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: MIME,
          text: JSON.stringify(buildContractPayload()),
        },
      ],
    })
  );

  // --- the standardized domain vocabulary (pure local, offline-safe) ----
  server.registerResource(
    'domains',
    'qloo://domains',
    {
      title: 'Agent domain vocabulary',
      description:
        'The five mandatory agent domains (film, music, books, dining, fashion): ' +
        'Qloo entity types per endpoint, restaurant/fashion tag families and aliases.',
      mimeType: MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: MIME,
          text: JSON.stringify({
            mandatory: MANDATORY_DOMAINS,
            domains: DOMAIN_REGISTRY,
          }),
        },
      ],
    })
  );

  server.registerResource(
    'domain',
    new ResourceTemplate('qloo://domains/{domain}', { list: undefined }),
    {
      title: 'Single agent domain',
      description: 'One of the five domains; friendly aliases resolve (film, dining, …).',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const id = resolveDomain(String(variables.domain)); // throws with guidance
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: MIME,
            text: JSON.stringify({
              ...DOMAIN_REGISTRY[id],
              links: [`qloo://domains`, `qloo://entity?type=${id}`],
            }),
          },
        ],
      };
    }
  );

  // --- entity graph nodes (live by-id endpoint) -------------------------
  server.registerResource(
    'entity',
    new ResourceTemplate('qloo://entity/{id}', { list: undefined }),
    {
      title: 'Qloo entity node',
      description:
        'One entity by Qloo id: normalized fields, domain classification and ' +
        'links to its taste tags (the graph edges).',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const id = String(variables.id).trim();
      const payload = await qlooClient.get('/entities', { entity_ids: id });
      const first = Array.isArray(payload.results) ? payload.results[0] : null;
      const node = entityNode(first, { id });
      if (!node) {
        throw new Error(`entity not found: ${id}`);
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: MIME, text: JSON.stringify(node) }],
      };
    }
  );

  // --- tag nodes ---------------------------------------------------------
  server.registerResource(
    'tag',
    new ResourceTemplate('qloo://tags/{tag}', { list: undefined }),
    {
      title: 'Qloo tag node',
      description:
        'One taste tag by URN: popularity, description/history, parent entity ' +
        'types and links to the matching agent domains.',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const urn = String(variables.tag);
      const payload = await qlooClient.get('/v2/tags', { 'filter.tags': urn, take: 1 });
      const raw = payload?.results?.tags?.[0];
      const node = tagNode(raw);
      if (!node || node.id.toLowerCase() !== urn.toLowerCase()) {
        throw new Error(`tag not found: ${urn}`);
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: MIME, text: JSON.stringify(node) }],
      };
    }
  );

  // --- audience nodes -----------------------------------------------------
  server.registerResource(
    'audience',
    new ResourceTemplate('qloo://audiences/{audience}', { list: undefined }),
    {
      title: 'Qloo audience node',
      description:
        'One consumer-audience segment by URN (taste profile category usable as ' +
        'a demographic signal).',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const urn = String(variables.audience);
      const payload = await qlooClient.get('/v2/audiences', {
        'filter.results.audiences': urn,
        take: 1,
      });
      const raw = payload?.results?.audiences?.[0];
      const node = raw ? normalizeAudience(raw) : null;
      if (!node || node.id?.toLowerCase() !== urn.toLowerCase()) {
        throw new Error(`audience not found: ${urn}`);
      }
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: MIME,
            text: JSON.stringify({ ...node, links: [`qloo://audiences/${node.id}`] }),
          },
        ],
      };
    }
  );
}

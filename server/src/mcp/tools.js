/**
 * MCP tool surface for SUTO OSNOVA: the project's verified Qloo
 * capabilities (tasks 20-23) plus local domain/privacy utilities
 * (tasks 24-25) exposed as Model Context Protocol tools.
 *
 * Every network tool funnels through the project's service clients, so
 * MCP callers inherit the full transport stack: auth header, rate
 * limiting, retries, caching, single-flight, the unconditional privacy
 * guard (task 25) and MOCK_MODE fixtures (task 26) — an MCP client
 * works identically offline with MOCK_MODE=true.
 *
 * Input schemas are zod raw shapes (the SDK compiles them to JSON
 * Schema for tools/list); the clients additionally re-validate inputs
 * synchronously before any I/O, so bad arguments fail fast with typed
 * error codes instead of burning quota.
 */

import { z } from 'zod';
import { env } from '../config/env.js';
import { searchEntities } from '../services/entitySearchClient.js';
import { findTags } from '../services/tasteTagsClient.js';
import {
  getCrossDomainAffinities,
  resolveEntityIds,
  resolveTargetDomain,
} from '../services/crossDomainClient.js';
import { getAudienceInsights, searchAudiences } from '../services/audienceInsightsClient.js';
import {
  groupByDomain,
  classifyEntity,
  searchTypesFor,
  insightTypesFor,
  MANDATORY_DOMAINS,
} from '../services/domainMapper.js';
import { detectPersonalData, redactionSummary } from '../services/privacyGuard.js';
import { noteTool, buildContractPayload } from './contract.js';

/** Serializes a successful tool result as one text content block. */
const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

/**
 * Maps typed domain errors (EntitySearchError, QlooApiError, …) to the
 * MCP error shape: tool-level failures are RESULTS with isError=true
 * (the call executed; the operation failed), never protocol errors.
 */
const fail = (err) => {
  const payload = {
    error: err?.message ?? String(err),
    code: err?.code ?? null,
  };
  if (err?.status !== undefined) payload.status = err.status;
  if (err?.attempts !== undefined) payload.attempts = err.attempts;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
};

const round4 = (n) => Math.round(n * 10_000) / 10_000;

/**
 * Resolves a sphere argument to the Qloo type sent upstream. The AGENT
 * vocabulary wins first (books/dining/fashion map to their primary
 * insights type — the insights enum is single-valued), then the Qloo
 * vocabulary / raw URN pass-through (podcast, urn:entity:*).
 * @throws {CrossDomainAffinityError} code INVALID_TARGET_DOMAIN.
 */
function resolveSphere(entry) {
  try {
    return insightTypesFor(entry)[0];
  } catch {
    return resolveTargetDomain(entry);
  }
}

/**
 * Aggregates one domain's cross-domain result into a sphere coefficient:
 * - coefficient: mean of the returned affinities (null when the payload
 *   carries none — e.g. honest mock skeletons);
 * - top: the strongest individual links;
 * - sourceContribution: mean per-signal attribution across results that
 *   carry explainability ("how much each input drives this sphere").
 */
function buildSphereCoefficient(domain, res) {
  const affinities = res.results.map((e) => e.affinity).filter(Number.isFinite);
  const coefficient =
    affinities.length > 0
      ? round4(affinities.reduce((a, b) => a + b, 0) / affinities.length)
      : null;

  const sums = {};
  const counts = {};
  for (const entity of res.results) {
    if (!entity.explain) continue;
    for (const [id, score] of Object.entries(entity.explain)) {
      sums[id] = (sums[id] ?? 0) + score;
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  const sourceContribution =
    Object.keys(counts).length > 0
      ? Object.fromEntries(
          Object.keys(counts).map((id) => [id, round4(sums[id] / counts[id])])
        )
      : null;

  return {
    domain,
    coefficient,
    sourceContribution,
    top: res.results.slice(0, 3).map((e) => ({
      id: e.id,
      name: e.name,
      subtype: e.subtype ?? null,
      affinity: e.affinity ?? null,
    })),
    count: res.count,
  };
}

/**
 * Carves the inverse vector out of one sphere's affinity window:
 * results with FINITE affinity only (no signal data -> neither vector),
 * re-sorted by affinity desc (upstream order assumed sorted; re-sorting
 * is idempotent for live payloads and fixes unordered mock fixtures),
 * then the window splits into top slice / middle / inverse slice of
 * floor(window/3) (min 1). contrast = topMean - inverseMean; null when
 * a slice lacks affinity data or the window is too small.
 */
function buildAntithesis(domain, results, windowSize) {
  // Only finite affinities carry taste signal: entities without one
  // (mock skeletons, malformed payloads) belong to NEITHER vector.
  const sorted = results
    .filter((e) => Number.isFinite(e.affinity))
    .sort((a, b) => b.affinity - a.affinity);
  const cut = Math.max(1, Math.floor(windowSize / 3));
  const top = sorted.slice(0, cut);
  const inverse = sorted.length > cut ? sorted.slice(-cut) : [];

  const mean = (slice) => {
    const values = slice.map((e) => e.affinity).filter(Number.isFinite);
    return values.length > 0
      ? round4(values.reduce((a, b) => a + b, 0) / values.length)
      : null;
  };
  const topMean = mean(top);
  const inverseMean = mean(inverse);

  const project = (slice) =>
    slice.map((e) => ({
      id: e.id,
      name: e.name,
      subtype: e.subtype ?? null,
      affinity: e.affinity ?? null,
    }));

  return {
    domain,
    top: project(top),
    inverse: project(inverse),
    topMean,
    inverseMean,
    contrast:
      topMean !== null && inverseMean !== null ? round4(topMean - inverseMean) : null,
  };
}

/**
 * Canonical alias map: the official qloo-harness adapter advertises ALL
 * of its tools under the `qloo_*` namespace (live-verified 2026-10-15:
 * qloo_capabilities, qloo_recommend, qloo_find_tags, …). Mirroring that
 * convention lets one client filter a single `qloo_*` namespace across
 * both servers, keeping the original short names as stable aliases (the
 * harness's own Python adapter keeps unprefixed aliases alongside its
 * canonical names — same pattern).
 */
const CANONICAL_ALIASES = {
  search_entities: 'qloo_search_entities',
  search_audiences: 'qloo_search_audiences',
  find_tags: 'qloo_find_tags',
  get_cross_domain_affinities: 'qloo_get_cross_domain_affinities',
  get_audience_insights: 'qloo_get_audience_insights',
  group_entities_by_domain: 'qloo_group_entities_by_domain',
  detect_personal_data: 'qloo_detect_personal_data',
};

/**
 * Registers every SUTO OSNOVA tool on the given McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerTools(server) {
  // Captures definitions so canonical aliases can reuse the exact same
  // schema and handler without reaching into SDK internals.
  const registry = [];
  const registerOn = server.registerTool.bind(server);
  const reg = (name, config, handler) => {
    registry.push({ name, config, handler });
    noteTool(name);
    registerOn(name, config, handler);
  };
  reg(
    'search_entities',
    {
      title: 'Search Qloo entities',
      description:
        'Resolve a free-text cultural name (film, artist, book, restaurant, brand) ' +
        'into Qloo entities. domain accepts the agent vocabulary ' +
        '(film, music, books, dining, fashion + aliases) or raw urn:entity:* URNs.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Free-text entity name'),
        domain: z
          .string()
          .min(1)
          .describe('film|music|books|dining|fashion (aliases ok) or urn:entity:*'),
        take: z.number().int().min(1).max(50).optional().describe('Page size (default 10)'),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ query, domain, take, offset }) => {
      try {
        return ok(await searchEntities(query, domain, { take, offset }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'qloo_resolve_entity',
    {
      title: 'Resolve a name to a verified Qloo entity ID',
      description:
        'Converts a textual cultural name into a VERIFIED Qloo entity id ' +
        '(Qloo-issued, never synthesized). Picks the best candidate ' +
        '(exact name match preferred, then popularity; deterministic ' +
        'tie-break), reports ambiguity explicitly with alternatives, and ' +
        'stamps provenance (live|mock). Use allow_fuzzy=false for strict ' +
        'exact-match resolution.',
      inputSchema: {
        name: z.string().min(1).max(200).describe('Textual entity name as written by a human'),
        domain: z
          .string()
          .min(1)
          .optional()
          .describe('Optional scope: film|music|books|dining|fashion (aliases ok) or urn:entity:*; omitted = search all agent domains'),
        min_popularity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Drop candidates below this popularity percentile before selection'),
        allow_fuzzy: z
          .boolean()
          .optional()
          .describe('Accept non-exact name matches (default true; false = exact only)'),
      },
    },
    async ({ name, domain, min_popularity, allow_fuzzy }) => {
      try {
        const types = (
          domain !== undefined
            ? searchTypesFor(domain)
            : MANDATORY_DOMAINS.flatMap((d) => searchTypesFor(d))
        ).filter((t, i, all) => all.indexOf(t) === i);

        const search = await searchEntities(name, types);

        // Verification pass: normalize names, apply the popularity gate,
        // prefer exact matches; deterministic order (popularity desc,
        // then name, then id) so repeated resolutions never flip.
        const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
        const eligible = search.results.filter(
          (e) => min_popularity === undefined || (e.popularity ?? 0) >= min_popularity
        );
        const exact = eligible.filter((e) => norm(e.name) === norm(name));
        const pool = exact.length > 0 ? exact : allow_fuzzy === false ? [] : eligible;

        if (pool.length === 0) {
          const reason =
            eligible.length === 0 && min_popularity !== undefined
              ? `no candidate meets min_popularity=${min_popularity}`
              : allow_fuzzy === false
                ? 'no exact name match (allow_fuzzy=false)'
                : 'no candidates';
          return fail(
            Object.assign(new Error(`cannot verify an entity for "${name}": ${reason}`), {
              code: 'ENTITY_NOT_FOUND',
            })
          );
        }

        const ordered = [...pool].sort(
          (a, b) =>
            (b.popularity ?? 0) - (a.popularity ?? 0) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id)
        );
        const best = ordered[0];

        // Alternatives come from the FULL eligible set (not just exact
        // matches): when an exact hit exists, the runner-up fuzzy
        // candidates are exactly what a caller needs to disambiguate.
        const alternatives = eligible
          .filter((e) => e !== best)
          .sort(
            (a, b) =>
              (b.popularity ?? 0) - (a.popularity ?? 0) ||
              a.name.localeCompare(b.name) ||
              a.id.localeCompare(b.id)
          )
          .slice(0, 6)
          .map((e) => ({
            id: e.id,
            name: e.name,
            subtype: e.subtype ?? null,
          }));

        return ok({
          query: name,
          match: exact.length > 0 ? 'exact' : 'fuzzy',
          ambiguous: ordered.length > 1,
          verified: true,
          // Provenance stamp: which answer surface produced this ID.
          mode: env.MOCK_MODE ? 'mock' : 'live',
          entity: {
            id: best.id,
            name: best.name,
            subtype: best.subtype ?? null,
            domain: classifyEntity(best),
            popularity: best.popularity ?? null,
          },
          alternatives,
          candidatesScanned: search.results.length,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'qloo_cross_correlate',
    {
      title: 'Cross-sphere affinity coefficients',
      description:
        'Computes how strongly the given entities (any domains) correlate ' +
        'with each target sphere. For every domain: the coefficient (mean ' +
        'top-affinity), the strongest links and per-source attribution ' +
        '(how much each input entity drives the sphere). Default sweep: ' +
        'all five agent domains; ranked descending with nulls last. ' +
        'Per-domain failures degrade to error entries instead of failing ' +
        'the whole sweep.',
      inputSchema: {
        entity_ids: z
          .union([z.string(), z.array(z.string()).min(1).max(100)])
          .describe('Source signal entity id(s): comma string or array'),
        domains: z
          .array(z.string().min(1))
          .max(8)
          .optional()
          .describe('Target spheres (agent vocabulary or urn:entity:*); default: all five'),
        take: z.number().int().min(1).max(50).optional().describe('Results per domain (default 10)'),
        explainability: z.boolean().optional().describe('Per-source attribution (default true)'),
      },
    },
    async ({ entity_ids, domains, take, explainability }) => {
      try {
        // Synchronous validation BEFORE any I/O (no quota on bad input).
        const ids = resolveEntityIds(entity_ids);
        const targets = [];
        for (const entry of domains ?? MANDATORY_DOMAINS) {
          const target = resolveSphere(entry); // agent vocab first, then URNs
          if (!targets.includes(target)) targets.push(target);
        }

        const sweep = await Promise.all(
          targets.map(async (domain) => {
            try {
              const res = await getCrossDomainAffinities(ids, domain, {
                take,
                explainability,
              });
              return buildSphereCoefficient(domain, res);
            } catch (err) {
              // Degrade per domain: one failed sphere must not sink the sweep.
              return {
                domain,
                coefficient: null,
                sourceContribution: null,
                top: [],
                count: 0,
                error: { code: err?.code ?? 'ERROR', message: err?.message ?? String(err) },
              };
            }
          })
        );

        if (sweep.every((r) => r.error)) {
          return fail(
            Object.assign(new Error('every target sphere failed'), {
              code: 'ALL_SPHERES_FAILED',
              details: sweep.map((r) => r.error),
            })
          );
        }

        // Deterministic ranking: numeric coefficients desc, nulls last.
        const ranked = [...sweep].sort(
          (a, b) => (b.coefficient ?? -Infinity) - (a.coefficient ?? -Infinity)
        );

        return ok({
          sourceEntityIds: ids,
          spheres: sweep,
          ranked: ranked.map((r) => ({
            domain: r.domain,
            coefficient: r.coefficient,
            error: r.error ?? null,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'qloo_taste_antithesis',
    {
      title: 'Inverse cultural vectors (taste antithesis)',
      description:
        'Computes the INVERSE taste vector per sphere: within the same ' +
        'domain window ranked by affinity, the top slice is the source ' +
        'vector and the bottom slice is its antithesis (the least like ' +
        'these entities). contrast = topMean - inverseMean (rounded, null ' +
        'when a slice has no affinity data). Deterministic; partial sphere ' +
        'failures degrade to error entries.',
      inputSchema: {
        entity_ids: z
          .union([z.string(), z.array(z.string()).min(1).max(100)])
          .describe('Source signal entity id(s): comma string or array'),
        domains: z
          .array(z.string().min(1))
          .max(8)
          .optional()
          .describe('Target spheres (agent vocabulary or urn:entity:*); default: all five'),
        window: z
          .number()
          .int()
          .min(3)
          .max(50)
          .optional()
          .describe('Affinity window per sphere (3..50, default 30): the ranked slice the antithesis is carved from'),
      },
    },
    async ({ entity_ids, domains, window }) => {
      try {
        // Synchronous validation BEFORE any I/O (no quota on bad input).
        const ids = resolveEntityIds(entity_ids);
        const targets = [];
        for (const entry of domains ?? MANDATORY_DOMAINS) {
          const target = resolveSphere(entry); // agent vocab first, then URNs
          if (!targets.includes(target)) targets.push(target);
        }
        const size = window ?? 30;

        const sweep = await Promise.all(
          targets.map(async (domain) => {
            try {
              const res = await getCrossDomainAffinities(ids, domain, { take: size });
              return buildAntithesis(domain, res.results, size);
            } catch (err) {
              return {
                domain,
                contrast: null,
                top: [],
                inverse: [],
                error: { code: err?.code ?? 'ERROR', message: err?.message ?? String(err) },
              };
            }
          })
        );

        if (sweep.every((r) => r.error)) {
          return fail(
            Object.assign(new Error('every target sphere failed'), {
              code: 'ALL_SPHERES_FAILED',
              details: sweep.map((r) => r.error),
            })
          );
        }

        // Deterministic ranking: contrast desc, nulls last.
        const ranked = [...sweep].sort(
          (a, b) => (b.contrast ?? -Infinity) - (a.contrast ?? -Infinity)
        );

        return ok({
          sourceEntityIds: ids,
          window: size,
          spheres: sweep,
          ranked: ranked.map((r) => ({
            domain: r.domain,
            contrast: r.contrast,
            error: r.error ?? null,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'find_tags',
    {
      title: 'Find taste vector tags',
      description:
        'Taste-vector tags Qloo associates with an entity, scoped by tag type ' +
        '(shorthand "genre:media" or full urn:tag:*).',
      inputSchema: {
        entity_id: z.string().min(1).describe('Qloo entity id (UUID)'),
        tag_type: z
          .string()
          .min(1)
          .describe('Tag type: "genre:media" shorthand or urn:tag:* URN'),
        take: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ entity_id, tag_type, take }) => {
      try {
        return ok(await findTags(entity_id, tag_type, { take }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'get_cross_domain_affinities',
    {
      title: 'Cross-domain taste affinities',
      description:
        'Entities of targetDomain ranked by affinity to the combined taste profile ' +
        'of entity_ids, with per-signal attribution (explainability, on by default).',
      inputSchema: {
        entity_ids: z
          .union([z.string(), z.array(z.string()).min(1).max(100)])
          .describe('Source signal entity id(s), comma string or array'),
        target_domain: z.string().min(1).describe('film|music|books|dining|fashion or urn:entity:*'),
        take: z.number().int().min(1).max(50).optional(),
        explainability: z.boolean().optional().describe('Per-result + aggregate attribution (default true)'),
      },
    },
    async ({ entity_ids, target_domain, take, explainability }) => {
      try {
        return ok(
          await getCrossDomainAffinities(entity_ids, target_domain, { take, explainability })
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'get_audience_insights',
    {
      title: 'Consumer audience insights',
      description:
        'Entities of a target domain ranked by affinity to a demographic profile ' +
        '(audience segments, age range, gender), blended optionally with taste ' +
        'signals and a locality. Discover audience URNs via search_audiences.',
      inputSchema: {
        target_domain: z.string().min(1).describe('film|music|books|dining|fashion or urn:entity:*'),
        audiences: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe('urn:audience:* URNs or type:value shorthands'),
        entity_ids: z.union([z.string(), z.array(z.string()).max(100)]).optional(),
        tag_ids: z.union([z.string(), z.array(z.string()).max(100)]).optional(),
        location: z.string().min(1).optional().describe('Locality name, e.g. "Denver"'),
        age: z
          .union([
            z.string(),
            z.array(z.string()),
          ])
          .optional()
          .describe('One of: 24_and_younger, 25_to_29, 30_to_34, 35_to_44, 35_and_younger, 36_to_55, 45_to_54, 55_and_older'),
        gender: z.enum(['male', 'female']).optional(),
        take: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ target_domain, audiences, entity_ids, tag_ids, location, age, gender, take }) => {
      try {
        return ok(
          await getAudienceInsights({
            targetDomain: target_domain,
            audiences,
            entityIds: entity_ids,
            tagIds: tag_ids,
            location,
            age,
            gender,
            take,
          })
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'search_audiences',
    {
      title: 'Discover audience segments',
      description:
        'Search Qloo audience URNs by keyword (the documented workflow: discover ' +
        'here, then feed the id into get_audience_insights).',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Audience keyword, e.g. "outdoors"'),
        take: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, take }) => {
      try {
        return ok(await searchAudiences(query, { take }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'group_entities_by_domain',
    {
      title: 'Classify entities into the 5 agent domains',
      description:
        'Local (no network): groups raw Qloo entities into the mandatory domains ' +
        'film|music|books|dining|fashion. dining/fashion require qualifying tag ' +
        'families; unmapped entities are kept, never dropped.',
      inputSchema: {
        entities: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe('Raw or normalized Qloo entity objects (subtype/types + tags)'),
      },
    },
    async ({ entities }) => {
      try {
        return ok(groupByDomain(entities));
      } catch (err) {
        return fail(err);
      }
    }
  );

  reg(
    'detect_personal_data',
    {
      title: 'Privacy audit (masked)',
      description:
        'Local (no network): detects personal data (emails, IPs, phones, cards, ' +
        'denylisted fields) in text or a JSON payload. Findings are MASKED — the ' +
        'raw PII is never echoed back.',
      inputSchema: {
        text: z.string().optional().describe('Free text to audit'),
        data: z.unknown().optional().describe('Structured payload to audit'),
      },
    },
    async ({ text, data }) => {
      try {
        const findings = detectPersonalData(text !== undefined ? text : data);
        return ok({ findings, summary: redactionSummary(findings) });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // Canonical qloo_* aliases (same schema, same handler — see the map).
  for (const [original, alias] of Object.entries(CANONICAL_ALIASES)) {
    const def = registry.find((d) => d.name === original);
    reg(alias, { ...def.config, title: `${def.config.title} (canonical alias)` }, def.handler);
  }

  // Contract discovery, harness convention: capabilities WITHOUT any
  // Qloo traffic (contract version, checksum, tool/resource surface).
  reg(
    'qloo_capabilities',
    {
      title: 'Server contract and readiness',
      description:
        'Offline contract metadata (harness convention): server version, ' +
        'contract version, SHA-256 checksum, the full tool/resource surface ' +
        'and MOCK_MODE state. Never contacts Qloo.',
      inputSchema: {},
    },
    async () => ok(buildContractPayload())
  );
}

/**
 * Hand-recorded static Qloo response fixtures for MOCK_MODE.
 *
 * Every fixture below mirrors the LIVE hackathon host's response shapes,
 * recorded during the contract-verification probes of 2026-10-14 (field
 * names, tag_id-vs-id divergences, popularity values and all). Serving
 * them keeps the whole agent autonomous with no network and zero key
 * quota consumption.
 *
 * Structure: ordered list of entries —
 *   { name, method, path, match: { query: {...} }, response: {...}|fn }
 * - Matching is exact per declared query param; a value may be an array
 *   meaning "any of" (for multi-valued params like `types`).
 * - Non-fallback entries are tried FIRST in order; entries with
 *   `fallback: true` are used only when nothing specific matched, so
 *   unknown queries still get deterministic, type-correct answers.
 * - `response` may be a function `({ params, url }) -> body` for
 *   take/fallback-aware synthesis.
 *
 * To extend: add a fixture with a recorded body (or copy one from the
 * live API via a probe script). Unknown paths fail loudly with
 * MockFixtureNotFoundError rather than inventing data silently.
 */

/** Deterministic UUID-shaped id from a seed (stable across restarts). */
export function deterministicMockId(seed) {
  let h1 = 0x811c9dc5; // FNV-1a
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= h1 + seed.charCodeAt(i) + (h2 << 6) + (h2 >>> 2);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const hex = (n, len) => (n >>> 0).toString(16).padStart(8, '0').slice(0, len);
  return [
    hex(h1, 8),
    hex(h2, 4),
    `4${hex(h1 ^ h2, 3)}`, // version-4 nibble for a realistic UUID shape
    `${((h2 & 0x3fff) | 0x8000).toString(16).padStart(4, '0')}`, // variant bits
    // 32-bit ints hold at most 8 hex chars — compose 12 from both hashes.
    `${hex(h1, 8)}${hex(h2, 4)}`,
  ]
    .join('-')
    .toUpperCase();
}

const clampTake = (raw, fallback = 10, max = 50) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
};

// --- reusable raw shapes (live-verified field names) ---------------------------

const movie = (name, entity_id, popularity) => ({
  name,
  entity_id,
  type: 'urn:entity',
  subtype: 'urn:entity:movie',
  properties: {},
  popularity,
  tags: [],
});

const genreTag = (value, name, popularity) => ({
  id: `urn:tag:genre:media:${value}`,
  name,
  type: 'urn:tag:genre:media',
  popularity,
  properties: {},
  parents: [{ type: 'urn:entity:movie' }, { type: 'urn:entity:tv_show' }],
  tags: [],
});

// Pool of recommendations for insights fallbacks (real names + values
// from live probes).
const INSIGHTS_POOL = {
  'urn:entity:movie': [
    movie('Promising Young Woman', 'E39A5CE6-5991-46B9-897D-4B23A494804A', 0.9933691872394652),
    movie('The Menu', 'C17E1B67-0D79-404B-B0BC-BBBD37F7107D', 0.9984448908183762),
    movie('Last Night in Soho', '69B5C53B-E382-4839-80F1-23809446563D', 0.9930992030065444),
  ],
  'urn:entity:place': [
    {
      name: 'Vanier Park',
      entity_id: 'F8351CC6-ADDD-4CD7-8A33-B6CA1F86D3CF',
      type: 'urn:entity',
      subtype: 'urn:entity:place',
      properties: { geocode: { name: 'Vancouver', country_code: 'CA' } },
      popularity: 0.87,
      tags: [{ tag_id: 'urn:tag:genre:place:park', name: 'Park', type: 'urn:tag:genre:place' }],
    },
  ],
  'urn:entity:book': [
    {
      name: "Frank Herbert's Dune Saga Collection (Dune #1-6)",
      entity_id: '7C4E9B2A-5D31-4F87-A6C9-0E2B8D4F1A73',
      type: 'urn:entity',
      subtype: 'urn:entity:book',
      properties: { release_year: 1965 },
      popularity: 0.96,
      tags: [],
    },
  ],
  'urn:entity:artist': [
    {
      name: 'Phoebe Bridgers',
      entity_id: 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836',
      type: 'urn:entity',
      subtype: 'urn:entity:artist',
      properties: {},
      popularity: 0.91,
      tags: [{ tag_id: 'urn:tag:genre:music:indie', name: 'Indie', type: 'urn:tag:genre:music' }],
    },
  ],
};

const TAGS_POOL = [
  genreTag('romance', 'Romance', 0.99998945),
  genreTag('drama', 'Drama', 0.99998873),
  genreTag('comedy', 'Comedy', 0.999984),
  genreTag('fantasy', 'Fantasy', 0.9999833),
  genreTag('mystery', 'Mystery', 0.9999782),
  {
    id: 'urn:tag:subgenre:qloo:indie',
    name: 'Indie',
    type: 'urn:tag:subgenre:qloo',
    popularity: 0.96761465,
    properties: {},
    parents: [{ type: 'urn:entity:tv_show' }, { type: 'urn:entity:podcast' }, { type: 'urn:entity:movie' }],
    tags: [],
  },
  {
    id: 'urn:tag:style:qloo:indie',
    name: 'Indie',
    type: 'urn:tag:style:qloo',
    popularity: 0.9016937,
    properties: {},
    parents: [{ type: 'urn:entity:tv_show' }, { type: 'urn:entity:movie' }],
    tags: [],
  },
];

const AUDIENCES_POOL = [
  {
    entity_id: 'AAAE9FAA-FE3D-4732-9E82-BD4CED485D60',
    name: 'Outdoors',
    parents: [{ id: 'urn:audience:hobbies_and_interests', name: 'Hobbies And Interests', type: 'urn:audience' }],
    type: 'urn:audience:hobbies_and_interests',
    id: 'urn:audience:hobbies_and_interests:outdoors',
    disambiguation: 'Outdoors enthusiasts',
  },
  {
    entity_id: 'B7D2E4F1-9C83-4A56-8E21-5F0A7C9D3B64',
    name: 'Sustainability',
    parents: [{ id: 'urn:audience:global_issues', name: 'Global Issues', type: 'urn:audience' }],
    type: 'urn:audience:global_issues',
    id: 'urn:audience:global_issues:sustainability',
    disambiguation: 'Sustainability advocates',
  },
];

/**
 * Builds an insights body, adding explainability ONLY when the request
 * asked for it and signals were supplied (mirrors the live behavior:
 * attribution blocks appear under signal.interests.entities).
 */
function insightsBody(entities, params) {
  const explain = params.get('feature.explainability') === 'true';
  const signals = (params.get('signal.interests.entities') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const results = entities.map((raw) => {
    const e = structuredClone(raw); // deep: caller mutation can never leak into the pool
    const affinity = 0.9 + ((parseInt(deterministicMockId(e.entity_id).slice(0, 4), 16) % 90) / 1000);
    const entity = { ...e, query: { affinity: Number(affinity.toFixed(6)) } };
    if (explain && signals.length > 0) {
      const share = Number((1 / signals.length).toFixed(4));
      entity.query.explainability = {
        'signal.interests.entities': signals.map((id) => ({ entity_id: id, score: share })),
      };
    }
    return entity;
  });

  const body = { success: true, duration: 35, results: { entities: results } };
  if (explain && signals.length > 0) {
    const share = Number((1 / signals.length).toFixed(4));
    body.query = {
      explainability: {
        'signal.interests.entities': {
          effect_on_top3_recs: signals.map((id) => ({ entity_id: id, avg_score: share })),
          effect_on_top5_recs: signals.map((id) => ({ entity_id: id, avg_score: share })),
          effect_on_top10_recs: signals.map((id) => ({ entity_id: id, avg_score: share })),
          effect_on_all_recs: signals.map((id) => ({ entity_id: id, avg_score: share })),
        },
      },
    };
  }
  return body;
}

export const QLOO_FIXTURES = [
  // --- /search: specific recorded queries -------------------------------
  {
    name: 'search:severance-tv',
    method: 'GET',
    path: '/search',
    match: { query: { query: 'Severance', types: 'urn:entity:tv_show' } },
    response: {
      success: true,
      duration: 41,
      results: [
        {
          name: 'Severance',
          entity_id: '569F8294-72D1-4C6E-8A2F-1B3D5E7F9A01',
          types: ['urn:entity:tv_show'],
          properties: { release_year: 2022, description: 'Employees at Lumon Industries agree to a procedure that separates their work memories from their personal lives.' },
          popularity: 0.997,
          tags: [
            { name: 'Work Life Balance', tag_id: 'urn:tag:keyword:media:work_life_balance', type: 'urn:tag:keyword:media' },
            { name: 'Office', tag_id: 'urn:tag:keyword:media:office', type: 'urn:tag:keyword:media' },
          ],
        },
      ],
    },
  },
  {
    name: 'search:phoebe-artist',
    method: 'GET',
    path: '/search',
    match: { query: { types: ['urn:entity:artist', 'urn:entity:artist,urn:entity:album'] } },
    response: {
      success: true,
      duration: 38,
      results: [
        {
          name: 'Phoebe Bridgers',
          entity_id: 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836',
          types: ['urn:entity:artist'],
          properties: {},
          popularity: 0.91,
          tags: [
            { name: 'Indie', tag_id: 'urn:tag:genre:music:indie', type: 'urn:tag:genre:music' },
            { name: 'Lyrical', tag_id: 'urn:tag:music:qloo:lyrical', type: 'urn:tag:music:qloo' },
          ],
        },
        {
          name: 'Kendrick Lamar',
          entity_id: 'C915A918-39C4-4F2B-8D6E-2A7B5C9E1F30',
          types: ['urn:entity:artist'],
          properties: {},
          popularity: 0.98,
          tags: [{ name: 'Socially Conscious', tag_id: 'urn:tag:music:qloo:socially_conscious', type: 'urn:tag:music:qloo' }],
        },
      ],
    },
  },
  {
    name: 'search:dune-book',
    method: 'GET',
    path: '/search',
    match: { query: { query: ['dune', 'dune herbert'], types: 'urn:entity:book' } },
    response: {
      success: true,
      duration: 33,
      results: [
        {
          name: "Frank Herbert's Dune Saga Collection (Dune #1-6)",
          entity_id: '7C4E9B2A-5D31-4F87-A6C9-0E2B8D4F1A73',
          types: ['urn:entity:book'],
          properties: { release_year: 1965 },
          popularity: 0.96,
          tags: [],
        },
      ],
    },
  },
  {
    name: 'search:lucali-restaurant',
    method: 'GET',
    path: '/search',
    match: { query: { types: 'urn:entity:place', query: ['lucali', 'lucali pizza brooklyn'] } },
    response: {
      success: true,
      duration: 47,
      results: [
        {
          name: 'Lucali',
          entity_id: '895FA243-5144-4E7C-9B2D-6F8A0C3E5B17',
          types: ['urn:entity:place'],
          properties: { address: '575 Henry St, Brooklyn, NY 11231' },
          popularity: 0.94,
          disambiguation: 'Carroll Gardens pizzeria',
          tags: [
            { name: 'Pizza restaurant', tag_id: 'urn:tag:category:place:pizza_restaurant', type: 'urn:tag:category:place' },
            { name: 'Restaurant', tag_id: 'urn:tag:genre:place:restaurant', type: 'urn:tag:genre:place' },
            { name: 'Pizza', tag_id: 'urn:tag:genre:place:restaurant:pizza', type: 'urn:tag:genre:place' },
          ],
        },
      ],
    },
  },
  {
    name: 'search:nike-brand',
    method: 'GET',
    path: '/search',
    match: { query: { types: 'urn:entity:brand' } },
    response: {
      success: true,
      duration: 36,
      results: [
        {
          name: 'Nike',
          entity_id: 'C70CE2B8-0AD3-4E5F-8C7B-1D9A2F4E6B80',
          types: ['urn:entity:brand'],
          properties: {},
          popularity: 0.99,
          tags: [
            { name: 'Fashion', tag_id: 'urn:tag:genre:brand:fashion', type: 'urn:tag:genre:brand' },
            { name: 'Sportswear Brands', tag_id: 'urn:tag:wikipedia_category:sportswear_brands', type: 'urn:tag:wikipedia_category' },
          ],
        },
      ],
    },
  },

  // --- /search: type-aware fallback (unknown queries) -------------------
  {
    name: 'fallback:search',
    method: 'GET',
    path: '/search',
    fallback: true,
    response: ({ params }) => {
      const query = params.get('query') ?? '';
      const types = (params.get('types') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      const take = clampTake(params.get('take'), 10);
      // Unknown queries get a deterministic skeleton entity per requested
      // type: the NAME is the caller's own query (honest — no invented
      // facts), the id is a stable hash so repeated offline calls match.
      const resolved = types.length > 0 ? types : ['urn:entity:movie'];
      const results = resolved.slice(0, take).map((t) => ({
        name: query || 'Mock Entity',
        entity_id: deterministicMockId(`search|${query}|${t}`),
        types: [t],
        properties: {},
        popularity: 0.5,
        tags: [],
      }));
      return { success: true, duration: 3, results };
    },
  },

  // --- /entities (by-id graph node endpoint; entity_ids param, live-verified) ---
  {
    name: 'entities:phoebe',
    method: 'GET',
    path: '/entities',
    match: { query: { entity_ids: 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836' } },
    response: {
      results: [
        {
          name: 'Phoebe Bridgers',
          entity_id: 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836',
          types: ['urn:entity:artist'],
          properties: {
            external: { spotify: { id: '1r1uxoy19fzMxunt3ONAkG' } },
            image: { url: 'https://images.qloo.com/i/AFBC71A7-420x-auto.jpg' },
            short_description:
              'Phoebe Bridgers is an American singer-songwriter known for her emotive indie rock and folk music.',
          },
          popularity: 0.91,
          tags: [
            { name: 'Indie', tag_id: 'urn:tag:genre:music:indie', type: 'urn:tag:genre:music' },
            { name: 'Lyrical', tag_id: 'urn:tag:music:qloo:lyrical', type: 'urn:tag:music:qloo' },
          ],
        },
      ],
    },
  },
  {
    name: 'fallback:entities',
    method: 'GET',
    path: '/entities',
    fallback: true,
    response: ({ params }) => {
      // Honest skeletons offline: echo the requested ids, invent no facts.
      const ids = (params.get('entity_ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        results: ids.map((id) => ({
          name: 'Mock Entity',
          entity_id: id,
          types: [],
          properties: {},
          popularity: 0.5,
          tags: [],
        })),
      };
    },
  },

  // --- /v2/tags ---------------------------------------------------------
  {
    name: 'tags:genres-media',
    method: 'GET',
    path: '/v2/tags',
    match: { query: { 'filter.tag.types': 'urn:tag:genre:media' } },
    response: {
      success: true,
      duration: 35,
      results: { tags: TAGS_POOL.slice(0, 5) },
    },
  },
  {
    name: 'tags:indie',
    method: 'GET',
    path: '/v2/tags',
    match: { query: { 'filter.query': ['indie', 'love'] } },
    response: {
      success: true,
      duration: 31,
      results: { tags: [TAGS_POOL[5], TAGS_POOL[6]] },
    },
  },
  {
    name: 'fallback:tags',
    method: 'GET',
    path: '/v2/tags',
    fallback: true,
    response: ({ params }) => {
      // Exact-URN lookup (the qloo://tags/{tag} resource path) wins first.
      const byId = params.get('filter.tags');
      if (byId) {
        const wanted = byId.toLowerCase();
        return {
          success: true,
          duration: 8,
          results: {
            tags: structuredClone(TAGS_POOL.filter((t) => t.id.toLowerCase() === wanted)),
          },
        };
      }
      const take = clampTake(params.get('take'), 10);
      return { success: true, duration: 8, results: { tags: structuredClone(TAGS_POOL.slice(0, take)) } };
    },
  },

  // --- /v2/insights -----------------------------------------------------
  {
    name: 'insights:phoebe-to-movies',
    method: 'GET',
    path: '/v2/insights',
    match: {
      query: {
        'filter.type': 'urn:entity:movie',
        'signal.interests.entities': 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836',
      },
    },
    response: ({ params }) => insightsBody(INSIGHTS_POOL['urn:entity:movie'], params),
  },
  {
    name: 'insights:outdoors-to-places',
    method: 'GET',
    path: '/v2/insights',
    match: {
      query: {
        'filter.type': 'urn:entity:place',
        'signal.demographics.audiences': 'urn:audience:hobbies_and_interests:outdoors',
      },
    },
    response: ({ params }) => insightsBody(INSIGHTS_POOL['urn:entity:place'], params),
  },
  {
    name: 'fallback:insights',
    method: 'GET',
    path: '/v2/insights',
    fallback: true,
    response: ({ params }) => {
      const type = params.get('filter.type') ?? 'urn:entity:movie';
      const take = clampTake(params.get('take'), 20);
      const pool = INSIGHTS_POOL[type];
      if (pool) {
        return insightsBody(structuredClone(pool.slice(0, take)), params);
      }
      // Unknown target type: honest skeletons (name mirrors the request).
      const results = Array.from({ length: Math.min(take, 2) }, (_, i) => ({
        name: `Mock ${type.split(':').pop().replace(/_/g, ' ')} ${i + 1}`,
        entity_id: deterministicMockId(`insights|${type}|${i}`),
        type: 'urn:entity',
        subtype: type,
        properties: {},
        popularity: 0.5,
        tags: [],
      }));
      return { success: true, duration: 5, results: { entities: results } };
    },
  },

  // --- /v2/audiences ----------------------------------------------------
  {
    name: 'audiences:outdoors',
    method: 'GET',
    path: '/v2/audiences',
    match: { query: { 'filter.query': 'outdoors' } },
    response: {
      success: true,
      duration: 28,
      results: { audiences: [AUDIENCES_POOL[0]] },
    },
  },
  {
    name: 'fallback:audiences',
    method: 'GET',
    path: '/v2/audiences',
    fallback: true,
    response: ({ params }) => {
      // Exact-URN lookup (the qloo://audiences/{urn} resource path) first.
      const byId = params.get('filter.results.audiences');
      if (byId) {
        const wanted = byId.toLowerCase();
        return {
          success: true,
          duration: 9,
          results: {
            audiences: structuredClone(
              AUDIENCES_POOL.filter((a) => a.id.toLowerCase() === wanted)
            ),
          },
        };
      }
      const take = clampTake(params.get('take'), 20);
      return {
        success: true,
        duration: 9,
        results: { audiences: structuredClone(AUDIENCES_POOL.slice(0, take)) },
      };
    },
  },
];

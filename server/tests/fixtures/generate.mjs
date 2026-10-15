/**
 * Reference fixture generator for the 10 canonical test scenarios.
 *
 * Run: node server/tests/fixtures/generate.mjs
 *
 * Raw `.response.json` files contain REAL response shapes recorded from
 * the live Qloo hackathon host during contract verification (2026-10-14):
 * the `tag_id`-vs-`id` divergence, popularity values, parents arrays,
 * explainability blocks and error body shapes are all faithful. This
 * script pipes each raw response through the REAL service clients and
 * writes the resulting `.expected.json` golden envelopes next to them.
 *
 * Regenerate ONLY when a normalizer changes intentionally, and REVIEW
 * the diff: the golden files pin current behavior, they do not define
 * correctness on their own.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic transport env BEFORE the module graph loads.
process.env.QLOO_API_KEY = 'fixture-key';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';

const { searchEntities } = await import('../../src/services/entitySearchClient.js');
const { findTags } = await import('../../src/services/tasteTagsClient.js');
const { getCrossDomainAffinities } = await import('../../src/services/crossDomainClient.js');
const { getAudienceInsights, searchAudiences } = await import(
  '../../src/services/audienceInsightsClient.js'
);
const { qlooClient, QlooApiError } = await import('../../src/services/qlooClient.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOBBE = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';
const OUTDOORS = 'urn:audience:hobbies_and_interests:outdoors';

const CLIENTS = {
  searchEntities,
  findTags,
  getCrossDomainAffinities,
  getAudienceInsights,
  searchAudiences,
  'qlooClient.get': (endpoint, params) => qlooClient.get(endpoint, params),
};

// --- the 10 scenarios: request args + LIVE-recorded raw responses ---------------

const scenarios = [
  {
    id: '01-film-search',
    title: 'Film domain: search a TV show by name',
    client: 'searchEntities',
    args: ['Severance', 'tv_show'],
    notes: 'search /search; raw tags use the tag_id shape of the live host',
    response: {
      success: true,
      duration: 41,
      results: [
        {
          name: 'Severance',
          entity_id: '569F8294-72D1-4C6E-8A2F-1B3D5E7F9A01',
          types: ['urn:entity:tv_show'],
          properties: {
            release_year: 2022,
            release_date: '2022-02-18',
            description:
              'Employees at Lumon Industries agree to a procedure that separates their work memories from their personal lives.',
            image: { url: 'https://images.qloo.com/i/569F8294-420x-auto.jpg' },
            duration: 50,
            content_rating: 'TV-MA',
          },
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
    id: '02-music-search',
    title: 'Music domain: search an artist',
    client: 'searchEntities',
    args: ['Kendrick Lamar', 'music'],
    notes: 'music resolves to urn:entity:artist; live tag families for artists',
    response: {
      success: true,
      duration: 38,
      results: [
        {
          name: 'Kendrick Lamar',
          entity_id: 'C915A918-39C4-4F2B-8D6E-2A7B5C9E1F30',
          types: ['urn:entity:artist'],
          properties: {},
          popularity: 0.98,
          tags: [
            { name: 'Socially Conscious', tag_id: 'urn:tag:music:qloo:socially_conscious', type: 'urn:tag:music:qloo' },
            { name: 'Lyrical', tag_id: 'urn:tag:music:qloo:lyrical', type: 'urn:tag:music:qloo' },
          ],
        },
      ],
    },
  },
  {
    id: '03-books-search',
    title: 'Books domain: search a book',
    client: 'searchEntities',
    args: ['Dune', 'books'],
    notes: 'books resolves to urn:entity:book',
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
    id: '04-dining-search',
    title: 'Dining domain: search a restaurant (place + restaurant tags)',
    client: 'searchEntities',
    args: ['Lucali', 'dining'],
    notes: 'dining resolves to urn:entity:place; restaurant tag families qualify it',
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
    id: '05-fashion-search',
    title: 'Fashion domain: search a brand (brand + fashion tags)',
    client: 'searchEntities',
    args: ['Nike', 'fashion'],
    notes: 'fashion resolves to urn:entity:brand; genre:brand:fashion family qualifies it',
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
  {
    id: '06-taste-tags',
    title: 'Taste vector tags for an entity, scoped by tag type',
    client: 'findTags',
    args: [PHOBBE, 'genre:media'],
    notes: '/v2/tags live shape: results.tags with parents, popularity, nested tags',
    response: {
      duration: 35,
      success: true,
      results: {
        tags: [
          {
            parents: [{ type: 'urn:entity:tv_show' }, { type: 'urn:entity:movie' }],
            type: 'urn:tag:genre:media',
            id: 'urn:tag:genre:media:indie',
            name: 'Indie',
            popularity: 0.96761465,
            properties: { description: 'Independent production style.' },
            tags: [
              { name: 'Canonical', tag_id: 'urn:tag:collection:canonical', type: 'urn:tag:collection', value: 'urn:tag:collection:canonical' },
            ],
          },
          {
            parents: [{ type: 'urn:entity:movie' }],
            type: 'urn:tag:genre:media',
            id: 'urn:tag:genre:media:drama',
            name: 'Drama',
            popularity: 0.99998873,
            properties: {},
            tags: [],
          },
        ],
      },
    },
  },
  {
    id: '07-cross-domain-movies',
    title: 'Cross-domain affinity: artist signal -> movies, with attribution',
    client: 'getCrossDomainAffinities',
    args: [PHOBBE, 'movie', { take: 3 }],
    notes:
      '/v2/insights live shape: query.affinity per entity, explainability under signal.interests.entities, root-level warning',
    response: {
      success: true,
      duration: 52,
      results: {
        entities: [
          {
            name: 'Promising Young Woman',
            entity_id: 'E39A5CE6-5991-46B9-897D-4B23A494804A',
            type: 'urn:entity',
            subtype: 'urn:entity:movie',
            properties: { release_year: 2020, description: 'A woman goes on a vigilante mission.' },
            popularity: 0.9933691872394652,
            query: {
              affinity: 0.9445416539735196,
              measurements: { audience_growth: 0 },
              explainability: {
                'signal.interests.entities': [{ entity_id: PHOBBE, score: 1 }],
              },
            },
            tags: [{ id: 'urn:tag:genre:media:drama', name: 'Drama', type: 'urn:tag:genre:media' }],
          },
          {
            name: 'The Menu',
            entity_id: 'C17E1B67-0D79-404B-B0BC-BBBD37F7107D',
            type: 'urn:entity',
            subtype: 'urn:entity:movie',
            properties: {},
            popularity: 0.9984448908183762,
            query: { affinity: 0.9234310157956184 },
            tags: [],
          },
        ],
      },
      query: {
        explainability: {
          'signal.interests.entities': {
            effect_on_top3_recs: [{ entity_id: PHOBBE, avg_score: 1 }],
            effect_on_top5_recs: [{ entity_id: PHOBBE, avg_score: 1 }],
            effect_on_top10_recs: [{ entity_id: PHOBBE, avg_score: 1 }],
            effect_on_all_recs: [{ entity_id: PHOBBE, avg_score: 1 }],
          },
          warning: 'partial attribution coverage',
        },
      },
    },
  },
  {
    id: '08-audience-insights',
    title: 'Audience insights: demographic signal -> places',
    client: 'getAudienceInsights',
    args: [{ targetDomain: 'place', audiences: OUTDOORS, take: 2 }],
    notes:
      'demographic-only signal: live host computes no attribution, so explain/aggregate are null',
    response: {
      success: true,
      duration: 61,
      results: {
        entities: [
          {
            name: 'Vanier Park',
            entity_id: 'F8351CC6-ADDD-4CD7-8A33-B6CA1F86D3CF',
            type: 'urn:entity',
            subtype: 'urn:entity:place',
            properties: { geocode: { name: 'Vancouver', country_code: 'CA' } },
            popularity: 0.87,
            query: { affinity: 0.9370823954423944, measurements: { audience_growth: 0 } },
            tags: [{ id: 'urn:tag:genre:place:park', name: 'Park', type: 'urn:tag:genre:place' }],
          },
        ],
      },
    },
  },
  {
    id: '09-audience-discovery',
    title: 'Audience discovery by keyword (URN lookup)',
    client: 'searchAudiences',
    args: ['outdoors'],
    notes: '/v2/audiences live shape: results.audiences with parents and disambiguation',
    response: {
      success: true,
      duration: 28,
      results: {
        audiences: [
          {
            entity_id: 'AAAE9FAA-FE3D-4732-9E82-BD4CED485D60',
            name: 'Outdoors',
            parents: [{ id: 'urn:audience:hobbies_and_interests', name: 'Hobbies And Interests', type: 'urn:audience' }],
            type: 'urn:audience:hobbies_and_interests',
            id: OUTDOORS,
            disambiguation: 'Outdoors enthusiasts',
          },
        ],
      },
    },
  },
  {
    id: '10-error-rate-limit',
    title: 'Upstream 429 quota error surfaces as QlooApiError',
    client: 'qlooClient.get',
    args: ['/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': PHOBBE }],
    status: 429,
    error: true,
    notes: 'live 429 body shape {"error_msg": ...}; QLOO_MAX_RETRIES=0 -> single attempt',
    response: { error_msg: 'Rate limit exceeded for this API key' },
  },
];

// --- generate ----------------------------------------------------------------------

const manifest = [];
for (const scenario of scenarios) {
  const responseFile = `${scenario.id}.response.json`;
  const expectedFile = `${scenario.id}.expected.json`;

  await writeFile(
    path.join(here, responseFile),
    JSON.stringify(scenario.response, null, 2) + '\n'
  );

  // Feed the raw response through the REAL client pipeline.
  const status = scenario.status ?? 200;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: { get: () => 'application/json' },
    json: async () => structuredClone(scenario.response),
    text: async () => JSON.stringify(scenario.response),
  });

  let expected;
  if (scenario.error) {
    try {
      await CLIENTS[scenario.client](...scenario.args);
      throw new Error(`scenario ${scenario.id}: expected a rejection`);
    } catch (err) {
      if (!(err instanceof QlooApiError)) throw err;
      expected = {
        errorName: err.name,
        code: err.code ?? null,
        status: err.status,
        attempts: err.attempts,
        data: err.data,
      };
    }
  } else {
    expected = await CLIENTS[scenario.client](...scenario.args);
  }

  await writeFile(
    path.join(here, expectedFile),
    JSON.stringify(expected, null, 2) + '\n'
  );

  manifest.push({
    id: scenario.id,
    title: scenario.title,
    client: scenario.client,
    args: scenario.args,
    status,
    error: Boolean(scenario.error),
    response: responseFile,
    expected: expectedFile,
    notes: scenario.notes,
  });
  console.log(`generated ${scenario.id} (${scenario.error ? 'error' : 'success'} path)`);
}

await writeFile(
  path.join(here, 'manifest.json'),
  JSON.stringify(
    {
      description:
        'Reference mock data for 10 canonical test scenarios. Raw responses ' +
        'recorded live from hackathon.api.qloo.com (2026-10-14); expected ' +
        'envelopes generated through the real clients — pinned by ' +
        'server/test/referenceFixtures.test.js. Regenerate: node server/tests/fixtures/generate.mjs',
      generatedBy: 'server/tests/fixtures/generate.mjs',
      scenarios: manifest,
    },
    null,
    2
  ) + '\n'
);
console.log(`manifest.json written (${manifest.length} scenarios)`);

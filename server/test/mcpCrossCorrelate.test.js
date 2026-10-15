import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// MOCK_MODE BEFORE the module graph loads: correlation sweep runs offline.
process.env.QLOO_API_KEY = 'mcp-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = await import('../src/mcp/server.js');
const { env } = await import('../src/config/env.js');

const PHOBBE = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';

let client;

beforeEach(async () => {
  client = new Client({ name: 'test', version: '0.0.0' });
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  globalThis.fetch = async () => {
    throw new Error('network disabled: correlation must work offline');
  };
  env.MOCK_MODE = true;
});

const correlate = async (args) => {
  const result = await client.callTool({ name: 'qloo_cross_correlate', arguments: args });
  return result.isError
    ? { isError: true, error: JSON.parse(result.content[0].text) }
    : { isError: false, data: JSON.parse(result.content[0].text) };
};

// --- discovery -----------------------------------------------------------------

test('qloo_cross_correlate is listed with entity_ids required', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'qloo_cross_correlate');
  assert.ok(tool, 'tool registered');
  assert.deepEqual([...tool.inputSchema.required], ['entity_ids']);
  assert.ok(tool.inputSchema.properties.domains, 'domain sweep configurable');
});

// --- the sweep --------------------------------------------------------------------

test('sweeps all five spheres with coefficients, tops and attribution', async () => {
  const { isError, data } = await correlate({ entity_ids: [PHOBBE], take: 3 });
  assert.equal(isError, false);
  assert.deepEqual(data.sourceEntityIds, [PHOBBE]);
  assert.equal(data.spheres.length, 5, 'default sweep: all agent domains');
  assert.deepEqual(
    data.spheres.map((s) => s.domain).sort(),
    ['urn:entity:artist', 'urn:entity:book', 'urn:entity:brand', 'urn:entity:movie', 'urn:entity:place'],
    'spheres resolve to primary insights types'
  );

  const film = data.spheres.find((s) => s.domain === 'urn:entity:movie');
  // The insights fixtures generate deterministic affinities per entity id;
  // the mean over the 3 pool movies is pinned here as a golden value.
  assert.equal(film.coefficient, 0.9607, 'mean of the generated affinities, rounded');
  assert.equal(film.top[0].name, 'Promising Young Woman');
  assert.ok(
    film.top[0].affinity >= 0.9 && film.top[0].affinity <= 0.999,
    `top affinity finite, got ${film.top[0].affinity}`
  );
  assert.deepEqual(film.sourceContribution, { [PHOBBE]: 1 }, 'per-source attribution');

  // Pooled spheres carry finite coefficients; skeletons carry none.
  for (const domain of ['urn:entity:artist', 'urn:entity:book', 'urn:entity:place']) {
    const sphere = data.spheres.find((s) => s.domain === domain);
    assert.ok(
      sphere.coefficient !== null && sphere.coefficient >= 0.9 && sphere.coefficient <= 0.999,
      `${domain}: finite coefficient, got ${sphere.coefficient}`
    );
  }
  const fashion = data.spheres.find((s) => s.domain === 'urn:entity:brand');
  assert.equal(fashion.coefficient, null, 'no affinity data -> honest null, not 0');
});

test('ranking is deterministic: descending coefficients, nulls last', async () => {
  const { data } = await correlate({ entity_ids: PHOBBE });
  const numeric = data.ranked.filter((r) => r.coefficient !== null);
  for (let i = 1; i < numeric.length; i += 1) {
    assert.ok(
      numeric[i - 1].coefficient >= numeric[i].coefficient,
      'descending order'
    );
  }
  const last = data.ranked[data.ranked.length - 1];
  assert.equal(last.coefficient, null, 'null coefficients sink to the bottom');

  const again = await correlate({ entity_ids: PHOBBE });
  assert.deepEqual(again.data.ranked, data.ranked, 'stable across calls');
});

test('domain subsets and explicit options are honored', async () => {
  const single = await correlate({ entity_ids: [PHOBBE], domains: ['music'] });
  assert.equal(single.data.spheres.length, 1);
  assert.equal(single.data.spheres[0].domain, 'urn:entity:artist', 'resolved to the Qloo type');

  const unexplained = await correlate({
    entity_ids: [PHOBBE],
    domains: ['film'],
    explainability: false,
  });
  assert.equal(unexplained.data.spheres[0].sourceContribution, null);
  assert.ok(unexplained.data.spheres[0].coefficient !== null, 'coefficients survive');
});

// --- validation and failure channels ---------------------------------------------------

test('invalid inputs fail synchronously with typed codes', async () => {
  const badDomain = await correlate({ entity_ids: [PHOBBE], domains: ['gaming'] });
  assert.equal(badDomain.isError, true);
  assert.equal(badDomain.error.code, 'INVALID_TARGET_DOMAIN');

  // Empty arrays are stopped by the schema's min(1) BEFORE the handler:
  // the SDK renders that as a human "MCP error -32602: …" text, not JSON.
  const badIds = await client.callTool({
    name: 'qloo_cross_correlate',
    arguments: { entity_ids: [] },
  });
  assert.equal(badIds.isError, true);
  assert.match(badIds.content[0].text, /MCP error|-32602/);
});

test('per-domain failures degrade to error entries, not a dead sweep', async () => {
  // Live path for this test only: mock off, stub selective upstream.
  env.MOCK_MODE = false;
  globalThis.fetch = async (url) => {
    const isMovie = new URL(String(url)).searchParams.get('filter.type') === 'urn:entity:movie';
    if (isMovie) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          results: {
            entities: [
              {
                name: 'Some Movie',
                entity_id: 'M1',
                type: 'urn:entity',
                subtype: 'urn:entity:movie',
                properties: {},
                popularity: 0.9,
                query: { affinity: 0.8 },
              },
            ],
          },
        }),
        text: async () => '',
      };
    }
    return {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: async () => ({ error_msg: 'upstream exploded' }),
      text: async () => '',
    };
  };

  try {
    const partial = await correlate({ entity_ids: [PHOBBE], domains: ['film', 'music'] });
    assert.equal(partial.isError, false, 'one healthy sphere keeps the sweep alive');
    const film = partial.data.spheres.find((s) => s.domain === 'urn:entity:movie');
    assert.equal(film.coefficient, 0.8);
    const music = partial.data.spheres.find((s) => s.domain === 'urn:entity:artist');
    assert.equal(music.coefficient, null);
    assert.ok(music.error, 'failed sphere reports its error');
    assert.ok(partial.data.ranked.some((r) => r.error), 'ranking marks failures');

    const dead = await correlate({ entity_ids: [PHOBBE], domains: ['music', 'books'] });
    assert.equal(dead.isError, true);
    assert.equal(dead.error.code, 'ALL_SPHERES_FAILED');
  } finally {
    env.MOCK_MODE = true;
    globalThis.fetch = async () => {
      throw new Error('network disabled');
    };
  }
});

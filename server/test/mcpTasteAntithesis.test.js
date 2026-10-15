import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// MOCK_MODE BEFORE the module graph loads: antithesis runs offline.
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
    throw new Error('network disabled: antithesis must work offline');
  };
  env.MOCK_MODE = true;
});

const antithesis = async (args) => {
  const result = await client.callTool({ name: 'qloo_taste_antithesis', arguments: args });
  return result.isError
    ? { isError: true, error: JSON.parse(result.content[0].text) }
    : { isError: false, data: JSON.parse(result.content[0].text) };
};

// --- discovery -----------------------------------------------------------------

test('qloo_taste_antithesis is listed with entity_ids required and a window option', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'qloo_taste_antithesis');
  assert.ok(tool, 'tool registered');
  assert.deepEqual([...tool.inputSchema.required], ['entity_ids']);
  assert.ok(tool.inputSchema.properties.window, 'window configurable');
  assert.ok(tool.inputSchema.properties.domains, 'sphere subset configurable');
});

// --- the inversion -----------------------------------------------------------------

test('carves top and inverse slices out of the affinity window', async () => {
  const { isError, data } = await antithesis({
    entity_ids: [PHOBBE],
    domains: ['film'],
    window: 3,
  });
  assert.equal(isError, false);
  const film = data.spheres[0];

  // Fixture window (generated affinities): The Menu 0.966 > Promising
  // Young Woman 0.960 > Last Night in Soho 0.956; cut = floor(3/3) = 1.
  assert.deepEqual(film.top.map((e) => e.name), ['The Menu']);
  assert.deepEqual(film.inverse.map((e) => e.name), ['Last Night in Soho']);
  assert.equal(film.topMean, 0.966);
  assert.equal(film.inverseMean, 0.956);
  assert.equal(film.contrast, 0.01, 'topMean - inverseMean, rounded');
});

test('default window over a tiny pool degrades honestly (no invented inverse)', async () => {
  const { data } = await antithesis({ entity_ids: [PHOBBE], domains: ['film'] });
  const film = data.spheres[0];
  // window 30 -> cut 10; the 3-entity mock pool is smaller than the cut,
  // so no inverse slice exists and the contrast stays null.
  assert.equal(film.top.length, 3, 'whole pool is the top slice');
  assert.deepEqual(film.inverse, [], 'no inverse invented');
  assert.equal(film.contrast, null);
});

test('sweeps all five spheres; degenerate spheres stay null, not zero', async () => {
  const { data } = await antithesis({ entity_ids: PHOBBE, window: 3 });
  assert.equal(data.spheres.length, 5);
  assert.equal(data.window, 3);
  for (const sphere of data.spheres) {
    assert.equal(sphere.error, undefined, `${sphere.domain}: no error`);
    if (sphere.domain !== 'urn:entity:movie') {
      assert.deepEqual(sphere.inverse, [], `${sphere.domain}: pool too small`);
      assert.equal(sphere.contrast, null);
    }
  }
});

test('ranking by contrast is deterministic and stable', async () => {
  const first = await antithesis({ entity_ids: [PHOBBE], window: 3 });
  const second = await antithesis({ entity_ids: [PHOBBE], window: 3 });
  assert.deepEqual(second.data.ranked, first.data.ranked);
  const numeric = first.data.ranked.filter((r) => r.contrast !== null);
  for (let i = 1; i < numeric.length; i += 1) {
    assert.ok(numeric[i - 1].contrast >= numeric[i].contrast, 'descending');
  }
  assert.equal(
    first.data.ranked[first.data.ranked.length - 1].contrast,
    null,
    'nulls last'
  );
});

// --- validation and failure channels -----------------------------------------------------

test('invalid inputs fail synchronously with typed codes', async () => {
  const badDomain = await antithesis({ entity_ids: [PHOBBE], domains: ['gaming'] });
  assert.equal(badDomain.isError, true);
  assert.equal(badDomain.error.code, 'INVALID_TARGET_DOMAIN');

  // Empty arrays are stopped by the schema's min(1) BEFORE the handler.
  const badIds = await client.callTool({
    name: 'qloo_taste_antithesis',
    arguments: { entity_ids: [] },
  });
  assert.equal(badIds.isError, true);
  assert.match(badIds.content[0].text, /MCP error|-32602/);

  const badWindow = await client.callTool({
    name: 'qloo_taste_antithesis',
    arguments: { entity_ids: [PHOBBE], window: 2 },
  });
  assert.equal(badWindow.isError, true, 'window below the documented floor');
  assert.match(badWindow.content[0].text, /MCP error|-32602/);
});

test('per-sphere failures degrade to error entries, not a dead sweep', async () => {
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
              { name: 'High', entity_id: 'H1', type: 'urn:entity', subtype: 'urn:entity:movie', properties: {}, popularity: 0.9, query: { affinity: 0.8 } },
              { name: 'Low', entity_id: 'L1', type: 'urn:entity', subtype: 'urn:entity:movie', properties: {}, popularity: 0.9, query: { affinity: 0.7 } },
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
    const partial = await antithesis({
      entity_ids: [PHOBBE],
      domains: ['film', 'music'],
      window: 3,
    });
    assert.equal(partial.isError, false, 'one healthy sphere keeps the sweep alive');
    const film = partial.data.spheres.find((s) => s.domain === 'urn:entity:movie');
    assert.equal(film.top[0].name, 'High');
    assert.equal(film.inverse[0].name, 'Low');
    assert.equal(film.contrast, 0.1);
    const music = partial.data.spheres.find((s) => s.domain === 'urn:entity:artist');
    assert.equal(music.contrast, null);
    assert.ok(music.error, 'failed sphere reports its error');
    assert.equal(music.error.code, 'QLOO_API_ERROR');

    const dead = await antithesis({ entity_ids: [PHOBBE], domains: ['music', 'books'] });
    assert.equal(dead.isError, true);
    assert.equal(dead.error.code, 'ALL_SPHERES_FAILED');
  } finally {
    env.MOCK_MODE = true;
    globalThis.fetch = async () => {
      throw new Error('network disabled');
    };
  }
});

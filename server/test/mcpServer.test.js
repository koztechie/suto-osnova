import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MOCK_MODE BEFORE the module graph loads: network tools must run fully
// offline from recorded fixtures (task 26).
process.env.QLOO_API_KEY = 'mcp-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = await import('../src/mcp/server.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '../src/mcp/server.js');
const PHOBBE = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';

let client;

beforeEach(async () => {
  // Fresh linked pair per test: server <-> client over in-memory transport.
  client = new Client({ name: 'test', version: '0.0.0' });
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

// --- protocol surface -----------------------------------------------------------

test('negotiates initialize and exposes 18 tools with schemas', async () => {
  const capabilities = client.getServerCapabilities();
  assert.ok(capabilities.tools !== undefined, 'tools capability declared');

  const { tools } = await client.listTools();
  assert.equal(tools.length, 18);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'detect_personal_data',
    'find_tags',
    'get_audience_insights',
    'get_cross_domain_affinities',
    'group_entities_by_domain',
    'qloo_capabilities',
    'qloo_cross_correlate',
    'qloo_detect_personal_data',
    'qloo_find_tags',
    'qloo_get_audience_insights',
    'qloo_get_cross_domain_affinities',
    'qloo_group_entities_by_domain',
    'qloo_resolve_entity',
    'qloo_search_audiences',
    'qloo_search_entities',
    'qloo_taste_antithesis',
    'search_audiences',
    'search_entities',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description?.length > 0, `${tool.name}: description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name}: object schema`);
    const props = tool.inputSchema.properties ?? {};
    // qloo_capabilities takes NO arguments by design (harness parity).
    assert.ok(
      Object.keys(props).length > 0 || tool.name === 'qloo_capabilities',
      `${tool.name}: input properties`
    );
  }
  // required fields survived schema compilation
  const search = tools.find((t) => t.name === 'search_entities');
  assert.deepEqual([...search.inputSchema.required].sort(), ['domain', 'query']);
});

test('ping round-trips', async () => {
  const pong = await client.ping();
  assert.ok(pong !== undefined);
});

// --- tool execution (mock fixtures, network sabotaged) -----------------------------

test('search_entities works offline through the mock fixtures', async () => {
  globalThis.fetch = async () => {
    throw new Error('network disabled: MCP tools must work offline');
  };
  const result = await client.callTool({
    name: 'search_entities',
    arguments: { query: 'Severance', domain: 'tv_show' },
  });
  assert.notEqual(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.results[0].name, 'Severance');
  assert.equal(payload.results[0].subtype, 'urn:entity:tv_show');
  assert.equal(payload.results[0].releaseYear, 2022);
});

test('cross-domain and audience tools work offline with attribution', async () => {
  const cross = await client.callTool({
    name: 'get_cross_domain_affinities',
    arguments: { entity_ids: [PHOBBE], target_domain: 'movie', take: 2 },
  });
  const crossPayload = JSON.parse(cross.content[0].text);
  assert.equal(crossPayload.results[0].name, 'Promising Young Woman');
  assert.ok(crossPayload.explainability['signal.interests.entities']);

  const audiences = await client.callTool({
    name: 'search_audiences',
    arguments: { query: 'outdoors' },
  });
  const audiencePayload = JSON.parse(audiences.content[0].text);
  assert.equal(audiencePayload.results[0].id, 'urn:audience:hobbies_and_interests:outdoors');
});

test('group_entities_by_domain classifies without network', async () => {
  const result = await client.callTool({
    name: 'group_entities_by_domain',
    arguments: {
      entities: [
        { subtype: 'urn:entity:place', tags: [{ id: 'urn:tag:genre:place:restaurant' }] },
        { subtype: 'urn:entity:brand', tags: [{ id: 'urn:tag:genre:brand:fashion' }] },
        { subtype: 'urn:entity:movie' },
      ],
    },
  });
  const groups = JSON.parse(result.content[0].text);
  assert.equal(groups.dining.length, 1);
  assert.equal(groups.fashion.length, 1);
  assert.equal(groups.film.length, 1);
});

test('detect_personal_data returns masked findings', async () => {
  const result = await client.callTool({
    name: 'detect_personal_data',
    arguments: { text: 'reach me at jane.doe@example.com or 10.0.0.7' },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.ok(payload.findings.some((f) => f.type === 'email'));
  assert.ok(payload.findings.some((f) => f.type === 'ipv4'));
  assert.ok(!JSON.stringify(payload).includes('jane.doe@example.com'), 'masked');
  assert.match(payload.summary, /email×1/);
});

// --- error channels -------------------------------------------------------------------

test('invalid arguments surface as isError results, not protocol errors', async () => {
  const result = await client.callTool({
    name: 'search_entities',
    arguments: { query: '', domain: 'film' },
  });
  // SDK 1.32 renders zod validation failures as an isError RESULT whose
  // text is a human "MCP error -32602: …" message (not JSON).
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP error|-32602|query/);
});

test('upstream failures map to isError with status context', async () => {
  // Live path for this test only: flip the mock off per-call (env is read
  // on every request), restore afterwards.
  const { env } = await import('../src/config/env.js');
  env.MOCK_MODE = false;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    headers: { get: () => 'application/json' },
    json: async () => ({ message: 'invalid key' }),
    text: async () => '',
  });
  try {
    const result = await client.callTool({
      name: 'search_entities',
      arguments: { query: 'Severance', domain: 'film' },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 401);
    assert.equal(payload.code, 'QLOO_API_ERROR');
  } finally {
    env.MOCK_MODE = true;
  }
});

test('unknown tool name is rejected by the protocol', async () => {
  // SDK 1.32 answers unknown tools with an isError result rather than a
  // thrown McpError; either channel is acceptable, both are asserted.
  try {
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unknown tool|no_such_tool/i);
  } catch (err) {
    assert.match(err.message, /unknown tool|no_such_tool/i);
  }
});

// --- real stdio integration (spawned process, MOCK_MODE=true) ---------------------

test('serves the full MCP handshake over real stdio', async () => {
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, MOCK_MODE: 'true', QLOO_API_KEY: 'stdio-key' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  const lines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) lines.push(JSON.parse(line)); // stdout purity: every line is JSON-RPC
    }
  });

  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  const waitFor = (id) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = lines.find((l) => l.id === id);
        if (found) {
          clearInterval(tick);
          resolve(found);
        } else if (Date.now() - started > 15000) {
          clearInterval(tick);
          reject(new Error(`timeout waiting for response ${id}`));
        }
      }, 20);
    });

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '0' },
      },
    });
    const init = await waitFor(1);
    assert.equal(init.result.serverInfo.name, 'suto-osnova');
    assert.ok(init.result.capabilities.tools !== undefined);

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    assert.equal(list.result.tools.length, 18);

    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_audiences', arguments: { query: 'outdoors' } },
    });
    const call = await waitFor(3);
    const payload = JSON.parse(call.result.content[0].text);
    assert.equal(payload.results[0].name, 'Outdoors');

    send({ jsonrpc: '2.0', id: 4, method: 'no/such/method' });
    const unknown = await waitFor(4);
    assert.equal(unknown.error.code, -32601);
  } finally {
    child.kill();
  }
});

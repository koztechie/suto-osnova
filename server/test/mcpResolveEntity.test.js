import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// MOCK_MODE BEFORE the module graph loads: resolver runs offline.
process.env.QLOO_API_KEY = 'mcp-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = await import('../src/mcp/server.js');

const PHOBBE = 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836';
const KENDRICK = 'C915A918-39C4-4F2B-8D6E-2A7B5C9E1F30';

let client;

beforeEach(async () => {
  client = new Client({ name: 'test', version: '0.0.0' });
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  globalThis.fetch = async () => {
    throw new Error('network disabled: resolver must work offline');
  };
});

const resolve = async (args) => {
  const result = await client.callTool({ name: 'qloo_resolve_entity', arguments: args });
  return result.isError
    ? { isError: true, error: JSON.parse(result.content[0].text) }
    : { isError: false, data: JSON.parse(result.content[0].text) };
};

// --- discovery -----------------------------------------------------------------

test('qloo_resolve_entity is listed with the name field required', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'qloo_resolve_entity');
  assert.ok(tool, 'tool registered');
  assert.deepEqual([...tool.inputSchema.required], ['name']);
  assert.ok(tool.inputSchema.properties.domain, 'domain hint exposed');
  assert.ok(tool.inputSchema.properties.allow_fuzzy, 'strict mode exposed');
});

// --- resolution semantics ----------------------------------------------------------

test('resolves an exact scoped match to a verified id with provenance', async () => {
  const { isError, data } = await resolve({ name: 'Phoebe Bridgers', domain: 'music' });
  assert.equal(isError, false);
  assert.equal(data.match, 'exact');
  assert.equal(data.verified, true);
  assert.equal(data.ambiguous, false, 'only one exact name in the fixture');
  assert.equal(data.mode, 'mock', 'provenance stamped');
  assert.equal(data.entity.id, PHOBBE);
  assert.equal(data.entity.domain, 'music', 'classified via domainMapper');
  assert.ok(data.alternatives.some((a) => a.id === KENDRICK), 'other candidates offered');
  assert.equal(data.candidatesScanned, 2);
});

test('unscoped resolution searches all agent domains and flags ambiguity', async () => {
  const first = await resolve({ name: 'Phoebe Bridgers' });
  assert.equal(first.isError, false);
  assert.equal(first.data.match, 'exact');
  assert.equal(first.data.ambiguous, true, 'skeleton fallback yields multiple same-name hits');
  assert.equal(first.data.alternatives.length, 6, 'runner-ups listed');

  const second = await resolve({ name: 'Phoebe Bridgers' });
  assert.equal(second.data.entity.id, first.data.entity.id, 'deterministic pick');
});

test('fuzzy fallback prefers popularity; strict mode demands exact', async () => {
  const fuzzy = await resolve({ name: 'Bon Iver', domain: 'music' });
  assert.equal(fuzzy.isError, false);
  assert.equal(fuzzy.data.match, 'fuzzy');
  assert.equal(fuzzy.data.entity.id, KENDRICK, 'higher popularity wins the tie-break');
  assert.ok(fuzzy.data.alternatives.some((a) => a.id === PHOBBE));

  const strict = await resolve({ name: 'Bon Iver', domain: 'music', allow_fuzzy: false });
  assert.equal(strict.isError, true);
  assert.equal(strict.error.code, 'ENTITY_NOT_FOUND');
  assert.match(strict.error.error, /exact name match/);
});

test('min_popularity gates candidates before selection', async () => {
  const gated = await resolve({
    name: 'Phoebe Bridgers',
    domain: 'music',
    min_popularity: 0.95,
  });
  assert.equal(gated.isError, false);
  assert.equal(gated.data.entity.id, KENDRICK, 'Phoebe (0.91) filtered out, fuzzy winner');
  assert.equal(gated.data.match, 'fuzzy');

  const none = await resolve({
    name: 'Phoebe Bridgers',
    domain: 'music',
    min_popularity: 0.999,
    allow_fuzzy: false,
  });
  assert.equal(none.isError, true);
  assert.equal(none.error.code, 'ENTITY_NOT_FOUND');
  assert.match(none.error.error, /min_popularity/);
});

// --- validation channel ---------------------------------------------------------------

test('invalid names surface as isError results', async () => {
  const result = await client.callTool({
    name: 'qloo_resolve_entity',
    arguments: { name: '' },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP error|-32602|name/);
});

test('domain hints stay inside the agent vocabulary', async () => {
  const { isError, error } = await resolve({ name: 'X', domain: 'gaming' });
  assert.equal(isError, true);
  assert.equal(error.code, 'INVALID_DOMAIN');
});

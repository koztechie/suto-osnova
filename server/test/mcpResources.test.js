import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// MOCK_MODE BEFORE the module graph loads: resource reads over the
// network must run offline from recorded fixtures (task 26).
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
const DRAMA = 'urn:tag:genre:media:drama';
const OUTDOORS = 'urn:audience:hobbies_and_interests:outdoors';

let client;
let fetchCalls;

beforeEach(async () => {
  client = new Client({ name: 'test', version: '0.0.0' });
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Default: network sabotaged. Individual tests may relax this.
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network disabled');
  };
});

const readText = async (uri) => {
  const res = await client.readResource({ uri });
  assert.equal(res.contents[0].mimeType, 'application/json');
  assert.equal(res.contents[0].uri, uri);
  return JSON.parse(res.contents[0].text);
};

// --- discovery -----------------------------------------------------------------

test('resources/list exposes the domains catalog; templates list the graph', async () => {
  const { resources } = await client.listResources();
  const domains = resources.find((r) => r.uri === 'qloo://domains');
  assert.ok(domains, 'qloo://domains listed');
  assert.equal(domains.mimeType, 'application/json');

  const { resourceTemplates } = await client.listResourceTemplates();
  const patterns = resourceTemplates.map((t) => t.uriTemplate).sort();
  assert.deepEqual(patterns, [
    'qloo://audiences/{audience}',
    'qloo://domains/{domain}',
    'qloo://entity/{id}',
    'qloo://tags/{tag}',
  ]);
});

// --- local resources (no network) -------------------------------------------------

test('qloo://domains serves the standardized vocabulary offline', async () => {
  const payload = await readText('qloo://domains');
  assert.deepEqual(payload.mandatory, ['film', 'music', 'books', 'dining', 'fashion']);
  assert.equal(payload.domains.dining.searchTypes[0], 'urn:entity:place');
  assert.deepEqual(payload.domains.dining.tagFamilies, [
    'urn:tag:genre:place:restaurant',
    'urn:tag:category:place:restaurant',
  ]);
  assert.equal(fetchCalls, 0, 'pure local resource');
});

test('qloo://domains/{domain} resolves aliases and rejects unknowns', async () => {
  const dining = await readText('qloo://domains/restaurants');
  assert.equal(dining.id, 'dining');
  const film = await readText('qloo://domains/film');
  assert.deepEqual(film.searchTypes, ['urn:entity:movie', 'urn:entity:tv_show']);
  assert.ok(film.links.includes('qloo://domains'));

  await assert.rejects(
    client.readResource({ uri: 'qloo://domains/gaming' }),
    (err) => {
      assert.match(err.message, /Unknown domain|gaming/);
      return true;
    }
  );
  assert.equal(fetchCalls, 0, 'pure local resource');
});

// --- entity graph nodes (mock fixtures) -------------------------------------------

test('qloo://entity/{id} serves a classified node with graph links', async () => {
  const node = await readText(`qloo://entity/${PHOBBE}`);
  assert.equal(node.name, 'Phoebe Bridgers');
  assert.equal(node.domain, 'music', 'classified into an agent domain');
  assert.match(node.description, /singer-songwriter/, 'short_description normalized');
  assert.ok(node.links.includes(`qloo://entity/${PHOBBE}`), 'self link');
  assert.ok(node.links.includes('qloo://domains/music'), 'domain link');
  assert.ok(node.links.includes('qloo://tags/urn:tag:genre:music:indie'), 'tag edge links');
  assert.equal(node.external.spotify.id, '1r1uxoy19fzMxunt3ONAkG');
});

test('qloo://entity/{id} degrades to an honest skeleton offline (unknown id)', async () => {
  const node = await readText('qloo://entity/00000000-0000-4000-8000-000000000000');
  assert.equal(node.id, '00000000-0000-4000-8000-000000000000', 'requested id echoed');
  assert.equal(node.name, 'Mock Entity');
  assert.equal(node.domain, null, 'no invented classification');
  assert.deepEqual(node.tags, [], 'no invented tags');
});

// --- tag and audience nodes (mock fixtures) -----------------------------------------

test('qloo://tags/{urn} serves a tag node with parent-domain links', async () => {
  const node = await readText(`qloo://tags/${DRAMA}`);
  assert.equal(node.name, 'Drama');
  assert.equal(node.type, 'urn:tag:genre:media');
  assert.ok(node.popularity > 0.99);
  assert.ok(node.parents.includes('urn:entity:movie'));
  assert.ok(node.links.includes('qloo://domains/film'), 'parent type mapped to a domain');

  await assert.rejects(
    client.readResource({ uri: 'qloo://tags/urn:tag:genre:media:no_such_tag' }),
    (err) => {
      assert.match(err.message, /tag not found/);
      return true;
    }
  );
});

test('qloo://audiences/{urn} serves an audience node', async () => {
  const node = await readText(`qloo://audiences/${OUTDOORS}`);
  assert.equal(node.name, 'Outdoors');
  assert.equal(node.type, 'urn:audience:hobbies_and_interests');
  assert.equal(node.entityId, 'AAAE9FAA-FE3D-4732-9E82-BD4CED485D60');
  assert.ok(node.links.includes(`qloo://audiences/${OUTDOORS}`));

  await assert.rejects(
    client.readResource({ uri: 'qloo://audiences/urn:audience:global_issues:nope' }),
    (err) => {
      assert.match(err.message, /audience not found/);
      return true;
    }
  );
});

// --- tools still work alongside resources -------------------------------------------

test('tools and resources coexist on one server', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 18, 'tasks 28-32 + harness-alias surface intact');
  const domains = await readText('qloo://domains');
  assert.equal(domains.mandatory.length, 5);
});

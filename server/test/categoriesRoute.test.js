/**
 * GET /api/categories route gate (task 114) — the supported
 * categories / domains metadata:
 *   - the five mandatory agent domains, in MANDATORY order, each with
 *     its full registry metadata (id, label, aliases, searchTypes,
 *     insightTypes, tagFamilies);
 *   - the metadata matches the domainMapper registry (film = "Film &
 *     TV"; dining/fashion carry their qualifying tag families);
 *   - the static, offline, cacheable contract (X-Request-Id + a cache
 *     header; zero network).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.QLOO_API_KEY = 'categories-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';

const { createHttpHandler } = await import('../src/app.js');
const { MANDATORY_DOMAINS, DOMAIN_REGISTRY } = await import('../src/services/domainMapper.js');

const realFetch = globalThis.fetch;
let server;
let baseUrl;

beforeEach(async () => {
  globalThis.fetch = async () => { throw new Error('network disabled'); };
  server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        json: () => JSON.parse(data),
      }));
    }).on('error', reject);
  });
}

test('the five mandatory domains, in order, with full metadata', async () => {
  const res = await get('/api/categories');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.ok(res.headers['x-request-id'], 'the correlation header rides');

  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'suto-osnova');
  assert.equal(body.count, 5);
  assert.deepEqual(body.categories.map((c) => c.id), [...MANDATORY_DOMAINS]);

  for (const category of body.categories) {
    const entry = DOMAIN_REGISTRY[category.id];
    assert.equal(category.label, entry.label, `${category.id} label`);
    assert.deepEqual([...category.aliases], [...entry.aliases], `${category.id} aliases`);
    assert.deepEqual([...category.searchTypes], [...entry.searchTypes]);
    assert.deepEqual([...category.insightTypes], [...entry.insightTypes]);
    assert.deepEqual([...category.tagFamilies], [...entry.tagFamilies]);
    assert.ok(category.label.length > 0);
  }
});

test('the registry specifics: labels + the qualifying tag families', async () => {
  const body = (await get('/api/categories')).json();
  const byId = new Map(body.categories.map((c) => [c.id, c]));

  assert.equal(byId.get('film').label, 'Film & TV');
  assert.deepEqual([...byId.get('film').searchTypes],
    ['urn:entity:movie', 'urn:entity:tv_show']);
  // dining/fashion are qualified by their tag families, not the type alone.
  assert.deepEqual([...byId.get('dining').tagFamilies],
    ['urn:tag:genre:place:restaurant', 'urn:tag:category:place:restaurant']);
  assert.deepEqual([...byId.get('fashion').tagFamilies],
    ['urn:tag:genre:brand:fashion']);
  // music/books map directly (no qualifying tag family).
  assert.deepEqual([...byId.get('music').tagFamilies], []);
  assert.deepEqual([...byId.get('books').tagFamilies], []);
});

test('static + cacheable + zero network', async () => {
  const res = await get('/api/categories');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /max-age=\d+/,
    'static metadata is cacheable');
  // globalThis.fetch throws, so any network use would fail the request.
  const again = await get('/api/categories');
  assert.deepEqual(again.json(), res.json(), 'deterministic static payload');
});

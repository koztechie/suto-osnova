/**
 * CLIENT API SINGLE-FLIGHT (Lighthouse network dependency tree) — pins
 * client/src/js/api.js: the six consumers of the static domain registry
 * (anchor hints, the domain grid, the five domain plates) must share
 * ONE /api/categories round trip per session, while /api/health stays
 * UNmemoized (the connectivity probe re-runs by design).
 *
 * Runs the REAL module in Node 22 (global fetch, Response) — api.js and
 * inspector.js are import-safe without a DOM (injected doc/win).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_URL = pathToFileURL(path.join(ROOT, 'client', 'src', 'js', 'api.js')).href;
const JS_DIR = path.join(ROOT, 'client', 'src', 'js');

/** A fresh module instance (the single-flight slot is module state). */
let seq = 0;
async function freshApi() {
  seq += 1;
  return import(`${API_URL}?fresh=${seq}`);
}

/** Stub global.fetch with a counting fake; returns the call ledger. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), calls.length);
  };
  return calls;
}

const ok = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const fail = (code) =>
  new Response(JSON.stringify({ status: 'error', error: { code, message: 'boom' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });

test('six concurrent consumers trigger exactly ONE /api/categories request', async () => {
  const api = await freshApi();
  const calls = stubFetch(() => ok({ status: 'ok', domains: [{ id: 'music' }] }));
  const results = await Promise.all([
    api.fetchCategories(), api.fetchCategories(), api.fetchCategories(),
    api.fetchCategories(), api.fetchCategories(), api.fetchCategories(),
  ]);
  assert.equal(calls.length, 1, 'one network round trip for six consumers');
  assert.equal(calls.filter((c) => c.url.endsWith('/api/categories')).length, 1);
  for (const body of results) assert.deepEqual(body.domains, [{ id: 'music' }]);
});

test('sequential calls reuse the resolved session cache (still ONE request)', async () => {
  const api = await freshApi();
  const calls = stubFetch(() => ok({ status: 'ok', domains: [] }));
  const first = api.fetchCategories();
  const second = api.fetchCategories();
  assert.equal(first, second, 'the same promise instance is returned');
  await first;
  const third = api.fetchCategories(); // after resolution
  await third;
  assert.equal(third, first, 'the resolved promise is served from cache');
  assert.equal(calls.length, 1, 'no second network round trip ever happens');
});

test('a FAILED registry fetch is NOT cached — the next caller retries', async () => {
  const api = await freshApi();
  const calls = stubFetch((_url, n) => (n === 1 ? fail('BOOM') : ok({ status: 'ok', domains: [] })));
  await assert.rejects(() => api.fetchCategories(), /boom/);
  const body = await api.fetchCategories(); // retried, succeeds
  assert.equal(body.status, 'ok');
  assert.equal(calls.length, 2, 'the failure freed the slot for a retry');
});

test('/api/health is NOT memoized (the connectivity probe re-runs by design)', async () => {
  const api = await freshApi();
  const calls = stubFetch(() => ok({ status: 'ok', service: 'suto-osnova' }));
  await api.fetchHealth();
  await api.fetchHealth();
  assert.equal(calls.length, 2, 'each probe is its own round trip');
});

test('REGRESSION GUARD: no direct /api/categories fetch exists outside api.js', async () => {
  const files = (await readdir(JS_DIR)).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const text = await readFile(path.join(JS_DIR, file), 'utf8');
    const raw = text.match(/fetch\(\s*[`'"]\/api\/categories/g) ?? [];
    assert.deepEqual(raw, [], `${file} must not fetch /api/categories directly`);
    const requests = text.match(/request\(\s*[`'"]\/categories/g) ?? [];
    if (file === 'api.js') {
      assert.equal(requests.length, 1, 'api.js is the single request site');
    } else {
      assert.deepEqual(requests, [], `only api.js may request('/categories'`);
    }
  }
});

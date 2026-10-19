/**
 * NETLIFY DEPLOY gate (tasks 173-176) — pins the free-tier production
 * config AND executes the serverless adapter against the real handler.
 *
 * The config (`netlify.toml`) is TOML because that is the ONLY format
 * Netlify reads. The `/api/*` gateway is adapted to a FUNCTIONS v2
 * Function (netlify/functions/api.mjs): it receives a WHATWG `Request`
 * and MUST return a WHATWG `Response` (returning the legacy v1
 * `{statusCode,...}` object raised the production 502
 * "Function returned an unsupported value"). This gate validates the
 * config structure AND invokes the function with real `Request` objects
 * (health 200, CORS 204, a real generate run, and path-form
 * normalization) so a broken bridge cannot reach a deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Env BEFORE the dynamic function import (the adapter builds the handler
// at module load, and env.js reads process.env at that moment).
process.env.QLOO_API_KEY ??= 'netlify-deploy-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.INBOUND_RATE_LIMIT = '100';
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const toml = await readFile(path.join(ROOT, 'netlify.toml'), 'utf8');
const fnSource = await readFile(path.join(ROOT, 'netlify', 'functions', 'api.mjs'), 'utf8');
const { default: netlifyHandler } = await import('../netlify/functions/api.mjs');

const BASE = 'https://suto-osnova.netlify.app';

/** Invokes the v2 handler with a WHATWG Request (mirrors Netlify). */
function call(method, requestPath, { body, headers } = {}) {
  const init = { method, headers: { ...(headers ?? {}) } };
  if (body) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return netlifyHandler(new Request(BASE + requestPath, init));
}

test('netlify.toml: build, publish, functions dir and pinned Node', () => {
  assert.match(toml, /command\s*=\s*"npm run build"/, 'builds the client');
  assert.match(toml, /publish\s*=\s*"dist"/, 'publishes the static client from dist');
  assert.match(toml, /functions\s*=\s*"netlify\/functions"/, 'points at the function dir');
  assert.match(toml, /NODE_VERSION\s*=\s*"22"/, 'pins the Node 22 runtime');
});

test('netlify.toml: the /api redirect precedes the SPA fallback (first match wins)', () => {
  const apiIdx = toml.indexOf('"/api/*"');
  const spaIdx = toml.indexOf('"/*"');
  assert.ok(apiIdx !== -1, 'the /api/* redirect exists');
  assert.ok(spaIdx !== -1, 'the /* SPA fallback exists');
  assert.ok(apiIdx < spaIdx, '/api/* must be listed BEFORE /* or the API would serve index.html');
  assert.match(toml, /\.netlify\/functions\/api/, 'the /api/* redirect targets the function');
});

test('the function adapter bridges the real Node handler as FUNCTIONS v2', () => {
  assert.ok(fnSource.includes("from '../../server/src/app.js'"),
    'the adapter imports the actual createHttpHandler');
  assert.ok(fnSource.includes('new Response('),
    'the adapter RETURNS a WHATWG Response (v2 contract — the 502 fix)');
  assert.match(fnSource, /export default/, 'the adapter exports a default Netlify handler');
  assert.ok(!/\brequire\(/.test(fnSource), 'the adapter is ESM (no CommonJS require)');
});

test('function: GET /api/health answers a real 200 Response', async () => {
  const response = await call('GET', '/api/health');
  assert.ok(response instanceof Response, 'the handler returns a WHATWG Response');
  assert.equal(response.status, 200, 'health is 200 in MOCK_MODE');
  assert.equal((await response.json()).status, 'ok');
  assert.equal(response.headers.get('content-type'), 'application/json',
    'headers set via writeHead/setHeader survive into the Response');
});

test('function: OPTIONS preflight answers 204 (CORS short-circuit)', async () => {
  const response = await call('OPTIONS', '/api/health', {
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(response.status, 204, 'the CORS preflight is answered, not run as a request');
});

test('function: POST /api/generate/worldbuilder runs the pipeline serverless', async () => {
  const response = await call('POST', '/api/generate/worldbuilder', {
    body: { seed: 'A24 Psychological Horror', format: 'json' },
  });
  const payload = await response.json(); // read the body ONCE
  assert.equal(response.status, 200,
    `expected 200, got ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
  assert.equal(payload.status, 'ok');
  assert.ok(response.headers.get('x-request-id'),
    'the X-Request-Id correlation header survives into the Response');
});

test('routing: every API route resolves through the bridge (canonical form)', async () => {
  const cases = [
    ['GET', '/api/health', null],
    ['GET', '/api/categories', null],
    ['POST', '/api/generate/worldbuilder', { seed: 'A24 Psychological Horror' }],
    ['POST', '/api/generate/experiential', { seed: 'Ambient Festival' }],
    ['POST', '/api/generate/antithesis', { seed: 'Blade Runner' }],
  ];
  for (const [method, route, body] of cases) {
    const response = await call(method, route, { body });
    assert.equal(response.status, 200,
      `${method} ${route} -> 200 (got ${response.status}: ${(await response.text()).slice(0, 160)})`);
    assert.equal((await call(method, route, { body }).then((r) => r.json())).status, 'ok',
      `${route} answers ok`);
  }
});

test('routing: the redirect splat and mount path forms normalize to the same route', async () => {
  // Netlify can deliver the ORIGINAL path, the bare REDIRECT SPLAT, or
  // the full function mount — the adapter must route all three identically.
  for (const form of ['/api/health', '/health', '/.netlify/functions/api/health']) {
    const response = await call('GET', form);
    assert.equal(response.status, 200, `path form ${form} routes to health`);
    assert.equal((await response.json()).status, 'ok', `${form} is health, not the echo route`);
  }
  // The splat form of a generate route normalizes too (POST + body).
  const generate = await call('POST', '/generate/worldbuilder', {
    body: { seed: 'A24 Psychological Horror' },
  });
  assert.equal(generate.status, 200, 'the splat form of a generate route routes correctly');
});

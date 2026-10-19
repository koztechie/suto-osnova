/**
 * NETLIFY DEPLOY gate (task 173) — pins the free-tier production config
 * AND executes the serverless adapter against the real handler.
 *
 * The config (`netlify.toml`) is TOML because that is the ONLY format
 * Netlify reads — a `netlify.json` would be silently ignored and the
 * deploy would ship unconfigured. The `/api/*` gateway is adapted to a
 * Function (netlify/functions/api.mjs) that bridges Netlify's event
 * model to the Node `(req, res)` handler, so the whole app runs
 * serverless with zero new dependencies.
 *
 * This gate validates the config structure AND invokes the function
 * (health 200, CORS preflight 204, a real generate run) so a broken
 * bridge cannot reach a deploy.
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

test('the function adapter bridges the real Node handler', () => {
  assert.ok(fnSource.includes("from '../../server/src/app.js'"),
    'the adapter imports the actual createHttpHandler');
  assert.match(fnSource, /export default/, 'the adapter exports a default Netlify handler');
  assert.ok(!/\brequire\(/.test(fnSource), 'the adapter is ESM (no CommonJS require)');
});

test('function: GET /api/health answers 200 ok through the bridge', async () => {
  const response = await netlifyHandler({
    httpMethod: 'GET',
    path: '/api/health',
    headers: {},
    queryStringParameters: {},
    body: null,
  });
  assert.equal(response.statusCode, 200, 'health is 200 in MOCK_MODE');
  assert.equal(JSON.parse(response.body).status, 'ok');
  // The headers set via res.writeHead/setHeader survive the bridge.
  assert.equal(response.headers['Content-Type'], 'application/json');
});

test('function: OPTIONS preflight answers 204 (CORS short-circuit)', async () => {
  const response = await netlifyHandler({
    httpMethod: 'OPTIONS',
    path: '/api/health',
    headers: { origin: 'http://localhost:5173' },
    queryStringParameters: {},
    body: null,
  });
  assert.equal(response.statusCode, 204, 'the CORS preflight is answered, not run as a request');
});

test('function: POST /api/generate/worldbuilder runs the pipeline serverless', async () => {
  const response = await netlifyHandler({
    httpMethod: 'POST',
    path: '/api/generate/worldbuilder',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: {},
    body: JSON.stringify({ seed: 'A24 Psychological Horror', format: 'json' }),
  });
  assert.equal(response.statusCode, 200,
    `expected 200, got ${response.statusCode}: ${String(response.body).slice(0, 200)}`);
  assert.equal(JSON.parse(response.body).status, 'ok');
  // generate sets the X-Request-Id correlation header; it survives the bridge.
  assert.ok(response.headers['X-Request-Id'] || response.headers['x-request-id'],
    'the X-Request-Id correlation header survives the bridge');
});

/**
 * Static mirror gate (task 191) — verifies the OPT-IN static path that
 * lets ONE Node process serve the whole app (built client + /api) on a
 * Render/VPS backup mirror, WITHOUT touching the legacy echo contract.
 *
 *   - resolveStaticPath: a `..` traversal / absolute escape / null byte
 *     can never resolve outside the root;
 *   - serveStaticMirror: serves the shell + built assets with the right
 *     content-type and immutable caching for /assets/*, HEAD-safe;
 *   - the handler serves static ONLY when STATIC_DIR is set (default =
 *     the legacy echo, pinned here too);
 *   - an unknown path falls back to the SPA shell, never a leak.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY ??= 'static-mirror-test-key';
const { createHttpHandler } = await import('../src/app.js');
const { serveStaticMirror, resolveStaticPath } = await import(
  '../src/middleware/staticMirror.js'
);

const realFetch = globalThis.fetch;
const realStaticDir = process.env.STATIC_DIR;
let server;
let base;
let root;
let outside;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mirror-root-'));
  outside = await mkdtemp(path.join(tmpdir(), 'mirror-outside-'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>SHELL</h1>');
  await writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET-CANARY');
  process.env.STATIC_DIR = root;
  server = http.createServer(createHttpHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (realStaticDir === undefined) delete process.env.STATIC_DIR;
  else process.env.STATIC_DIR = realStaticDir;
  if (server) await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await realFetch(base + p);
  const body = await res.text();
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body };
};

test('resolveStaticPath: traversal / absolute escape / null byte all escape-proof', () => {
  assert.equal(resolveStaticPath(root, '/../secret.txt'), null, 'parent traversal rejected');
  assert.equal(resolveStaticPath(root, '/../../etc/passwd'), null, 'deep traversal rejected');
  assert.equal(resolveStaticPath(root, '/%2e%2e/secret.txt'), null, 'encoded traversal rejected');
  assert.equal(resolveStaticPath(root, '/a%00b'), null, 'null byte rejected');
  assert.ok(resolveStaticPath(root, '/index.html').startsWith(path.resolve(root)), 'a normal path stays inside the root');
});

test('serves the SPA shell at / with html content-type', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /SHELL/);
});

test('serves a built asset with immutable caching', async () => {
  const r = await get('/assets/app.js');
  assert.equal(r.status, 200);
  assert.match(r.type, /javascript/);
  assert.equal(r.cache, 'public, max-age=31536000, immutable');
  assert.match(r.body, /console\.log/);
});

test('HEAD returns headers with no body', async () => {
  const res = await realFetch(`${base}/`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal((await res.text()), '');
});

test('a traversal request can NEVER serve the canary outside the root', async () => {
  // The path escapes -> resolveStaticPath returns null -> the handler
  // falls back to the SHELL (or 404), never the outside file.
  const r = await get('/../' + path.basename(outside) + '/secret.txt');
  assert.ok(!r.body.includes('TOP-SECRET-CANARY'),
    `traversal leaked the outside file: ${r.body.slice(0, 80)}`);
});

test('unknown path falls back to the SPA shell (client-side routes)', async () => {
  const r = await get('/some/client/route');
  assert.equal(r.status, 200);
  assert.match(r.body, /SHELL/);
});

test('WITHOUT STATIC_DIR the legacy echo contract is preserved', async () => {
  delete process.env.STATIC_DIR;
  const res = await realFetch(`${base}/`);
  const json = await res.json();
  assert.deepEqual(json, { status: 'ok', service: 'suto-osnova', receivedBody: null },
    'the default (mirror off) still answers the legacy echo, not a file');
});

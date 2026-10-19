/**
 * CLIENT BUILD gate (task 171) — verifies the Vite production build
 * actually MINIFIES CSS and COMPRESSES JS, preserves the same-origin
 * `/api` gateway, leaks no secret, and keeps the asset contract.
 *
 * The build is run ONCE for the file (via scripts/buildClient.mjs) and
 * the emitted `dist/` (gitignored) is asserted against the raw
 * `client/` source, which stays the dev truth and is untouched.
 *
 * WHAT "MINIFIED" MEANS HERE (measured, not assumed):
 *   - the built CSS/JS lands on ONE line (whitespace + newlines gone);
 *   - the built payload is at least 40% smaller than the summed source
 *     (comments, indentation, dead branches removed);
 *   - the gateway stays same-origin `/api` with NO external origin and
 *     NO API key anywhere in the output.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT = path.join(ROOT, 'client');
const DIST = path.join(ROOT, 'dist');

/** Total bytes of every file under `dir` with the given extension. */
async function totalBytes(dir, ext) {
  let sum = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (full.endsWith(ext)) sum += Buffer.byteLength(await readFile(full));
    }
  };
  await walk(dir);
  return sum;
}

/** The single built file with the given extension under dist/assets. */
async function builtAsset(ext) {
  const files = await readdir(path.join(DIST, 'assets'));
  const match = files.filter((f) => f.endsWith(ext));
  assert.equal(match.length, 1, `exactly one built ${ext} (cssCodeSplit off)`);
  return readFile(path.join(DIST, 'assets', match[0]), 'utf8');
}

let srcCssBytes;
let srcJsBytes;

before(async () => {
  srcCssBytes = await totalBytes(path.join(CLIENT, 'src', 'css'), '.css');
  srcJsBytes = await totalBytes(path.join(CLIENT, 'src', 'js'), '.js');
  // Run the real build once; a failure here fails the whole file.
  await run('node', ['scripts/buildClient.mjs'], { cwd: ROOT, timeout: 120_000 });
});

test('CSS is minified: one line and at least 40% smaller than source', async () => {
  const css = await builtAsset('.css');
  const lines = css.split('\n').filter((l) => l.trim().length > 0);
  assert.ok(lines.length <= 2, `built CSS is on ${lines.length} line(s) (minified)`);
  assert.ok(
    Buffer.byteLength(css) < srcCssBytes * 0.6,
    `built CSS ${Buffer.byteLength(css)}B must be < 60% of source ${srcCssBytes}B`
  );
  // No preserved block-comment continuation (only the tiny /*$vite$*/ marker).
  assert.ok(!/\n\s*\*/.test(css), 'no multi-line comment blocks survive minification');
});

test('JS is compressed: one line and at least 40% smaller than source', async () => {
  const js = await builtAsset('.js');
  const lines = js.split('\n').filter((l) => l.trim().length > 0);
  assert.ok(lines.length <= 2, `built JS is on ${lines.length} line(s) (minified)`);
  assert.ok(
    Buffer.byteLength(js) < srcJsBytes * 0.6,
    `built JS ${Buffer.byteLength(js)}B must be < 60% of source ${srcJsBytes}B`
  );
  // No leading indentation survives (a hallmark of un-minified code).
  assert.ok(!/^ {2,}\S/m.test(js), 'no indented lines survive minification');
});

test('the gateway stays same-origin /api with no external origin and no key', async () => {
  const js = await builtAsset('.js');
  assert.ok(js.includes('/api'), 'the built client still targets the /api gateway');
  const external = js.match(/https?:\/\/[a-zA-Z0-9.-]+/g) ?? [];
  assert.deepEqual(external, [], `no external origin may be baked in: ${external.join(', ')}`);

  // No API key anywhere in the emitted build.
  const env = await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
  const key = env.match(/^QLOO_API_KEY=(.*)$/m)?.[1]?.trim();
  if (key) {
    for (const file of await readdir(DIST, { recursive: true })) {
      const full = path.join(DIST, file);
      if ((await readFile(full).catch(() => null)) === null) continue;
      const text = await readFile(full, 'utf8').catch(() => '');
      assert.ok(!text.includes(key), `the API key leaked into dist/${file}`);
    }
  }
});

test('the asset contract holds: hashed assets, robots.txt at root, og:image present', async () => {
  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  assert.match(html, /href="\/assets\/[^"]+\.css"/, 'the stylesheet is a hashed /assets ref');
  assert.match(html, /src="\/assets\/[^"]+\.js"/, 'the module script is a hashed /assets ref');
  assert.ok(html.includes('og:image'), 'the built HTML keeps the og:image meta');
  assert.ok(!html.includes('./public/'), 'Vite rewrote the ./public refs (no broken paths)');
  assert.ok((await readFile(path.join(DIST, 'robots.txt'))).includes('User-agent'),
    'robots.txt ships at the web root');
});

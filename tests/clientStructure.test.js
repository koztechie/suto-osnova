/**
 * Client structure + tokens gate (tasks 121-122) — pins the vanilla
 * client scaffold and its design-token configuration:
 *   - the required tree exists (index.html, src/css/, src/js/, public/);
 *   - index.html is HTML5, loads the stylesheet + favicon + the ES-module
 *     entry, and every referenced local asset actually exists;
 *   - the STRICT Archival Iron palette holds across EVERY client file:
 *     no hex literal outside the six permitted values (CSS custom
 *     properties or SVG);
 *   - tokens.css is the SINGLE SOURCE OF TRUTH: the six hex literals
 *     appear EXACTLY ONCE in the whole tree (in tokens.css), every other
 *     colour is derived via color-mix()/transparent, and no stylesheet
 *     redefines a token;
 *   - every var(--token) reference resolves to a token defined in
 *     tokens.css (no dangling custom properties);
 *   - the JS is framework-free ES6+ (import/export, native fetch, no
 *     CommonJS require/module.exports, no React/Vue/Tailwind/jQuery/axios,
 *     no absolute upstream URL, no API key);
 *   - every JS file parses as a real ES module (node --check on a .mjs);
 *   - zero Unicode emojis anywhere in the client tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const JS_DIR = path.join(CLIENT, 'src', 'js');
const CSS_DIR = path.join(CLIENT, 'src', 'css');
const PUBLIC_DIR = path.join(CLIENT, 'public');
const INDEX = path.join(CLIENT, 'index.html');

/** The ONLY six hex values permitted anywhere in the client (AGENTS.md). */
const PALETTE = new Set(['#101114', '#1f2326', '#96a2a8', '#d4a853', '#e06338', '#f4efe6']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function readText(file) {
  return readFile(file, 'utf8');
}

test('the required client tree exists', async () => {
  for (const target of [CLIENT, JS_DIR, CSS_DIR, PUBLIC_DIR]) {
    assert.ok((await stat(target)).isDirectory(), `${target} is a directory`);
  }
  assert.ok((await stat(INDEX)).isFile(), 'client/index.html is a file');
  const jsFiles = (await readdir(JS_DIR)).filter((f) => f.endsWith('.js'));
  assert.ok(jsFiles.includes('main.js'), 'src/js/main.js (the module entry) exists');
});

test('index.html is HTML5 and wires only existing local assets', async () => {
  const html = await readText(INDEX);
  assert.ok(html.startsWith('<!doctype html>'), 'the doctype is HTML5');
  assert.match(html, /<meta charset="utf-8">/, 'charset is declared');
  assert.match(html, /name="viewport"/, 'the viewport meta exists');

  const moduleScript = html.match(/<script type="module" src="([^"]+)"><\/script>/);
  assert.ok(moduleScript, 'a native ES-module entry script is loaded');
  const sheet = html.match(/<link rel="stylesheet" href="([^"]+)">/);
  assert.ok(sheet, 'the stylesheet is linked');

  // Every referenced local asset must exist on disk.
  for (const ref of [moduleScript[1], sheet[1]]) {
    const target = path.join(CLIENT, ref);
    assert.ok((await stat(target)).isFile(), `${ref} resolves to a real file`);
  }
  const favicon = html.match(/href="(\.\/public\/favicon\.svg)"/);
  assert.ok(favicon, 'the favicon is served from public/');
  assert.ok((await stat(path.join(CLIENT, favicon[1]))).isFile(), 'favicon.svg exists');
});

test('every client file honours the strict six-color palette', async () => {
  const files = (await walk(CLIENT)).filter((f) => /\.(css|js|html|svg)$/.test(f));
  assert.ok(files.length >= 5, 'scanned a non-trivial tree');
  for (const file of files) {
    const text = await readText(file);
    for (const match of text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      assert.ok(PALETTE.has(match.toLowerCase()),
        `${path.relative(CLIENT, file)}: ${match} is outside the Archival Iron palette`);
    }
  }
});

test('tokens.css is the single source of truth for the palette', async () => {
  const tokensPath = path.join(CSS_DIR, 'tokens.css');
  assert.ok((await stat(tokensPath)).isFile(), 'client/src/css/tokens.css exists');
  const tokens = await readText(tokensPath);

  // The canonical palette is declared as the six --palette-* tokens.
  const paletteValues = new Set(
    [...tokens.matchAll(/--palette-(\w+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[2].toLowerCase()),
  );
  assert.deepEqual([...paletteValues].sort(), [...PALETTE].sort(),
    'tokens.css declares exactly the six canonical palette values');

  // SINGLE SOURCE for every file that CAN consume custom properties:
  // no other .css/.js file in the tree may hold a hex literal.
  for (const file of await walk(CLIENT)) {
    if (!/\.(css|js)$/.test(file) || file === tokensPath) continue;
    const text = await readText(file);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(text),
      `${path.relative(CLIENT, file)}: css/js files consume tokens, never literals`);
  }

  // Standalone-rendered assets CANNOT inherit :root custom properties
  // (a favicon is parsed without the document; a meta tag is not CSS).
  // They may hold literals, but each one must be byte-identical to a
  // token value — so editing tokens.css without them FAILS here (drift).
  const html = await readText(INDEX);
  const theme = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})">/);
  assert.ok(theme, 'index.html pins the browser chrome colour');
  assert.ok(paletteValues.has(theme[1].toLowerCase()),
    `theme-color ${theme[1]} must equal a tokens.css palette value`);

  const favicon = await readText(path.join(PUBLIC_DIR, 'favicon.svg'));
  const faviconColors = favicon.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  assert.ok(faviconColors.length > 0, 'the favicon carries its palette colours');
  for (const colour of faviconColors) {
    assert.ok(paletteValues.has(colour.toLowerCase()),
      `favicon ${colour} must equal a tokens.css palette value`);
  }

  // Every semantic alias references a palette token (no stray literals).
  for (const [, name, ref] of tokens.matchAll(/--(bg|surface|muted|gold|rust|text):\s*var\((--palette-\w+)\)/g)) {
    assert.ok(ref.startsWith('--palette-'), `--${name} references a palette token`);
  }
});

test('main.css imports tokens.css and defines no colour of its own', async () => {
  const main = await readText(path.join(CSS_DIR, 'main.css'));
  assert.match(main, /@import\s+"\.\/tokens\.css";/, 'main.css imports the token sheet');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(main), 'main.css holds no hex literal of its own');
});

test('every var() reference resolves to a declared token', async () => {
  // Declarations are merged across every :root sheet (tokens.css owns
  // the palette, typography.css owns the font stacks).
  const cssFiles = (await walk(CSS_DIR)).filter((f) => f.endsWith('.css'));
  const declared = new Set();
  for (const file of cssFiles) {
    for (const [, name] of (await readText(file)).matchAll(/(--[\w-]+)\s*:/g)) {
      declared.add(name);
    }
  }

  const referencing = [
    ...cssFiles,
    ...(await walk(PUBLIC_DIR)).filter((f) => /\.(svg|css)$/.test(f)),
  ];
  for (const file of referencing) {
    const text = await readText(file);
    for (const [, name] of text.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(declared.has(name),
        `${path.relative(CLIENT, file)}: ${name} is not declared in the css token sheets`);
    }
  }
});

test('the JS is framework-free ES6+ over native fetch', async () => {
  const files = (await walk(JS_DIR)).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const text = await readText(file);
    const rel = path.relative(CLIENT, file);
    assert.ok(/\b(import|export)\b/.test(text), `${rel} uses ES modules`);
    assert.ok(!/\brequire\s*\(/.test(text), `${rel} has no CommonJS require()`);
    assert.ok(!/module\.exports/.test(text), `${rel} has no CommonJS exports`);
    for (const banned of ['react', 'vue', 'tailwind', 'jquery', 'axios']) {
      assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(text), `${rel} never mentions ${banned}`);
    }
    assert.ok(!/QLOO_API_KEY|api\.qloo\.com/i.test(text),
      `${rel} holds no upstream key or URL (all traffic goes through the local gateway)`);
  }
  const api = await readText(path.join(JS_DIR, 'api.js'));
  assert.ok(/\bfetch\s*\(/.test(api), 'api.js calls native fetch()');
  assert.match(api, /['"]\/api['"]/, 'api.js targets the local /api base only');
});

test('every client JS file parses as a real ES module', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'suto-client-'));
  try {
    for (const file of (await readdir(JS_DIR)).filter((f) => f.endsWith('.js'))) {
      const probe = path.join(tmp, file.replace(/\.js$/, '.mjs'));
      await copyFile(path.join(JS_DIR, file), probe);
      const result = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${file} passes node --check: ${result.stderr}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('zero emojis anywhere in the client tree', async () => {
  for (const file of await walk(CLIENT)) {
    const text = await readText(file);
    assert.ok(!/\p{Extended_Pictographic}/u.test(text),
      `${path.relative(CLIENT, file)} contains an emoji`);
  }
});

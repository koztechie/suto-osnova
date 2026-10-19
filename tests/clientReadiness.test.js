/**
 * Client readiness gate (task 159) — pins 100% readiness of the
 * client interface as ONE aggregated contract:
 *
 *   - MODULE GRAPH: every file under client/src/js is REACHABLE from
 *     main.js (a breadth-first walk over the import graph) — no dead
 *     modules, no orphan code ships;
 *   - ID CROSS-CONTRACT: every getElementById('...') target a module
 *     touches EXISTS in index.html — a typo between the markup and
 *     any module fails here, not at runtime in front of a judge;
 *   - ZERO READINESS BLOCKERS: no TODO/FIXME/XXX/HACK markers in the
 *     client sources — unfinished work cannot hide behind a green
 *     suite;
 *   - SHEET + ASSET INVENTORY: main.css imports exactly the four
 *     token/type/safe-area/card sheets, and every local reference of
 *     the markup (icons, social card) plus the whole public/ manifest
 *     resolves to a real file.
 *
 * The live-boot evidence (full interface in real Chromium, zero
 * console errors, Lighthouse 1.0/1.0/1.0) is recorded in PLAN_STATE
 * with task 157; this gate is the CI-side structural proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const JS_DIR = path.join(CLIENT, 'src', 'js');
const CSS_DIR = path.join(CLIENT, 'src', 'css');

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const jsFiles = (await readdir(JS_DIR)).filter((f) => f.endsWith('.js'));

const readJs = (file) => readFile(path.join(JS_DIR, file), 'utf8');

test('module graph: every module is reachable from main.js', async () => {
  const imports = new Map();
  for (const file of jsFiles) {
    const source = await readJs(file);
    imports.set(file, [...source.matchAll(/from '\.\/([\w.]+)'/g)].map((m) => m[1]));
  }

  const reachable = new Set();
  const queue = ['main.js'];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const dependency of imports.get(file) ?? []) queue.push(dependency);
  }

  assert.deepEqual([...reachable].sort(), [...jsFiles].sort(),
    'no dead modules: every shipped module hangs off the entry point');
});

test('id cross-contract: every getElementById target exists in the markup', async () => {
  const missing = [];
  for (const file of jsFiles) {
    const source = await readJs(file);
    for (const [, id] of source.matchAll(/getElementById\('([^']+)'\)/g)) {
      if (!html.includes(`id="${id}"`)) missing.push(`${file} -> #${id}`);
    }
  }
  assert.deepEqual(missing, [],
    'every id a module touches exists in index.html (no runtime typos)');
});

test('zero readiness blockers in the client sources', async () => {
  const blockers = [];
  const scan = (file, text) => {
    for (const [, marker] of text.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) {
      blockers.push(`${file}: ${marker}`);
    }
  };
  for (const file of jsFiles) scan(`src/js/${file}`, await readJs(file));
  for (const file of (await readdir(CSS_DIR)).filter((f) => f.endsWith('.css'))) {
    scan(`src/css/${file}`, await readFile(path.join(CSS_DIR, file), 'utf8'));
  }
  scan('index.html', html);
  assert.deepEqual(blockers, [], 'unfinished work cannot hide behind a green suite');
});

test('sheet + asset inventory: everything the markup references exists', async () => {
  // The stylesheet imports exactly the four documented sheets.
  const mainCss = await readFile(path.join(CSS_DIR, 'main.css'), 'utf8');
  const sheets = [...mainCss.matchAll(/@import\s+"\.\/([\w-]+\.css)"/g)].map((m) => m[1]);
  assert.deepEqual(sheets.sort(), ['cards.css', 'safe-area.css', 'tokens.css', 'typography.css'],
    'main.css imports exactly the four sheets');
  for (const sheet of sheets) {
    assert.ok((await stat(path.join(CSS_DIR, sheet))).isFile(), `${sheet} exists`);
  }

  // Every local reference of the markup resolves.
  const references = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(references.length >= 4, 'the markup references its local assets');
  for (const reference of references) {
    assert.ok((await stat(path.join(CLIENT, reference))).isFile(),
      `${reference} resolves to a real file`);
  }
  // The OpenGraph image too (a relative reference inside a meta tag).
  const ogImage = html.match(/property="og:image" content="(\.\/[^"]+)"/)?.[1];
  assert.ok(ogImage, 'the og:image reference exists');
  assert.ok((await stat(path.join(CLIENT, ogImage))).isFile(), 'and resolves');

  // The public manifest is complete.
  for (const asset of ['favicon.svg', 'favicon.ico', 'social-card.png', 'robots.txt']) {
    assert.ok((await stat(path.join(CLIENT, 'public', asset))).isFile(),
      `public/${asset} ships`);
  }
});

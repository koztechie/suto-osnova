/**
 * Domain cards gate (task 138) — pins the cultural domain plates:
 *
 *   - THE CARD CONTRACT (the task's literal spec): background exactly
 *     var(--surface) — an OPAQUE palette token, never a color-mix with
 *     alpha; border exactly 1px solid var(--muted) (the full muted
 *     frame, deliberately stronger than the panels' --line);
 *   - TEXT TOKENS: the name in the primary tone, the entity types in
 *     the lifted secondary tone (the task-128 family holds);
 *   - RESPONSIVE GRID: auto-fill minmax columns (2..5 plates adapt
 *     with the viewport); the section spans BOTH workspace columns;
 *   - REAL CONTENT: cards derive from the actual /api/categories
 *     fields (label + the Qloo entity types queried per domain,
 *     urn:entity: prefixes stripped for display) — nothing fabricated;
 *   - HONEST DEGRADE: the section SHIPS HIDDEN and a failed/empty
 *     probe leaves it hidden (the workspace is never blocked);
 *   - XSS-SAFE + WIRED: createElement/textContent only, main.js starts
 *     it, main.css imports cards.css.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { formatEntityType, renderDomains, startDomainCards } = await import(
  path.join(CLIENT, 'src', 'js', 'domainCards.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const cardsCssPath = path.join(CLIENT, 'src', 'css', 'cards.css');
const cardsCss = (await readFile(cardsCssPath, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const mainCss = await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8');

const rule = (css, selector) =>
  css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? null;

/** Minimal DOM double. */
function fakeDom() {
  const make = (tag) => ({
    tag, id: '', className: '', textContent: '', children: [], attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    appendChild(child) { this.children.push(child); },
  });
  const grid = make('ul');
  grid.id = 'domain-grid';
  const section = make('section');
  section.id = 'domains';
  section.attrs.set('hidden', '');
  const doc = {
    getElementById: (id) => ({ 'domain-grid': grid, domains: section }[id] ?? null),
    createElement: (tag) => make(tag),
  };
  return { doc, grid, section };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the card contract: opaque surface background, full muted frame', () => {
  const card = rule(cardsCss, '\\.domain-card');
  assert.ok(card, 'the .domain-card rule exists');

  const background = card.match(/background:\s*([^;]+);/)[1].trim();
  assert.equal(background, 'var(--surface)',
    'the background is EXACTLY the opaque --surface token');
  assert.ok(!/color-mix|transparent|rgb|#[0-9a-fA-F]/i.test(background),
    'no alpha, no mix, no literal — opaque by construction');

  const border = card.match(/border:\s*([^;]+);/)[1].trim();
  assert.equal(border, '1px solid var(--muted)',
    'the frame is EXACTLY 1px solid var(--muted) (the task spec)');
});

test('card text tokens and the responsive plate grid', () => {
  const name = rule(cardsCss, '\\.domain-card-name');
  assert.match(name, /color:\s*var\(--text\);/, 'the name is the primary tone (13.82:1 on the card)');
  const types = rule(cardsCss, '\\.domain-card-types');
  assert.match(types, /color:\s*var\(--muted-hi\);/,
    'the entity types are the lifted secondary tone (6.77:1 — task-128 family)');

  const grid = rule(cardsCss, '\\.domain-grid');
  assert.match(grid, /display:\s*grid;/, 'the plate grid is a grid');
  assert.match(grid, /grid-template-columns:\s*repeat\(auto-fill, minmax\([^)]*\)\);/,
    'columns auto-fill with the viewport (2..5 plates adapt)');
  assert.match(grid, /list-style:\s*none;/, 'the plates are not a bullet list');

  const section = rule(cardsCss, '\\.domains');
  assert.match(section, /grid-column:\s*1 \/ -1;/,
    'the section spans BOTH workspace columns');
  assert.match(mainCss, /@import\s+"\.\/cards\.css";/, 'main.css imports the sheet');
});

test('markup: a named section, hidden at rest, with the grid node', () => {
  const section = html.match(/<section id="domains" class="domains" aria-labelledby="domains-heading" hidden>/);
  assert.ok(section, 'the domains section exists, named and HIDDEN at rest');
  assert.match(html, /<h2 id="domains-heading" class="section-heading">Cultural domains<\/h2>/,
    'the section heading exists');
  assert.match(html,
    /<ul id="domain-grid" class="domain-grid" aria-label="Qloo cultural domains"><\/ul>/,
    'the grid node exists');
});

test('content derives from the real category fields', () => {
  assert.equal(formatEntityType('urn:entity:artist'), 'artist', 'the urn prefix strips');
  assert.equal(formatEntityType('album'), 'album', 'plain values pass through');
  assert.equal(formatEntityType(null), '', 'garbage renders as empty, never a throw');

  const { doc, grid } = fakeDom();
  renderDomains(
    [{ id: 'music', label: 'Music', searchTypes: ['urn:entity:artist', 'album'] }],
    grid, doc,
  );
  assert.equal(grid.children.length, 1, 'one card per category');
  const [card] = grid.children;
  assert.equal(card.className, 'domain-card');
  const [name, types] = card.children;
  assert.equal(name.textContent, 'Music', 'the card carries the real label');
  assert.equal(types.textContent, 'artist · album',
    'and the REAL queried entity types, urn prefixes stripped');
});

test('behaviour: a failed probe leaves the section hidden; wiring intact', async () => {
  const { doc, grid, section } = fakeDom();
  const stop = startDomainCards({
    doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.equal(grid.children.length, 0, 'no cards without data');
  assert.ok(section.attrs.has('hidden'), 'the section stays hidden');
  stop();

  const ok = fakeDom();
  const stopOk = startDomainCards({
    doc: ok.doc,
    fetchImpl: async () => ({
      categories: [{ id: 'film', label: 'Film', searchTypes: ['urn:entity:movie'] }],
    }),
  });
  await tick();
  assert.equal(ok.grid.children.length, 1, 'a successful probe renders');
  assert.ok(!ok.section.attrs.has('hidden'), 'and reveals the section');
  stopOk();

  // An EMPTY registry also degrades (never an empty revealed grid).
  const empty = fakeDom();
  startDomainCards({ doc: empty.doc, fetchImpl: async () => ({ categories: [] }) });
  await tick();
  assert.ok(empty.section.attrs.has('hidden'), 'an empty registry stays hidden');

  const source = await readFile(path.join(CLIENT, 'src', 'js', 'domainCards.js'), 'utf8');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startDomainCards\(\)/, 'main.js starts it on boot');
});

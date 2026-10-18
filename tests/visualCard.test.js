/**
 * Visual Chiaroscuro card gate (task 143) — pins the featured
 * cinematography/art-styles plate:
 *
 *   - MARKUP: the article exists inside the domains zone, HIDDEN at
 *     rest, carrying the exact title and the TWO named groups with
 *     their list nodes; the subtitle frames the content as CURATED
 *     REFERENCES (never Qloo results);
 *   - CURATED CANON: at least three entries per column, all non-empty
 *     and emoji-free, no duplicates ACROSS the columns;
 *   - DATA-GROUNDED GATING (fake DOM): the card reveals ONLY when the
 *     registry confirms the film domain queries the MOVIE entity (the
 *     live-verified direct subtype mapping — no genre family); a film
 *     category without the movie type, a missing film category, an
 *     empty payload or a failed probe all leave the card HIDDEN;
 *   - RENDERING: one .visual-item per entry via createElement/
 *     textContent only (XSS-safe);
 *   - STYLE + WIRING: the plate spans the grid; items keep the primary
 *     tone in the mono instrument stack (labels, not reading text);
 *     zero innerHTML; main.js starts it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  VISUAL_CINEMATOGRAPHY, VISUAL_STYLES, filmQueriesVisual, startVisualCard,
} = await import(path.join(CLIENT, 'src', 'js', 'visualCard.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'visualCard.js'), 'utf8');
const cardsCss = (await readFile(path.join(CLIENT, 'src', 'css', 'cards.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal DOM double with an id map. */
function fakeDom(ids) {
  const make = (tag) => ({
    tag, className: '', textContent: '', children: [], attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    appendChild(child) { this.children.push(child); },
  });
  const nodes = {};
  for (const id of ids) { nodes[id] = make('div'); nodes[id].attrs.set('hidden', ''); }
  return { doc: { getElementById: (id) => nodes[id] ?? null, createElement: (tag) => make(tag) }, nodes };
}

const FILM_FULL = {
  id: 'film', label: 'Film & TV',
  searchTypes: ['urn:entity:movie', 'urn:entity:tv_show'],
};
const FILM_NO_MOVIE = {
  id: 'film', label: 'Film & TV',
  searchTypes: ['urn:entity:tv_show'],
};

test('markup: the featured plate exists, hidden, with two named groups', () => {
  const article = html.match(/<article id="visual-card" class="domain-card visual-card" hidden>/);
  assert.ok(article, 'the visual card exists inside the domains zone, hidden at rest');
  assert.match(html, /<span class="visual-title">Visual Chiaroscuro<\/span>/, 'the exact title');
  assert.match(html, /Cinematography, art styles — curated references/,
    'the subtitle frames CURATED REFERENCES (never fabricated results)');
  for (const [group, listId] of [
    ['Cinematography', 'visual-cinematography'],
    ['Art styles', 'visual-styles'],
  ]) {
    assert.match(html, new RegExp(`<span class="visual-group-title">${group}</span>`),
      `the ${group} group`);
    assert.match(html, new RegExp(`<ul id="${listId}" class="visual-list"><\\/ul>`),
      `the ${group} list node`);
  }
});

test('curated canon: two columns, non-empty, emoji-free, no duplicates', () => {
  const columns = [VISUAL_CINEMATOGRAPHY, VISUAL_STYLES];
  for (const entries of columns) {
    assert.ok(entries.length >= 3, 'at least three entries per column');
    for (const entry of entries) {
      assert.ok(typeof entry === 'string' && entry.trim().length > 0, 'a non-empty entry');
      assert.ok(!/\p{Extended_Pictographic}/u.test(entry), 'no emoji in the canon');
    }
  }
  const all = columns.flat();
  assert.equal(new Set(all).size, all.length, 'no duplicates across the columns');
});

test('data-grounded gating: the movie entity confirmed by the registry', () => {
  assert.equal(filmQueriesVisual([FILM_FULL]), true,
    'film querying the movie entity confirms');
  assert.equal(filmQueriesVisual([FILM_NO_MOVIE]), false,
    'a tv_show-only film category does NOT confirm the movie column');
  assert.equal(filmQueriesVisual([{ id: 'music', searchTypes: ['urn:entity:artist'] }]), false,
    'no film category -> no confirmation');
  assert.equal(filmQueriesVisual([]), false, 'empty registry -> no confirmation');
  assert.equal(filmQueriesVisual(null), false, 'garbage -> no confirmation');
});

test('behaviour: reveal only on confirmation; degrade to hidden', async () => {
  const ids = ['visual-card', 'visual-cinematography', 'visual-styles'];
  const ok = fakeDom(ids);
  startVisualCard({ doc: ok.doc, fetchImpl: async () => ({ categories: [FILM_FULL] }) });
  await tick();
  assert.ok(!ok.nodes['visual-card'].attrs.has('hidden'), 'the card reveals');
  assert.equal(ok.nodes['visual-cinematography'].children.length, VISUAL_CINEMATOGRAPHY.length,
    'one item per technique');
  assert.equal(
    ok.nodes['visual-cinematography'].children[0].textContent,
    VISUAL_CINEMATOGRAPHY[0],
    'techniques render as their names',
  );
  assert.equal(ok.nodes['visual-styles'].children.length, VISUAL_STYLES.length,
    'one item per art style');

  for (const [name, payload] of [
    ['film without the movie type', { categories: [FILM_NO_MOVIE] }],
    ['no film category', { categories: [{ id: 'dining', searchTypes: ['urn:entity:place'] }] }],
    ['empty registry', { categories: [] }],
    ['empty payload', {}],
  ]) {
    const hidden = fakeDom(ids);
    startVisualCard({ doc: hidden.doc, fetchImpl: async () => payload });
    await tick();
    assert.ok(hidden.nodes['visual-card'].attrs.has('hidden'), `${name}: stays hidden`);
  }

  const failed = fakeDom(ids);
  startVisualCard({
    doc: failed.doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.ok(failed.nodes['visual-card'].attrs.has('hidden'), 'a failed probe: stays hidden');
});

test('style and wiring: lifted tokens, mono labels, wired on boot', () => {
  const card = cardsCss.match(/\.visual-card\s*\{[^}]*\}/)[0];
  assert.match(card, /grid-column:\s*1 \/ -1;/, 'the plate spans the grid');
  const title = cardsCss.match(/\.visual-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--gold-hi\);/, 'the title uses the lifted gold');
  const item = cardsCss.match(/\.visual-item\s*\{[^}]*\}/)[0];
  assert.match(item, /color:\s*var\(--text\);/,
    'entries are the primary tone (13.82:1 on the card)');
  assert.ok(!/font-family/.test(item),
    'labels keep the inherited mono instrument stack (not reading text)');
  const groupTitle = cardsCss.match(/\.visual-group-title\s*\{[^}]*\}/)[0];
  assert.match(groupTitle, /color:\s*var\(--muted-hi\);/,
    'group titles are the lifted secondary tone (6.77:1)');

  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startVisualCard\(\)/, 'main.js starts it on boot');
});

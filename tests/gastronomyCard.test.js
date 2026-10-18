/**
 * Gastronomic Topology card gate (task 142) — pins the featured
 * drinks/venues/atmosphere plate:
 *
 *   - MARKUP: the article exists inside the domains zone, HIDDEN at
 *     rest, carrying the exact title and the THREE named groups with
 *     their list nodes; the subtitle frames the content as CURATED
 *     REFERENCES (never Qloo results);
 *   - CURATED CANON: at least three entries per column, all non-empty
 *     and emoji-free, no duplicates ACROSS the columns;
 *   - DATA-GROUNDED GATING (fake DOM): the card reveals ONLY when the
 *     registry confirms the dining domain queries PLACES under the
 *     RESTAURANT GENRE FAMILY (the live-verified contract — a place is
 *     dining only when it carries a restaurant tag family); place
 *     queries without the family, a different family, missing dining,
 *     empty payloads and failed probes all leave the card HIDDEN;
 *   - RENDERING: one .gastronomy-item per entry via createElement/
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
  GASTRONOMY_DRINKS, GASTRONOMY_VENUES, GASTRONOMY_ATMOSPHERE,
  diningQueriesTopology, startGastronomyCard,
} = await import(path.join(CLIENT, 'src', 'js', 'gastronomyCard.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'gastronomyCard.js'), 'utf8');
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

const DINING_FULL = {
  id: 'dining', label: 'Dining & Restaurants',
  searchTypes: ['urn:entity:place'],
  tagFamilies: ['urn:tag:genre:place:restaurant'],
};
const DINING_NO_GENRE = {
  id: 'dining', label: 'Dining & Restaurants',
  searchTypes: ['urn:entity:place'],
  tagFamilies: [],
};

test('markup: the featured plate exists, hidden, with three named groups', () => {
  const article = html.match(/<article id="gastronomy-card" class="domain-card gastronomy-card" hidden>/);
  assert.ok(article, 'the gastronomy card exists inside the domains zone, hidden at rest');
  assert.match(html, /<span class="gastronomy-title">Gastronomic Topology<\/span>/,
    'the exact title');
  assert.match(html, /Drinks, venues, atmosphere — curated references/,
    'the subtitle frames CURATED REFERENCES (never fabricated results)');
  for (const [group, listId] of [
    ['Drinks', 'gastronomy-drinks'],
    ['Venues', 'gastronomy-venues'],
    ['Atmosphere', 'gastronomy-atmosphere'],
  ]) {
    assert.match(html, new RegExp(`<span class="gastronomy-group-title">${group}</span>`),
      `the ${group} group`);
    assert.match(html, new RegExp(`<ul id="${listId}" class="gastronomy-list"><\\/ul>`),
      `the ${group} list node`);
  }
});

test('curated canon: three columns, non-empty, emoji-free, no duplicates', () => {
  const columns = [GASTRONOMY_DRINKS, GASTRONOMY_VENUES, GASTRONOMY_ATMOSPHERE];
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

test('data-grounded gating: place + restaurant genre family confirmed', () => {
  assert.equal(diningQueriesTopology([DINING_FULL]), true,
    'place queries under the restaurant genre family confirm');
  assert.equal(diningQueriesTopology([DINING_NO_GENRE]), false,
    'place queries WITHOUT the genre family do NOT confirm');
  assert.equal(diningQueriesTopology([{
    id: 'dining', searchTypes: ['urn:entity:place'], tagFamilies: ['urn:tag:genre:place:park'],
  }]), false, 'a different genre family does NOT confirm');
  assert.equal(diningQueriesTopology([{ id: 'music', searchTypes: ['urn:entity:artist'] }]), false,
    'no dining category -> no confirmation');
  assert.equal(diningQueriesTopology([]), false, 'empty registry -> no confirmation');
  assert.equal(diningQueriesTopology(null), false, 'garbage -> no confirmation');
});

test('behaviour: reveal only on confirmation; degrade to hidden', async () => {
  const ids = ['gastronomy-card', 'gastronomy-drinks', 'gastronomy-venues', 'gastronomy-atmosphere'];
  const ok = fakeDom(ids);
  startGastronomyCard({ doc: ok.doc, fetchImpl: async () => ({ categories: [DINING_FULL] }) });
  await tick();
  assert.ok(!ok.nodes['gastronomy-card'].attrs.has('hidden'), 'the card reveals');
  assert.equal(ok.nodes['gastronomy-drinks'].children.length, GASTRONOMY_DRINKS.length,
    'one item per drink');
  assert.equal(ok.nodes['gastronomy-drinks'].children[0].textContent, GASTRONOMY_DRINKS[0],
    'drinks render as their names');
  assert.equal(ok.nodes['gastronomy-venues'].children.length, GASTRONOMY_VENUES.length,
    'one item per venue');
  assert.equal(ok.nodes['gastronomy-atmosphere'].children.length, GASTRONOMY_ATMOSPHERE.length,
    'one item per atmosphere anchor');

  for (const [name, payload] of [
    ['dining without the genre family', { categories: [DINING_NO_GENRE] }],
    ['no dining category', { categories: [{ id: 'film', searchTypes: ['urn:entity:movie'] }] }],
    ['empty registry', { categories: [] }],
    ['empty payload', {}],
  ]) {
    const hidden = fakeDom(ids);
    startGastronomyCard({ doc: hidden.doc, fetchImpl: async () => payload });
    await tick();
    assert.ok(hidden.nodes['gastronomy-card'].attrs.has('hidden'), `${name}: stays hidden`);
  }

  const failed = fakeDom(ids);
  startGastronomyCard({
    doc: failed.doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.ok(failed.nodes['gastronomy-card'].attrs.has('hidden'), 'a failed probe: stays hidden');
});

test('style and wiring: lifted tokens, mono labels, wired on boot', () => {
  const card = cardsCss.match(/\.gastronomy-card\s*\{[^}]*\}/)[0];
  assert.match(card, /grid-column:\s*1 \/ -1;/, 'the plate spans the grid');
  const title = cardsCss.match(/\.gastronomy-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--gold-hi\);/, 'the title uses the lifted gold');
  const item = cardsCss.match(/\.gastronomy-item\s*\{[^}]*\}/)[0];
  assert.match(item, /color:\s*var\(--text\);/,
    'entries are the primary tone (13.82:1 on the card)');
  assert.ok(!/font-family/.test(item),
    'labels keep the inherited mono instrument stack (not reading text)');
  const groupTitle = cardsCss.match(/\.gastronomy-group-title\s*\{[^}]*\}/)[0];
  assert.match(groupTitle, /color:\s*var\(--muted-hi\);/,
    'group titles are the lifted secondary tone (6.77:1)');

  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startGastronomyCard\(\)/, 'main.js starts it on boot');
});

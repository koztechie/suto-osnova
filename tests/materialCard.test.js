/**
 * Material Culture & Form card gate (task 141) — pins the featured
 * fashion/texture/architecture plate:
 *
 *   - MARKUP: the article exists inside the domains zone, HIDDEN at
 *     rest, carrying the exact title and the THREE named groups with
 *     their list nodes; the subtitle frames the content as CURATED
 *     REFERENCES (never Qloo results);
 *   - CURATED CANON: at least three entries per column, all non-empty
 *     and emoji-free, no duplicates ACROSS the columns;
 *   - DATA-GROUNDED GATING (fake DOM): the card reveals ONLY when the
 *     registry confirms the fashion domain queries BRANDS under the
 *     FASHION GENRE FAMILY (the live-verified contract — a brand is
 *     fashion only under urn:tag:genre:brand:fashion); brand queries
 *     without the genre family, missing fashion, empty payloads and
 *     failed probes all leave the card HIDDEN;
 *   - RENDERING: one .material-item per entry via createElement/
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
  MATERIAL_DESIGNERS, MATERIAL_TEXTURES, MATERIAL_MOVEMENTS,
  fashionQueriesForm, startMaterialCard,
} = await import(path.join(CLIENT, 'src', 'js', 'materialCard.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'materialCard.js'), 'utf8');
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

const FASHION_FULL = {
  id: 'fashion', label: 'Fashion & Brands',
  searchTypes: ['urn:entity:brand'],
  tagFamilies: ['urn:tag:genre:brand:fashion'],
};
const FASHION_NO_GENRE = {
  id: 'fashion', label: 'Fashion & Brands',
  searchTypes: ['urn:entity:brand'],
  tagFamilies: [],
};

test('markup: the featured plate exists, hidden, with three named groups', () => {
  const article = html.match(/<article id="material-card" class="domain-card material-card" hidden>/);
  assert.ok(article, 'the material card exists inside the domains zone, hidden at rest');
  assert.match(html, /<span class="material-title">Material Culture &amp; Form<\/span>/,
    'the exact title');
  assert.match(html, /Fashion, textures, architecture — curated references/,
    'the subtitle frames CURATED REFERENCES (never fabricated results)');
  for (const [group, listId] of [
    ['Designers', 'material-designers'],
    ['Textures', 'material-textures'],
    ['Architecture', 'material-movements'],
  ]) {
    assert.match(html, new RegExp(`<span class="material-group-title">${group}</span>`),
      `the ${group} group`);
    assert.match(html, new RegExp(`<ul id="${listId}" class="material-list"><\\/ul>`),
      `the ${group} list node`);
  }
});

test('curated canon: three columns, non-empty, emoji-free, no duplicates', () => {
  const columns = [MATERIAL_DESIGNERS, MATERIAL_TEXTURES, MATERIAL_MOVEMENTS];
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

test('data-grounded gating: brand + fashion genre family confirmed', () => {
  assert.equal(fashionQueriesForm([FASHION_FULL]), true,
    'brand queries under the fashion genre family confirm');
  assert.equal(fashionQueriesForm([FASHION_NO_GENRE]), false,
    'brand queries WITHOUT the genre family do NOT confirm');
  assert.equal(fashionQueriesForm([{
    id: 'fashion', searchTypes: ['urn:entity:brand'], tagFamilies: ['urn:tag:genre:brand:service'],
  }]), false, 'a different genre family does NOT confirm');
  assert.equal(fashionQueriesForm([{ id: 'music', searchTypes: ['urn:entity:artist'] }]), false,
    'no fashion category -> no confirmation');
  assert.equal(fashionQueriesForm([]), false, 'empty registry -> no confirmation');
  assert.equal(fashionQueriesForm(null), false, 'garbage -> no confirmation');
});

test('behaviour: reveal only on confirmation; degrade to hidden', async () => {
  const ok = fakeDom(['material-card', 'material-designers', 'material-textures', 'material-movements']);
  startMaterialCard({ doc: ok.doc, fetchImpl: async () => ({ categories: [FASHION_FULL] }) });
  await tick();
  assert.ok(!ok.nodes['material-card'].attrs.has('hidden'), 'the card reveals');
  assert.equal(ok.nodes['material-designers'].children.length, MATERIAL_DESIGNERS.length,
    'one item per designer');
  assert.equal(ok.nodes['material-designers'].children[0].textContent, MATERIAL_DESIGNERS[0],
    'designers render as their names');
  assert.equal(ok.nodes['material-textures'].children.length, MATERIAL_TEXTURES.length,
    'one item per texture');
  assert.equal(ok.nodes['material-movements'].children.length, MATERIAL_MOVEMENTS.length,
    'one item per movement');

  for (const [name, payload] of [
    ['fashion without the genre family', { categories: [FASHION_NO_GENRE] }],
    ['no fashion category', { categories: [{ id: 'film', searchTypes: ['urn:entity:movie'] }] }],
    ['empty registry', { categories: [] }],
    ['empty payload', {}],
  ]) {
    const hidden = fakeDom(['material-card', 'material-designers', 'material-textures', 'material-movements']);
    startMaterialCard({ doc: hidden.doc, fetchImpl: async () => payload });
    await tick();
    assert.ok(hidden.nodes['material-card'].attrs.has('hidden'), `${name}: stays hidden`);
  }

  const failed = fakeDom(['material-card', 'material-designers', 'material-textures', 'material-movements']);
  startMaterialCard({
    doc: failed.doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.ok(failed.nodes['material-card'].attrs.has('hidden'), 'a failed probe: stays hidden');
});

test('style and wiring: lifted tokens, mono labels, wired on boot', () => {
  const card = cardsCss.match(/\.material-card\s*\{[^}]*\}/)[0];
  assert.match(card, /grid-column:\s*1 \/ -1;/, 'the plate spans the grid');
  const title = cardsCss.match(/\.material-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--gold-hi\);/, 'the title uses the lifted gold');
  const item = cardsCss.match(/\.material-item\s*\{[^}]*\}/)[0];
  assert.match(item, /color:\s*var\(--text\);/,
    'entries are the primary tone (13.82:1 on the card)');
  assert.ok(!/font-family/.test(item),
    'labels keep the inherited mono instrument stack (not reading text)');
  const groupTitle = cardsCss.match(/\.material-group-title\s*\{[^}]*\}/)[0];
  assert.match(groupTitle, /color:\s*var\(--muted-hi\);/,
    'group titles are the lifted secondary tone (6.77:1)');

  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startMaterialCard\(\)/, 'main.js starts it on boot');
});

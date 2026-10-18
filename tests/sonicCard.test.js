/**
 * Sonic Architecture card gate (task 139) — pins the featured
 * music & ambient plate showing ARTISTS and ALBUMS:
 *
 *   - MARKUP: the article exists inside the domains zone, HIDDEN at
 *     rest, carrying the exact title and the two named groups with
 *     their list nodes; the subtitle frames the content as CURATED
 *     ANCHORS (never "results" or popularity claims);
 *   - CURATED CANON: the artist/album constants are non-empty, emoji-
 *     free strings; albums pair a title with its artist;
 *   - DATA-GROUNDED GATING (fake DOM): the card reveals ONLY when the
 *     /api/categories registry confirms the music domain queries BOTH
 *     artist and album entities; a music category without both types,
 *     a missing music category, an empty payload or a failed probe all
 *     leave the card HIDDEN;
 *   - RENDERING: artists as names, albums as "title — artist", via
 *     createElement/textContent only (XSS-safe);
 *   - STYLE: the plate spans the grid, uses the lifted gold title
 *     (task-127 family), primary-tone items and lifted secondary meta
 *     on the slate card; main.js starts it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  SONIC_ARTISTS, SONIC_ALBUMS, musicQueriesArtistsAndAlbums, startSonicCard,
} = await import(path.join(CLIENT, 'src', 'js', 'sonicCard.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'sonicCard.js'), 'utf8');
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

const MUSIC_FULL = {
  id: 'music', label: 'Music',
  searchTypes: ['urn:entity:artist', 'urn:entity:album'],
};
const MUSIC_ARTIST_ONLY = { id: 'music', label: 'Music', searchTypes: ['urn:entity:artist'] };

test('markup: the featured plate exists, hidden, with named groups', () => {
  const article = html.match(/<article id="sonic-card" class="domain-card sonic-card" hidden>/);
  assert.ok(article, 'the sonic card exists inside the domains zone, hidden at rest');
  assert.match(html, /<span class="sonic-title">Sonic Architecture<\/span>/,
    'the exact title');
  assert.match(html, /Music &amp; ambient — curated anchors/,
    'the subtitle frames CURATED ANCHORS (never fabricated results)');
  assert.match(html, /<span class="sonic-group-title">Artists<\/span>/, 'the artists group');
  assert.match(html, /<ul id="sonic-artists" class="sonic-list"><\/ul>/, 'the artists list node');
  assert.match(html, /<span class="sonic-group-title">Albums<\/span>/, 'the albums group');
  assert.match(html, /<ul id="sonic-albums" class="sonic-list"><\/ul>/, 'the albums list node');
});

test('curated canon: non-empty, emoji-free artists and album pairs', () => {
  assert.ok(SONIC_ARTISTS.length >= 3, 'at least three artist anchors');
  for (const name of SONIC_ARTISTS) {
    assert.ok(typeof name === 'string' && name.trim().length > 0, 'a non-empty artist');
    assert.ok(!/\p{Extended_Pictographic}/u.test(name), 'no emoji in the canon');
  }
  assert.ok(SONIC_ALBUMS.length >= 3, 'at least three album anchors');
  for (const album of SONIC_ALBUMS) {
    assert.ok(album.title?.trim(), 'the album has a title');
    assert.ok(album.artist?.trim(), 'the album names its artist');
    assert.ok(!/\p{Extended_Pictographic}/u.test(`${album.title}${album.artist}`),
      'no emoji in the canon');
  }
});

test('data-grounded gating: artist+album confirmed by the registry', () => {
  assert.equal(musicQueriesArtistsAndAlbums([MUSIC_FULL]), true,
    'music querying artist+album confirms');
  assert.equal(musicQueriesArtistsAndAlbums([MUSIC_ARTIST_ONLY]), false,
    'artist-only does NOT confirm the albums column');
  assert.equal(musicQueriesArtistsAndAlbums([{ id: 'film', searchTypes: ['urn:entity:movie'] }]),
    false, 'no music category -> no confirmation');
  assert.equal(musicQueriesArtistsAndAlbums([]), false, 'empty registry -> no confirmation');
  assert.equal(musicQueriesArtistsAndAlbums(null), false, 'garbage -> no confirmation');
});

test('behaviour: reveal only on confirmation; degrade to hidden', async () => {
  // Confirmed: renders both columns and reveals.
  const ok = fakeDom(['sonic-card', 'sonic-artists', 'sonic-albums']);
  startSonicCard({ doc: ok.doc, fetchImpl: async () => ({ categories: [MUSIC_FULL] }) });
  await tick();
  assert.ok(!ok.nodes['sonic-card'].attrs.has('hidden'), 'the card reveals');
  assert.equal(ok.nodes['sonic-artists'].children.length, SONIC_ARTISTS.length,
    'one item per artist');
  assert.equal(ok.nodes['sonic-artists'].children[0].textContent, SONIC_ARTISTS[0],
    'artists render as their names');
  assert.equal(ok.nodes['sonic-albums'].children.length, SONIC_ALBUMS.length,
    'one item per album');
  const [firstAlbum] = ok.nodes['sonic-albums'].children;
  const [title, meta] = firstAlbum.children;
  assert.equal(title.textContent, SONIC_ALBUMS[0].title, 'the album title');
  assert.equal(meta.textContent, ` — ${SONIC_ALBUMS[0].artist}`,
    'and its artist as the meta line');

  // Every non-confirming path keeps the card hidden.
  for (const [name, payload] of [
    ['artist-only music', { categories: [MUSIC_ARTIST_ONLY] }],
    ['no music category', { categories: [{ id: 'film', searchTypes: ['urn:entity:movie'] }] }],
    ['empty registry', { categories: [] }],
    ['empty payload', {}],
  ]) {
    const hidden = fakeDom(['sonic-card', 'sonic-artists', 'sonic-albums']);
    startSonicCard({ doc: hidden.doc, fetchImpl: async () => payload });
    await tick();
    assert.ok(hidden.nodes['sonic-card'].attrs.has('hidden'), `${name}: stays hidden`);
  }

  const failed = fakeDom(['sonic-card', 'sonic-artists', 'sonic-albums']);
  startSonicCard({
    doc: failed.doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.ok(failed.nodes['sonic-card'].attrs.has('hidden'), 'a failed probe: stays hidden');
});

test('style and wiring: lifted tokens, spans the grid, started on boot', () => {
  const card = cardsCss.match(/\.sonic-card\s*\{[^}]*\}/)[0];
  assert.match(card, /grid-column:\s*1 \/ -1;/, 'the plate spans the grid');
  const title = cardsCss.match(/\.sonic-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--gold-hi\);/,
    'the title uses the LIFTED gold (task-127 family, 8.15:1 on the card)');
  const item = cardsCss.match(/\.sonic-item\s*\{[^}]*\}/)[0];
  assert.match(item, /color:\s*var\(--text\);/, 'items are the primary tone (13.82:1)');
  const meta = cardsCss.match(/\.sonic-item-meta\s*\{[^}]*\}/)[0];
  assert.match(meta, /color:\s*var\(--muted-hi\);/,
    'the artist meta is the lifted secondary tone (6.77:1)');

  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startSonicCard\(\)/, 'main.js starts it on boot');
});

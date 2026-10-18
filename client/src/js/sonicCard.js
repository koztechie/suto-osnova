/**
 * SUTO OSNOVA — the "Sonic Architecture" card (task 139).
 * A FEATURED plate in the cultural-domains zone: music & ambient,
 * showing ARTISTS and ALBUMS as curated starting anchors.
 *
 * Honesty contracts:
 *   - the artist/album SPLIT IS DATA-GROUNDED: the card only reveals
 *     when the LOCAL /api/categories registry confirms the music
 *     domain really queries BOTH entity types (artist + album) — the
 *     presentation mirrors what the agent actually asks Qloo;
 *   - the listed names are CURATED CANON (hand-picked ambient/music
 *     anchors the user can paste as seeds) — framed as "curated
 *     anchors", NEVER presented as Qloo results or popularity claims;
 *   - a failed/empty probe degrades: the card SHIPS HIDDEN and stays
 *     hidden; the workspace is never blocked;
 *   - renders via createElement/textContent only; import-safe in Node.
 */
import { fetchCategories } from './api.js';

/** Curated ARTIST anchors (ambient canon — UI copy, not results). */
export const SONIC_ARTISTS = Object.freeze([
  'Bohren & der Club of Gore',
  'Stars of the Lid',
  'Biosphere',
  'Lustmord',
]);

/** Curated ALBUM anchors: title + its artist (UI copy, not results). */
export const SONIC_ALBUMS = Object.freeze([
  Object.freeze({ title: 'Sunset Mission', artist: 'Bohren & der Club of Gore' }),
  Object.freeze({ title: 'The Tired Sounds Of Stars Of The Lid', artist: 'Stars of the Lid' }),
  Object.freeze({ title: 'Substrata', artist: 'Biosphere' }),
  Object.freeze({ title: 'Heresy', artist: 'Lustmord' }),
]);

/**
 * Pure check: does the registry confirm the music domain queries BOTH
 * artist and album entities?
 */
export function musicQueriesArtistsAndAlbums(categories) {
  if (!Array.isArray(categories)) return false;
  const music = categories.find((category) => category?.id === 'music');
  if (!music || !Array.isArray(music.searchTypes)) return false;
  const types = music.searchTypes.map((type) => String(type).replace(/^urn:entity:/, ''));
  return types.includes('artist') && types.includes('album');
}

/** Pure renderer: fills the artists/albums lists. */
export function renderSonic(card, doc) {
  const artists = doc.getElementById('sonic-artists');
  const albums = doc.getElementById('sonic-albums');
  for (const name of SONIC_ARTISTS) {
    const item = doc.createElement('li');
    item.className = 'sonic-item';
    item.textContent = name;
    artists.appendChild(item);
  }
  for (const album of SONIC_ALBUMS) {
    const item = doc.createElement('li');
    item.className = 'sonic-item';
    const title = doc.createElement('span');
    title.className = 'sonic-item-title';
    title.textContent = album.title;
    const meta = doc.createElement('span');
    meta.className = 'sonic-item-meta';
    meta.textContent = ` — ${album.artist}`;
    item.appendChild(title);
    item.appendChild(meta);
    albums.appendChild(item);
  }
  card.removeAttribute('hidden');
}

/** Wire the card: fetch once; reveal only on registry confirmation. */
export function startSonicCard({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const card = scope.getElementById('sonic-card');
  if (!card) return () => {};

  fetchImpl()
    .then((payload) => {
      if (!musicQueriesArtistsAndAlbums(payload?.categories)) {
        throw new Error('the registry does not confirm artist+album queries');
      }
      renderSonic(card, scope);
    })
    .catch(() => {
      // Degrade honestly: the card stays hidden.
    });

  return () => {};
}

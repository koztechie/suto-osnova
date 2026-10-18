/**
 * SUTO OSNOVA — the "Visual Chiaroscuro" card (task 143).
 * A FEATURED plate in the cultural-domains zone: cinematography
 * techniques and art styles as curated visual anchors.
 *
 * Honesty contracts (mirroring tasks 139-142):
 *   - the film SPLIT IS DATA-GROUNDED: the card only reveals when the
 *     LOCAL /api/categories registry confirms the film domain queries
 *     the movie entity — the live-verified contract (film maps
 *     directly by subtype: movie + tv_show, no genre family);
 *   - the two columns are CURATED REFERENCES (cinematography
 *     techniques, art styles) — hand-picked anchors the user can
 *     paste as seeds, NEVER presented as Qloo results or popularity
 *     data;
 *   - a failed/empty probe degrades: the card SHIPS HIDDEN and stays
 *     hidden; the workspace is never blocked;
 *   - renders via createElement/textContent only; import-safe in Node.
 */
import { fetchCategories } from './api.js';

/** Curated CINEMATOGRAPHY anchors (the technique vocabulary). */
export const VISUAL_CINEMATOGRAPHY = Object.freeze([
  'chiaroscuro lighting',
  'deep focus',
  'long takes',
  'anamorphic lenses',
]);

/** Curated ART STYLE anchors (the movement vocabulary). */
export const VISUAL_STYLES = Object.freeze([
  'German Expressionism',
  'Italian Neorealism',
  'French New Wave',
  'Surrealism',
]);

/**
 * Pure check: does the registry confirm the film domain queries the
 * movie entity (the live-verified direct subtype mapping)?
 */
export function filmQueriesVisual(categories) {
  if (!Array.isArray(categories)) return false;
  const film = categories.find((category) => category?.id === 'film');
  if (!film || !Array.isArray(film.searchTypes)) return false;
  return film.searchTypes.some((type) => String(type).replace(/^urn:entity:/, '') === 'movie');
}

/** Pure renderer: fills the two lists. */
export function renderVisual(card, doc) {
  const columns = [
    ['visual-cinematography', VISUAL_CINEMATOGRAPHY],
    ['visual-styles', VISUAL_STYLES],
  ];
  for (const [id, entries] of columns) {
    const list = doc.getElementById(id);
    for (const entry of entries) {
      const item = doc.createElement('li');
      item.className = 'visual-item';
      item.textContent = entry;
      list.appendChild(item);
    }
  }
  card.removeAttribute('hidden');
}

/** Wire the card: fetch once; reveal only on registry confirmation. */
export function startVisualCard({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const card = scope.getElementById('visual-card');
  if (!card) return () => {};

  fetchImpl()
    .then((payload) => {
      if (!filmQueriesVisual(payload?.categories)) {
        throw new Error('the registry does not confirm film movie queries');
      }
      renderVisual(card, scope);
    })
    .catch(() => {
      // Degrade honestly: the card stays hidden.
    });

  return () => {};
}

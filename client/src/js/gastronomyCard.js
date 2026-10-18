/**
 * SUTO OSNOVA — the "Gastronomic Topology" card (task 142).
 * A FEATURED plate in the cultural-domains zone: drinks, venues and
 * the atmosphere of space as curated gastronomic anchors.
 *
 * Honesty contracts (mirroring tasks 139-141):
 *   - the venue SPLIT IS DATA-GROUNDED: the card only reveals when the
 *     LOCAL /api/categories registry confirms the dining domain
 *     queries PLACES UNDER THE RESTAURANT GENRE FAMILY — the live-
 *     verified contract (a place is dining ONLY when it carries a
 *     restaurant tag family);
 *   - the three columns are CURATED REFERENCES (drinks, venues,
 *     atmosphere) — hand-picked anchors the user can paste as seeds,
 *     NEVER presented as Qloo results or popularity data;
 *   - a failed/empty probe degrades: the card SHIPS HIDDEN and stays
 *     hidden; the workspace is never blocked;
 *   - renders via createElement/textContent only; import-safe in Node.
 */
import { fetchCategories } from './api.js';

/** Curated DRINK anchors (the beverage vocabulary). */
export const GASTRONOMY_DRINKS = Object.freeze([
  'natural wine',
  'single-origin filter coffee',
  'Japanese whisky',
  'smoky mezcal',
]);

/** Curated VENUE anchors (the venue vocabulary). */
export const GASTRONOMY_VENUES = Object.freeze([
  'listening bar',
  'natural wine bar',
  'kissa',
  'covered market',
]);

/** Curated ATMOSPHERE anchors (the spatial vocabulary). */
export const GASTRONOMY_ATMOSPHERE = Object.freeze([
  'candlelight',
  'open kitchen',
  'vinyl sound system',
  'planted courtyard',
]);

/**
 * Pure check: does the registry confirm the dining domain queries
 * places under the restaurant genre family (the live-verified
 * contract)?
 */
export function diningQueriesTopology(categories) {
  if (!Array.isArray(categories)) return false;
  const dining = categories.find((category) => category?.id === 'dining');
  if (!dining || !Array.isArray(dining.searchTypes) || !Array.isArray(dining.tagFamilies)) {
    return false;
  }
  const queriesPlaces = dining.searchTypes
    .some((type) => String(type).replace(/^urn:entity:/, '') === 'place');
  const underRestaurantGenre = dining.tagFamilies
    .some((family) => String(family).endsWith('place:restaurant'));
  return queriesPlaces && underRestaurantGenre;
}

/** Pure renderer: fills the three lists. */
export function renderGastronomy(card, doc) {
  const columns = [
    ['gastronomy-drinks', GASTRONOMY_DRINKS],
    ['gastronomy-venues', GASTRONOMY_VENUES],
    ['gastronomy-atmosphere', GASTRONOMY_ATMOSPHERE],
  ];
  for (const [id, entries] of columns) {
    const list = doc.getElementById(id);
    for (const entry of entries) {
      const item = doc.createElement('li');
      item.className = 'gastronomy-item';
      item.textContent = entry;
      list.appendChild(item);
    }
  }
  card.removeAttribute('hidden');
}

/** Wire the card: fetch once; reveal only on registry confirmation. */
export function startGastronomyCard({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const card = scope.getElementById('gastronomy-card');
  if (!card) return () => {};

  fetchImpl()
    .then((payload) => {
      if (!diningQueriesTopology(payload?.categories)) {
        throw new Error('the registry does not confirm dining place queries');
      }
      renderGastronomy(card, scope);
    })
    .catch(() => {
      // Degrade honestly: the card stays hidden.
    });

  return () => {};
}

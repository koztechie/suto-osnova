/**
 * SUTO OSNOVA — the "Material Culture & Form" card (task 141).
 * A FEATURED plate in the cultural-domains zone: fashion, textures
 * and architecture as curated material/form anchors.
 *
 * Honesty contracts (mirroring tasks 139-140):
 *   - the fashion SPLIT IS DATA-GROUNDED: the card only reveals when
 *     the LOCAL /api/categories registry confirms the fashion domain
 *     queries brands UNDER THE FASHION GENRE FAMILY — the live-
 *     verified contract (a brand is fashion ONLY under
 *     urn:tag:genre:brand:fashion);
 *   - the three columns are CURATED REFERENCES (designers, textures,
 *     architecture movements) — hand-picked anchors the user can
 *     paste as seeds, NEVER presented as Qloo results or popularity
 *     data;
 *   - a failed/empty probe degrades: the card SHIPS HIDDEN and stays
 *     hidden; the workspace is never blocked;
 *   - renders via createElement/textContent only; import-safe in Node.
 */
import { fetchCategories } from './api.js';

/** Curated DESIGNER anchors (fashion canon — UI copy, not results). */
export const MATERIAL_DESIGNERS = Object.freeze([
  'Rei Kawakubo',
  'Yohji Yamamoto',
  'Cristobal Balenciaga',
  'Vivienne Westwood',
]);

/** Curated TEXTURE anchors (the tactile vocabulary). */
export const MATERIAL_TEXTURES = Object.freeze([
  'raw selvedge denim',
  'boiled wool',
  'waxed cotton',
  'raw silk',
]);

/** Curated ARCHITECTURE anchors (form movements). */
export const MATERIAL_MOVEMENTS = Object.freeze([
  'Brutalism',
  'Bauhaus',
  'Deconstructivism',
  'Metabolism',
]);

/**
 * Pure check: does the registry confirm the fashion domain queries
 * brands under the fashion genre family (the live-verified contract)?
 */
export function fashionQueriesForm(categories) {
  if (!Array.isArray(categories)) return false;
  const fashion = categories.find((category) => category?.id === 'fashion');
  if (!fashion || !Array.isArray(fashion.searchTypes) || !Array.isArray(fashion.tagFamilies)) {
    return false;
  }
  const queriesBrands = fashion.searchTypes
    .some((type) => String(type).replace(/^urn:entity:/, '') === 'brand');
  const underFashionGenre = fashion.tagFamilies
    .some((family) => String(family).endsWith('brand:fashion'));
  return queriesBrands && underFashionGenre;
}

/** Pure renderer: fills the three lists. */
export function renderMaterial(card, doc) {
  const columns = [
    ['material-designers', MATERIAL_DESIGNERS],
    ['material-textures', MATERIAL_TEXTURES],
    ['material-movements', MATERIAL_MOVEMENTS],
  ];
  for (const [id, entries] of columns) {
    const list = doc.getElementById(id);
    for (const entry of entries) {
      const item = doc.createElement('li');
      item.className = 'material-item';
      item.textContent = entry;
      list.appendChild(item);
    }
  }
  card.removeAttribute('hidden');
}

/** Wire the card: fetch once; reveal only on registry confirmation. */
export function startMaterialCard({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const card = scope.getElementById('material-card');
  if (!card) return () => {};

  fetchImpl()
    .then((payload) => {
      if (!fashionQueriesForm(payload?.categories)) {
        throw new Error('the registry does not confirm fashion brand queries');
      }
      renderMaterial(card, scope);
    })
    .catch(() => {
      // Degrade honestly: the card stays hidden.
    });

  return () => {};
}

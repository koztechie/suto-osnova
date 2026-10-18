/**
 * SUTO OSNOVA — cultural domain cards (task 138).
 * Populates the domain plate grid from the LOCAL GET /api/categories
 * (the static registry: {id, label, searchTypes, ...}).
 *
 * Honesty contracts:
 *   - the card content DERIVES from the real category fields (the
 *     label + the Qloo entity types actually queried per domain) —
 *     nothing is fabricated;
 *   - a failed/empty probe degrades: the section SHIPS HIDDEN and
 *     stays hidden — the workspace is never blocked or errored;
 *   - writes go through createElement/textContent only (XSS-safe);
 *   - import-safe in Node: no document at load; doc/fetch are injected.
 */
import { fetchCategories } from './api.js';

/** Display form of a Qloo entity type: urn:entity:artist -> artist. */
export function formatEntityType(type) {
  return String(type ?? '').replace(/^urn:entity:/, '');
}

/** Pure renderer: one card per category, into the grid element. */
export function renderDomains(categories, container, doc) {
  container.textContent = '';
  for (const category of categories) {
    const card = doc.createElement('li');
    card.className = 'domain-card';

    const name = doc.createElement('span');
    name.className = 'domain-card-name';
    name.textContent = category.label ?? category.id;

    const types = doc.createElement('span');
    types.className = 'domain-card-types';
    types.textContent = (category.searchTypes ?? [])
      .map(formatEntityType)
      .join(' · ');

    card.appendChild(name);
    card.appendChild(types);
    container.appendChild(card);
  }
}

/** Wire the grid: fetch once, render, reveal; degrade to hidden. */
export function startDomainCards({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const grid = scope.getElementById('domain-grid');
  const section = scope.getElementById('domains');
  if (!grid) return () => {};

  fetchImpl()
    .then((payload) => {
      const categories = payload?.categories ?? [];
      if (categories.length === 0) throw new Error('empty category registry');
      renderDomains(categories, grid, scope);
      section?.removeAttribute('hidden');
    })
    .catch(() => {
      // Degrade honestly: the section stays hidden, nothing breaks.
    });

  return () => {};
}

/**
 * SUTO OSNOVA — anchor input with Qloo category hints (task 134).
 * ARIA combobox over the FREE-TEXT anchor field: the seed stays free
 * text (the resolver classifies it server-side), the hints only teach
 * which Qloo categories exist. Pattern: role="combobox" input + a
 * role="listbox" popup driven by aria-activedescendant (the input
 * keeps DOM focus at all times).
 *
 * Honesty contracts:
 *   - the hint list NEVER dumps unfiltered categories (an empty query
 *     shows nothing);
 *   - a failed /api/categories probe degrades to NO hints — the input
 *     itself is never blocked or errored;
 *   - selecting a hint applies the category's curated EXAMPLE ANCHOR
 *     (UI copy to edit, NOT a data claim) so the user starts from a
 *     seed the resolver can classify;
 *   - writes go through textContent/createElement only (XSS-safe).
 *
 * Import-safe in Node: nothing touches document at load — only inside
 * startAnchorInput(). The filter (filterCategories) is pure and
 * unit-pinned by tests/anchorInput.test.js.
 */
import { fetchCategories } from './api.js';

/** How many hints a query may surface. */
export const SUGGESTION_LIMIT = 6;

/**
 * Curated SEED EXAMPLES per category id — hand-written UI copy that
 * demonstrates the kind of cultural anchor each Qloo domain accepts.
 * Not fabricated data: these are editable suggestions, not claims.
 */
export const EXAMPLE_ANCHORS = Object.freeze({
  music: 'Japanese city pop',
  books: 'New Wave science fiction',
  fashion: 'Brutalist workwear',
  dining: 'Georgian natural wine',
  film: 'A24 psychological horror',
});

/**
 * Pure filter: categories whose id, label or alias contains the query
 * (case-insensitive). An empty/blank query returns [] — the listbox
 * never shows an unfiltered dump. Garbage input returns [].
 */
export function filterCategories(categories, query, limit = SUGGESTION_LIMIT) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !Array.isArray(categories)) return [];
  const out = [];
  for (const category of categories) {
    if (!category || typeof category !== 'object') continue;
    const haystack = [category.id, category.label, ...(category.aliases ?? [])]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    if (haystack.includes(q)) out.push(category);
    if (out.length >= limit) break;
  }
  return out;
}

/** Wire the combobox. Returns a stop() handle (idempotent). */
export function startAnchorInput({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const input = scope.getElementById('seed');
  const list = scope.getElementById('anchor-suggestions');
  if (!input || !list) return () => {};

  let categories = null; // null = not loaded yet (fetch once, lazily)
  let options = []; // the category objects currently rendered
  let active = -1; // the keyboard-highlighted option index

  const close = () => {
    list.hidden = true;
    list.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    options = [];
    active = -1;
  };

  const highlight = (index) => {
    const items = list.querySelectorAll('[role="option"]');
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    active = index;
    if (index >= 0 && items[index]) {
      input.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const applyHint = (category) => {
    input.value = EXAMPLE_ANCHORS[category.id] ?? category.label;
    close();
    input.focus();
  };

  const render = (matches) => {
    options = matches;
    list.textContent = '';
    matches.forEach((category, index) => {
      const option = scope.createElement('li');
      option.className = 'suggestion';
      option.id = `anchor-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = `${category.label} — e.g. ${EXAMPLE_ANCHORS[category.id] ?? category.id}`;
      // mousedown (not click): it fires BEFORE the input's blur.
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applyHint(category);
      });
      list.appendChild(option);
    });
    list.hidden = matches.length === 0;
    input.setAttribute('aria-expanded', String(matches.length > 0));
    highlight(-1);
  };

  const refresh = async () => {
    if (categories === null) {
      try {
        categories = (await fetchImpl()).categories ?? [];
      } catch {
        categories = []; // degrade: no hints, the input is unaffected
      }
    }
    render(filterCategories(categories, input.value));
  };

  const onKeyDown = (event) => {
    if (list.hidden) {
      if (event.key === 'ArrowDown') refresh();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(Math.min(active + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      applyHint(options[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  };

  const onInput = () => { refresh(); };
  const onBlur = () => { close(); };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);

  return () => {
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    close();
  };
}

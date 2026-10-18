/**
 * SUTO OSNOVA — the "Literary Substrate" card (task 140).
 * A FEATURED plate in the cultural-domains zone: books & essays,
 * showing QUOTES and RELEVANT TEXTS.
 *
 * Honesty contracts (mirroring the Sonic Architecture card):
 *   - the texts SPLIT IS DATA-GROUNDED: the card only reveals when the
 *     LOCAL /api/categories registry confirms the books domain really
 *     queries the book entity — the presentation mirrors what the
 *     agent actually asks Qloo;
 *   - the quotes are REAL, canon-attributed lines (text + author +
 *     source work); the texts are canonical works and essays. Both are
 *     framed as "curated reading" — NEVER presented as Qloo results,
 *     popularity data or generated output;
 *   - a failed/empty probe degrades: the card SHIPS HIDDEN and stays
 *     hidden; the workspace is never blocked;
 *   - renders via createElement/textContent only; import-safe in Node.
 */
import { fetchCategories } from './api.js';

/** Curated QUOTES: a line, its author, the source work. */
export const LITERARY_QUOTES = Object.freeze([
  Object.freeze({
    text: 'It is not down on any map; true places never are.',
    author: 'Herman Melville', source: 'Moby-Dick',
  }),
  Object.freeze({
    text: 'I am large, I contain multitudes.',
    author: 'Walt Whitman', source: 'Song of Myself',
  }),
  Object.freeze({
    text: 'In the depths of winter, I finally learned that within me there lay an invincible summer.',
    author: 'Albert Camus', source: 'Return to Tipasa',
  }),
  Object.freeze({
    text: 'The past is a foreign country: they do things differently there.',
    author: 'L. P. Hartley', source: 'The Go-Between',
  }),
]);

/** Curated TEXTS: canonical works with author and kind. */
export const LITERARY_TEXTS = Object.freeze([
  Object.freeze({ title: 'Moby-Dick', author: 'Herman Melville', kind: 'novel' }),
  Object.freeze({ title: 'Song of Myself', author: 'Walt Whitman', kind: 'poem' }),
  Object.freeze({ title: 'Return to Tipasa', author: 'Albert Camus', kind: 'essay' }),
  Object.freeze({ title: 'Self-Reliance', author: 'Ralph Waldo Emerson', kind: 'essay' }),
  Object.freeze({ title: 'Walden', author: 'Henry David Thoreau', kind: 'essay' }),
  Object.freeze({ title: 'The Go-Between', author: 'L. P. Hartley', kind: 'novel' }),
]);

/**
 * Pure check: does the registry confirm the books domain queries the
 * book entity?
 */
export function booksQueriesTexts(categories) {
  if (!Array.isArray(categories)) return false;
  const books = categories.find((category) => category?.id === 'books');
  if (!books || !Array.isArray(books.searchTypes)) return false;
  return books.searchTypes.some((type) => String(type).replace(/^urn:entity:/, '') === 'book');
}

/** Pure renderer: fills the quotes and texts lists. */
export function renderLiterary(card, doc) {
  const quotes = doc.getElementById('literary-quotes');
  const texts = doc.getElementById('literary-texts');

  for (const quote of LITERARY_QUOTES) {
    const item = doc.createElement('li');
    item.className = 'literary-quote';
    const line = doc.createElement('span');
    line.className = 'literary-quote-text';
    line.textContent = quote.text;
    const meta = doc.createElement('span');
    meta.className = 'literary-meta';
    meta.textContent = ` — ${quote.author}, ${quote.source}`;
    item.appendChild(line);
    item.appendChild(meta);
    quotes.appendChild(item);
  }

  for (const work of LITERARY_TEXTS) {
    const item = doc.createElement('li');
    item.className = 'literary-text';
    const title = doc.createElement('span');
    title.className = 'literary-text-title';
    title.textContent = work.title;
    const meta = doc.createElement('span');
    meta.className = 'literary-meta';
    meta.textContent = ` — ${work.author} (${work.kind})`;
    item.appendChild(title);
    item.appendChild(meta);
    texts.appendChild(item);
  }

  card.removeAttribute('hidden');
}

/** Wire the card: fetch once; reveal only on registry confirmation. */
export function startLiteraryCard({ fetchImpl = fetchCategories, doc } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const card = scope.getElementById('literary-card');
  if (!card) return () => {};

  fetchImpl()
    .then((payload) => {
      if (!booksQueriesTexts(payload?.categories)) {
        throw new Error('the registry does not confirm book queries');
      }
      renderLiterary(card, scope);
    })
    .catch(() => {
      // Degrade honestly: the card stays hidden.
    });

  return () => {};
}

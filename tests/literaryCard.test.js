/**
 * Literary Substrate card gate (task 140) — pins the featured
 * books & essays plate showing QUOTES and RELEVANT TEXTS:
 *
 *   - MARKUP: the article exists inside the domains zone, HIDDEN at
 *     rest, carrying the exact title and the two named groups with
 *     their list nodes; the subtitle frames the content as CURATED
 *     READING (never Qloo results or generated output);
 *   - CURATED CANON: every quote carries text + author + source; every
 *     text carries title + author + kind; at least one ESSAY is
 *     present (the "essays" half of the task); all strings non-empty
 *     and emoji-free;
 *   - DATA-GROUNDED GATING (fake DOM): the card reveals ONLY when the
 *     /api/categories registry confirms the books domain queries the
 *     book entity; a books category without the type, a missing books
 *     category, an empty payload or a failed probe all leave the card
 *     HIDDEN;
 *   - RENDERING: quotes as line + " — author, source"; texts as title
 *     + " — author (kind)" — via createElement/textContent only;
 *   - STYLE + WIRING: the plate spans the grid; quotes and work titles
 *     use the SERIF reading token (task-124 family); the title the
 *     lifted gold; zero innerHTML; main.js starts it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  LITERARY_QUOTES, LITERARY_TEXTS, booksQueriesTexts, startLiteraryCard,
} = await import(path.join(CLIENT, 'src', 'js', 'literaryCard.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'literaryCard.js'), 'utf8');
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

const BOOKS_FULL = { id: 'books', label: 'Books & Literature', searchTypes: ['urn:entity:book'] };
const BOOKS_NO_TYPE = { id: 'books', label: 'Books & Literature', searchTypes: [] };

test('markup: the featured plate exists, hidden, with named groups', () => {
  const article = html.match(/<article id="literary-card" class="domain-card literary-card" hidden>/);
  assert.ok(article, 'the literary card exists inside the domains zone, hidden at rest');
  assert.match(html, /<span class="literary-title">Literary Substrate<\/span>/, 'the exact title');
  assert.match(html, /Books &amp; essays — curated reading/,
    'the subtitle frames CURATED READING (never fabricated results)');
  assert.match(html, /<span class="literary-group-title">Quotes<\/span>/, 'the quotes group');
  assert.match(html, /<ul id="literary-quotes" class="literary-list"><\/ul>/, 'the quotes list node');
  assert.match(html, /<span class="literary-group-title">Texts<\/span>/, 'the texts group');
  assert.match(html, /<ul id="literary-texts" class="literary-list"><\/ul>/, 'the texts list node');
});

test('curated canon: attributed quotes, works with kinds, essays present', () => {
  assert.ok(LITERARY_QUOTES.length >= 3, 'at least three quotes');
  for (const quote of LITERARY_QUOTES) {
    assert.ok(quote.text?.trim(), 'the quote has a line');
    assert.ok(quote.author?.trim(), 'the quote names its author');
    assert.ok(quote.source?.trim(), 'the quote names its source work');
    assert.ok(!/\p{Extended_Pictographic}/u.test(`${quote.text}${quote.author}${quote.source}`),
      'no emoji in the canon');
  }
  assert.ok(LITERARY_TEXTS.length >= 3, 'at least three texts');
  for (const work of LITERARY_TEXTS) {
    assert.ok(work.title?.trim(), 'the work has a title');
    assert.ok(work.author?.trim(), 'the work names its author');
    assert.ok(work.kind?.trim(), 'the work names its kind');
    assert.ok(!/\p{Extended_Pictographic}/u.test(`${work.title}${work.author}${work.kind}`),
      'no emoji in the canon');
  }
  assert.ok(LITERARY_TEXTS.some((work) => work.kind === 'essay'),
    'at least one ESSAY (the essays half of the task)');
});

test('data-grounded gating: book entity confirmed by the registry', () => {
  assert.equal(booksQueriesTexts([BOOKS_FULL]), true, 'books querying the book entity confirms');
  assert.equal(booksQueriesTexts([BOOKS_NO_TYPE]), false, 'a typeless books category does NOT');
  assert.equal(booksQueriesTexts([{ id: 'music', searchTypes: ['urn:entity:artist'] }]), false,
    'no books category -> no confirmation');
  assert.equal(booksQueriesTexts([]), false, 'empty registry -> no confirmation');
  assert.equal(booksQueriesTexts(null), false, 'garbage -> no confirmation');
});

test('behaviour: reveal only on confirmation; degrade to hidden', async () => {
  const ok = fakeDom(['literary-card', 'literary-quotes', 'literary-texts']);
  startLiteraryCard({ doc: ok.doc, fetchImpl: async () => ({ categories: [BOOKS_FULL] }) });
  await tick();
  assert.ok(!ok.nodes['literary-card'].attrs.has('hidden'), 'the card reveals');
  assert.equal(ok.nodes['literary-quotes'].children.length, LITERARY_QUOTES.length,
    'one item per quote');
  const [firstQuote] = ok.nodes['literary-quotes'].children;
  const [line, quoteMeta] = firstQuote.children;
  assert.equal(line.textContent, LITERARY_QUOTES[0].text, 'the quote line');
  assert.equal(quoteMeta.textContent, ` — ${LITERARY_QUOTES[0].author}, ${LITERARY_QUOTES[0].source}`,
    'and the attribution as author, source');
  assert.equal(ok.nodes['literary-texts'].children.length, LITERARY_TEXTS.length,
    'one item per text');
  const [firstText] = ok.nodes['literary-texts'].children;
  const [title, textMeta] = firstText.children;
  assert.equal(title.textContent, LITERARY_TEXTS[0].title, 'the work title');
  assert.equal(textMeta.textContent, ` — ${LITERARY_TEXTS[0].author} (${LITERARY_TEXTS[0].kind})`,
    'and the attribution as author (kind)');

  for (const [name, payload] of [
    ['books without the type', { categories: [BOOKS_NO_TYPE] }],
    ['no books category', { categories: [{ id: 'film', searchTypes: ['urn:entity:movie'] }] }],
    ['empty registry', { categories: [] }],
    ['empty payload', {}],
  ]) {
    const hidden = fakeDom(['literary-card', 'literary-quotes', 'literary-texts']);
    startLiteraryCard({ doc: hidden.doc, fetchImpl: async () => payload });
    await tick();
    assert.ok(hidden.nodes['literary-card'].attrs.has('hidden'), `${name}: stays hidden`);
  }

  const failed = fakeDom(['literary-card', 'literary-quotes', 'literary-texts']);
  startLiteraryCard({
    doc: failed.doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });
  await tick();
  assert.ok(failed.nodes['literary-card'].attrs.has('hidden'), 'a failed probe: stays hidden');
});

test('style and wiring: serif reading surfaces, lifted tokens, wired', () => {
  const card = cardsCss.match(/\.literary-card\s*\{[^}]*\}/)[0];
  assert.match(card, /grid-column:\s*1 \/ -1;/, 'the plate spans the grid');
  const title = cardsCss.match(/\.literary-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--gold-hi\);/, 'the title uses the lifted gold');

  const quote = cardsCss.match(/\.literary-quote\s*\{[^}]*\}/)[0];
  assert.match(quote, /font-family:\s*var\(--font-serif\);/,
    'quotes are a READING surface -> the serif token (task-124 family)');
  assert.match(quote, /font-style:\s*italic;/, 'quotes read as quotes');
  const text = cardsCss.match(/\.literary-text\s*\{[^}]*\}/)[0];
  assert.match(text, /font-family:\s*var\(--font-serif\);/,
    'work titles are reading surfaces too');

  for (const selector of ['\\.literary-quote', '\\.literary-text']) {
    const rule = cardsCss.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))[0];
    assert.match(rule, /color:\s*var\(--text\);/,
      `${selector} keeps the primary tone (13.82:1 on the card)`);
  }
  const meta = cardsCss.match(/\.literary-meta\s*\{[^}]*\}/)[0];
  assert.match(meta, /color:\s*var\(--muted-hi\);/, 'attribution meta is lifted secondary (6.77:1)');

  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
  assert.match(main, /startLiteraryCard\(\)/, 'main.js starts it on boot');
});

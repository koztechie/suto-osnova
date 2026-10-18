/**
 * Anchor input gate (task 134) — pins the central anchor panel: a
 * free-text field with QLOO CATEGORY HINTS as an ARIA combobox.
 *
 *   - MARKUP: the seed input carries the combobox contract
 *     (role/aria-expanded/aria-autocomplete/aria-controls) and the
 *     listbox node exists (role="listbox", hidden at rest);
 *   - PURE FILTER: filterCategories matches id/label/alias
 *     case-insensitively, an EMPTY query returns [] (never an
 *     unfiltered dump), the limit is enforced, garbage returns [];
 *   - BEHAVIOUR (against a minimal fake DOM): a successful probe
 *     renders hints (alias matches included), keyboard navigation sets
 *     aria-activedescendant, Enter APPLIES the curated example anchor
 *     and closes, Escape closes; a FAILED probe degrades to no hints
 *     and NEVER throws; selecting a hint writes via textContent only;
 *   - WIRING + STYLE: main.js starts the combobox, api.js serves the
 *     local /categories route, the popup is absolutely positioned
 *     (no layout shift) with palette-token colours, and no innerHTML
 *     exists anywhere in the module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  filterCategories, startAnchorInput, EXAMPLE_ANCHORS, SUGGESTION_LIMIT,
} = await import(path.join(CLIENT, 'src', 'js', 'anchorInput.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const api = await readFile(path.join(CLIENT, 'src', 'js', 'api.js'), 'utf8');
const moduleSource = await readFile(path.join(CLIENT, 'src', 'js', 'anchorInput.js'), 'utf8');

const CATEGORIES = [
  { id: 'music', label: 'Music', aliases: ['artist', 'soundtrack'] },
  { id: 'books', label: 'Books', aliases: ['literature', 'novel'] },
  { id: 'fashion', label: 'Fashion', aliases: ['clothing', 'brand'] },
  { id: 'dining', label: 'Dining', aliases: ['restaurant', 'cuisine'] },
  { id: 'film', label: 'Film', aliases: ['movie', 'cinema'] },
];

/** Minimal DOM double: enough surface for the combobox module. */
function fakeDom() {
  const make = (tag) => {
    const node = {
      tag, id: '', className: '', value: '', hidden: false, textContent: '',
      children: [], attrs: new Map(), listeners: new Map(),
      setAttribute(k, v) { this.attrs.set(k, String(v)); },
      getAttribute(k) { return this.attrs.get(k) ?? null; },
      removeAttribute(k) { this.attrs.delete(k); },
      appendChild(child) { this.children.push(child); },
      addEventListener(type, fn) { this.listeners.set(type, fn); },
      removeEventListener(type) { this.listeners.delete(type); },
      querySelectorAll(sel) {
        if (sel !== '[role="option"]') return [];
        return this.children.filter((c) => c.attrs.get('role') === 'option');
      },
      focus() { this.focused = true; },
      fire(type, event = {}) { return this.listeners.get(type)?.(event); },
    };
    // textContent = '' must clear rendered children (like the DOM).
    Object.defineProperty(node, 'textContent', {
      get() { return this._text ?? ''; },
      set(v) { this._text = v; if (v === '') this.children = []; },
    });
    return node;
  };
  const seed = make('input');
  seed.id = 'seed';
  const list = make('ul');
  list.id = 'anchor-suggestions';
  const doc = {
    getElementById: (id) => ({ seed, 'anchor-suggestions': list }[id] ?? null),
    createElement: (tag) => make(tag),
  };
  return { doc, seed, list };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the markup carries the combobox + listbox contract', () => {
  const input = html.match(/<input id="seed"[^>]*>/);
  assert.ok(input, 'the seed input exists');
  for (const attr of [
    'role="combobox"', 'aria-expanded="false"', 'aria-autocomplete="list"',
    'aria-controls="anchor-suggestions"', 'autocomplete="off"',
  ]) {
    assert.ok(input[0].includes(attr), `the input carries ${attr}`);
  }
  assert.match(html,
    /<ul id="anchor-suggestions" class="suggestions" role="listbox"\s+aria-label="Qloo category hints" hidden><\/ul>/,
    'the listbox node exists, named and hidden at rest');
});

test('filterCategories: substring match, empty query never dumps', () => {
  assert.deepEqual(filterCategories(CATEGORIES, ''), [], 'empty query shows nothing');
  assert.deepEqual(filterCategories(CATEGORIES, '   '), [], 'blank query shows nothing');
  assert.deepEqual(filterCategories(CATEGORIES, null), [], 'null query shows nothing');
  assert.deepEqual(filterCategories(null, 'music'), [], 'garbage categories show nothing');

  assert.deepEqual(filterCategories(CATEGORIES, 'mus').map((c) => c.id), ['music'], 'id match');
  assert.deepEqual(filterCategories(CATEGORIES, 'FILM').map((c) => c.id), ['film'],
    'label match, case-insensitive');
  assert.deepEqual(filterCategories(CATEGORIES, 'restau').map((c) => c.id), ['dining'],
    'alias match');
  assert.equal(filterCategories(CATEGORIES, 'zzz').length, 0, 'no match -> no hints');

  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, label: `X${i}`, aliases: [] }));
  assert.equal(filterCategories(many, 'x').length, SUGGESTION_LIMIT, 'the limit is enforced');
});

test('behaviour: hints render, keyboard navigates, Enter applies, Escape closes', async () => {
  const { doc, seed, list } = fakeDom();
  const stop = startAnchorInput({
    doc,
    fetchImpl: async () => ({ categories: CATEGORIES }),
  });

  seed.value = 'mov'; // matches the film ALIAS "movie"
  seed.fire('input');
  await tick();

  assert.equal(list.hidden, false, 'the listbox opens on a matching query');
  assert.equal(seed.getAttribute('aria-expanded'), 'true');
  assert.equal(list.children.length, 1, 'one hint rendered');
  const [option] = list.children;
  assert.equal(option.className, 'suggestion');
  assert.equal(option.attrs.get('role'), 'option');
  assert.ok(option.textContent.includes('Film'), 'the hint names the category');
  assert.ok(option.textContent.includes(EXAMPLE_ANCHORS.film), 'and shows its example anchor');

  seed.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(seed.getAttribute('aria-activedescendant'), option.id,
    'ArrowDown highlights via aria-activedescendant');

  seed.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(seed.value, EXAMPLE_ANCHORS.film, 'Enter applies the curated example anchor');
  assert.equal(list.hidden, true, 'and closes the listbox');
  assert.equal(seed.getAttribute('aria-expanded'), 'false');

  // Escape closes from any open state.
  seed.value = 'book';
  seed.fire('input');
  await tick();
  assert.equal(list.hidden, false);
  seed.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(list.hidden, true, 'Escape closes');

  stop();
});

test('behaviour: a failed probe degrades to no hints and never throws', async () => {
  const { doc, seed, list } = fakeDom();
  const stop = startAnchorInput({
    doc,
    fetchImpl: async () => { throw new Error('gateway down'); },
  });

  seed.value = 'music';
  await seed.fire('input'); // must not reject even if awaited
  await tick();

  assert.equal(list.hidden, true, 'no listbox without categories');
  assert.equal(seed.getAttribute('aria-expanded'), 'false');
  assert.equal(seed.value, 'music', 'the typed text is untouched');

  // A guard: missing nodes return a noop stop, never a throw.
  const emptyDoc = { getElementById: () => null, createElement: () => { throw new Error('unused'); } };
  assert.equal(typeof startAnchorInput({ doc: emptyDoc }), 'function');
  assert.equal(typeof startAnchorInput({ doc }), 'function');

  stop();
});

test('wiring and style: started on boot, local route, overlay, XSS-safe', () => {
  assert.match(main, /startAnchorInput\(\)/, 'main.js starts the combobox on boot');
  assert.match(api, /return request\('\/categories'\);/,
    'fetchCategories targets the LOCAL /categories gateway route only');
  assert.ok(!/innerHTML/.test(moduleSource.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML (comments stripped for the probe)');

  const anchorField = css.match(/\.anchor-field\s*\{[^}]*\}/);
  assert.ok(anchorField?.[0].includes('position: relative'),
    'the anchor field anchors the popup');
  const popup = css.match(/\.suggestions\s*\{[^}]*\}/);
  assert.ok(popup[0].includes('position: absolute'), 'the listbox overlays (no layout shift)');
  assert.ok(/background:\s*var\(--surface\);/.test(popup[0]),
    'the popup is a slate plaque');
  const option = css.match(/\.suggestion\s*\{[^}]*\}/);
  assert.ok(option[0].includes('color: var(--muted-hi)'),
    'hints are lifted secondary labels on the plaque (6.77:1)');
});

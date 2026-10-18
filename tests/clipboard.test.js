/**
 * Clipboard gate (task 147) — pins the copy-fragment function with its
 * instant feedback indicator:
 *
 *   - copyText PREFERS navigator.clipboard.writeText and falls back to
 *     a hidden textarea + execCommand; both failing resolves false and
 *     NEVER rejects;
 *   - INSTANT, TEXT-FIRST FEEDBACK: the clicked button's label swaps
 *     to "Copied"/"Copy failed" as soon as the copy settles (never a
 *     colour-only signal), data-feedback carries the tone, and the
 *     label self-reverts after revertMs; an empty fragment is
 *     "Nothing to copy" and performs NO copy;
 *   - DELEGATION: any [data-copy] descendant of the wired root is a
 *     fragment (the fragment travels as a data attribute — written via
 *     setAttribute, never markup interpolation);
 *   - THE LITERARY QUOTES gained per-quote copy buttons carrying the
 *     exact fragment ("text — author, source");
 *   - WIRING + STYLE: the Copy document button on the output panel
 *     copies the VISIBLE rendered text (hidden output -> nothing to
 *     copy); main.js wires both surfaces; the feedback tones are the
 *     lifted gold (success) and the oxide error channel (failure),
 *     both AA-legal on the slate; zero innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { copyText, attachCopyButton, attachCopyDelegation } = await import(
  path.join(CLIENT, 'src', 'js', 'clipboard.js')
);
const { renderLiterary, LITERARY_QUOTES } = await import(
  path.join(CLIENT, 'src', 'js', 'literaryCard.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'clipboard.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A copyable button double. */
function fakeButton(label = 'Copy') {
  const attrs = new Map();
  return {
    textContent: label, dataset: {}, listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    fire() { return this.listeners.get('click')?.(); },
  };
}

test('copyText: prefers the async clipboard, falls back, never rejects', async () => {
  const written = [];
  const ok = await copyText('fragment', {
    clipboard: { writeText: async (text) => { written.push(text); } },
  });
  assert.equal(ok, true, 'the modern path resolves true');
  assert.deepEqual(written, ['fragment'], 'and receives the exact text');

  // writeText rejects (permission) -> the legacy textarea path runs.
  const legacy = {
    body: { appended: [], appendChild(n) { this.appended.push(n); } },
    createElement: () => {
      const node = {
        value: '', style: {}, selected: false, removed: false,
        setAttribute() {}, select() { this.selected = true; },
        remove() { this.removed = true; },
      };
      legacy.lastNode = node;
      return node;
    },
    execCommand: (cmd) => cmd === 'copy',
  };
  const fell = await copyText('legacy fragment', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    doc: legacy,
  });
  assert.equal(fell, true, 'the fallback resolves true');
  assert.equal(legacy.lastNode.value, 'legacy fragment', 'the textarea carries the text');
  assert.equal(legacy.lastNode.selected, true, 'and is selected');
  assert.equal(legacy.lastNode.removed, true, 'and removed after the copy');

  assert.equal(await copyText('x', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    doc: { body: {}, createElement: () => ({}), execCommand: () => false },
  }), false, 'a failing fallback resolves false (never a throw)');
  assert.equal(await copyText('x', { clipboard: {}, doc: {} }), false,
    'no modern path and no fallback surface -> false');
});

test('instant feedback: label swaps, tone set, self-reverts', async () => {
  const button = fakeButton('Copy document');
  const written = [];
  const stop = attachCopyButton({
    button,
    getText: () => '# Dossier text',
    clipboard: { writeText: async (t) => { written.push(t); } },
    revertMs: 25,
  });

  button.fire();
  await sleep(5);
  assert.deepEqual(written, ['# Dossier text'], 'the fragment copies');
  assert.equal(button.textContent, 'Copied', 'the label swaps INSTANTLY (text first)');
  assert.equal(button.dataset.feedback, 'copied', 'the tone is carried on data-feedback');
  assert.equal(button.dataset.original, 'Copy document', 'the original label is remembered');

  await sleep(45);
  assert.equal(button.textContent, 'Copy document', 'the label self-reverts');
  assert.equal(button.dataset.feedback, undefined, 'and the tone clears');

  // An empty fragment: no copy call, honest feedback.
  const empty = fakeButton('Copy document');
  let copies = 0;
  attachCopyButton({
    button: empty,
    getText: () => '',
    clipboard: { writeText: async () => { copies += 1; } },
    revertMs: 200,
  });
  empty.fire();
  assert.equal(copies, 0, 'nothing copies without a fragment');
  assert.equal(empty.textContent, 'Nothing to copy', 'and the button says so');
  stop();
});

test('delegation: any [data-copy] descendant copies its fragment', async () => {
  const button = fakeButton('Copy');
  button.setAttribute('data-copy', 'A quote — Author, Source');
  const root = {
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    contains: (node) => node === button,
  };
  const written = [];
  const stop = attachCopyDelegation({
    root,
    clipboard: { writeText: async (t) => { written.push(t); } },
    revertMs: 25,
  });

  await root.listeners.get('click')({
    target: { closest: (selector) => (selector === '[data-copy]' ? button : null) },
    preventDefault() {},
  });
  assert.deepEqual(written, ['A quote — Author, Source'], 'the data attribute travels verbatim');
  assert.equal(button.textContent, 'Copied', 'the clicked button is the indicator');
  await sleep(40);
  assert.equal(button.textContent, 'Copy', 'and reverts');

  // A foreign target (no data-copy) never copies.
  await root.listeners.get('click')({
    target: { closest: () => null },
    preventDefault() {},
  });
  assert.equal(written.length, 1, 'no extra copies');
  stop();
});

test('the literary quotes gained per-quote copy buttons', () => {
  const make = (tag) => ({
    tag, className: '', textContent: '', children: [], attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.get(k) ?? null; },
    removeAttribute(k) { this.attrs.delete(k); },
    appendChild(child) { this.children.push(child); },
  });
  const quotes = make('ul');
  const texts = make('ul');
  const card = make('article');
  const nodes = { 'literary-quotes': quotes, 'literary-texts': texts };
  const doc = { createElement: make, getElementById: (id) => nodes[id] ?? null };
  renderLiterary(card, doc);

  const [first] = quotes.children;
  const [line, meta, copy] = first.children;
  assert.equal(copy.tagName ?? copy.tag, 'button', 'a copy button rides the quote');
  assert.equal(copy.className, 'quote-copy');
  assert.equal(copy.getAttribute('type'), 'button', 'it never submits');
  assert.equal(copy.getAttribute('aria-live'), 'polite', 'the swap announces');
  assert.equal(copy.getAttribute('data-copy'),
    `${LITERARY_QUOTES[0].text} — ${LITERARY_QUOTES[0].author}, ${LITERARY_QUOTES[0].source}`,
    'the fragment is the quote with its attribution');
  assert.equal(copy.textContent, 'Copy', 'and starts labelled Copy');
  assert.equal(line.textContent, LITERARY_QUOTES[0].text, 'the quote line is intact');
  assert.equal(meta.textContent, ` — ${LITERARY_QUOTES[0].author}, ${LITERARY_QUOTES[0].source}`,
    'the attribution is intact');
});

test('markup, wiring and style: the document copy button and the tones', () => {
  const button = html.match(/<button type="button" id="copy-document" class="action copy-action"\s+aria-live="polite">Copy document<\/button>/);
  assert.ok(button, 'the Copy document button exists, labelled and live');

  assert.match(main, /attachCopyButton\(\{/, 'main.js wires the document copy');
  assert.match(main, /node && !node\.hidden \? node\.textContent : ''/,
    'the getText copies the VISIBLE rendered text only');
  assert.match(main, /attachCopyDelegation\(\{ root: document\.getElementById\('literary-quotes'\) \}\)/,
    'and delegates the quote fragments');

  const copied = mainCss.match(/\[data-feedback="copied"\]\s*\{[^}]*\}/)[0];
  assert.match(copied, /color:\s*var\(--gold-hi\);/, 'success tone: the lifted gold');
  const failed = mainCss.match(/\[data-feedback="failed"\]\s*\{[^}]*\}/)[0];
  assert.match(failed, /color:\s*var\(--rust\);/, 'failure tone: the oxide channel');
  assert.ok(!/!important/.test(mainCss), 'the cascade order does the work, no !important');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the clipboard module never touches innerHTML');
});

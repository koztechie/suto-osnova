/**
 * Keyboard control gate (task 149) — pins the keyboard contracts:
 *
 *   - SUBMIT SHORTCUT: isSubmitShortcut is a pure, total predicate
 *     (Ctrl+Enter and Cmd+Enter match; plain Enter, Alt+Enter, other
 *     keys and garbage never do); startKeyboard routes the matched
 *     combination through the EXISTING submit pipeline (form.
 *     requestSubmit — the same event the button fires), prevents the
 *     default only on a match, degrades to a dispatch fallback on
 *     engines without requestSubmit, and a missing form is a noop;
 *   - TAB (the mode switcher): the switcher is a NATIVE radio group —
 *     Tab enters/exits in one stop, the arrows rotate between tabs and
 *     the gold focus frame is drawn by the :focus-visible rule. The
 *     gate pins the consequence and that NO custom keydown code
 *     touches the switcher (keyboard.js binds only the form);
 *   - A11Y EXPOSURE: the submit button carries aria-keyshortcuts for
 *     BOTH platforms and the visible hint exists (decorative);
 *   - WIRING: main.js starts the keyboard module; zero innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { isSubmitShortcut, startKeyboard } = await import(
  path.join(CLIENT, 'src', 'js', 'keyboard.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'keyboard.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** A fake form with a recorded requestSubmit/dispatch + listeners. */
function fakeForm({ withRequestSubmit = true } = {}) {
  const form = {
    submits: 0, dispatched: [], listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    fire(type, event) { return this.listeners.get(type)?.(event); },
    dispatchEvent(event) { this.dispatched.push(event.type); },
  };
  if (withRequestSubmit) form.requestSubmit = () => { form.submits += 1; };
  return form;
}

test('isSubmitShortcut: pure, total, exact', () => {
  assert.equal(isSubmitShortcut({ key: 'Enter', ctrlKey: true }), true, 'Ctrl+Enter');
  assert.equal(isSubmitShortcut({ key: 'Enter', metaKey: true }), true, 'Cmd+Enter');
  assert.equal(isSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: true }), true,
    'both modifiers still match');
  assert.equal(isSubmitShortcut({ key: 'Enter' }), false, 'plain Enter never submits');
  assert.equal(isSubmitShortcut({ key: 'Enter', altKey: true }), false, 'Alt+Enter is not it');
  assert.equal(isSubmitShortcut({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter is not it');
  assert.equal(isSubmitShortcut({ key: 'a', ctrlKey: true }), false, 'Ctrl+A is not it');
  assert.equal(isSubmitShortcut(null), false, 'garbage -> false, never a throw');
  assert.equal(isSubmitShortcut('Enter'), false, 'non-objects -> false');
});

test('behaviour: the shortcut routes through the submit pipeline', () => {
  const form = fakeForm();
  const stop = startKeyboard({ form });

  const prevented = [];
  form.fire('keydown', { key: 'x', preventDefault: () => prevented.push('x') });
  assert.equal(form.submits, 0, 'an unrelated key does nothing');
  assert.equal(prevented.length, 0, 'and prevents nothing');

  form.fire('keydown', { key: 'Enter', preventDefault: () => prevented.push('enter') });
  assert.equal(form.submits, 0, 'plain Enter does NOT submit');
  assert.equal(prevented.length, 0, 'plain Enter keeps its default behaviour');

  form.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault: () => prevented.push('ctrl') });
  assert.equal(form.submits, 1, 'Ctrl+Enter routes through requestSubmit (ONE pipeline)');
  assert.deepEqual(prevented, ['ctrl'], 'the default is prevented ONLY on a match');

  form.fire('keydown', { key: 'Enter', metaKey: true, preventDefault: () => prevented.push('meta') });
  assert.equal(form.submits, 2, 'Cmd+Enter too');

  stop();
  form.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault() {} });
  assert.equal(form.submits, 2, 'stop() detaches the handler');
});

test('behaviour: the dispatch fallback and the noop guard', () => {
  const legacy = fakeForm({ withRequestSubmit: false });
  startKeyboard({ form: legacy });
  legacy.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault() {} });
  assert.deepEqual(legacy.dispatched, ['submit'],
    'without requestSubmit the same cancellable submit event dispatches');

  assert.equal(typeof startKeyboard({}), 'function', 'a missing form degrades to a noop stop');
  assert.equal(typeof startKeyboard({ form: null }), 'function', 'null too');
});

test('tab contract: the switcher is native, no custom keydown touches it', () => {
  const radios = [...html.matchAll(/<input class="tab-input" type="radio" name="mode"/g)];
  assert.equal(radios.length, 3,
    'three NATIVE radios: Tab enters/exits in one stop and the arrows rotate (platform behaviour)');
  const focusFrame = mainCss.match(/\.tab-input:focus-visible \+ \.tab-label\s*\{[^}]*\}/);
  assert.ok(focusFrame?.[0].includes('outline: 2px solid var(--gold);'),
    'the gold focus frame follows the keyboard focus');
  assert.ok(!/tab-input|tab-label|\.tab\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'keyboard.js never binds custom handlers to the switcher (native stays native)');
});

test('a11y exposure and wiring: aria-keyshortcuts, the hint, the boot', () => {
  const button = html.match(/<button id="generate" type="submit" aria-keyshortcuts="([^"]+)">/);
  assert.ok(button, 'the submit button carries aria-keyshortcuts');
  assert.deepEqual(button[1].split(' '), ['Control+Enter', 'Meta+Enter'],
    'both platforms are exposed to assistive tech');
  assert.match(html, /<p class="kbd-hint" aria-hidden="true">Ctrl\/Cmd \+ Enter<\/p>/,
    'the visible hint exists, decorative');

  const hint = mainCss.match(/\.kbd-hint\s*\{[^}]*\}/)[0];
  assert.match(hint, /color:\s*var\(--muted-hi\);/, 'the hint is the lifted secondary tone');
  assert.match(hint, /font-family:\s*var\(--font-mono\);/, 'in the mono stack');

  assert.match(main, /startKeyboard\(\{ form \}\)/, 'main.js starts the module on boot');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
});

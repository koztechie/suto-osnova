/**
 * Demo presets gate (task 135) — pins the one-tap demo scenarios:
 *
 *   - MARKUP: a labelled button group with EXACTLY THREE presets,
 *     carrying the pinned scenarios (seed + mode):
 *       David Lynch Noir -> worldbuilder  (mise-en-scene anchor)
 *       Post-Punk Berlin -> worldbuilder  (aesthetic world)
 *       Ambient Festival -> experiential  (live activation)
 *   - NEVER SUBMIT: every preset is type="button" — the user still
 *     presses Generate deliberately;
 *   - SERVER-PARITY MODES: every data-mode value is a REAL server mode
 *     id (imported from the dispatcher — a typo'd mode can never ship);
 *   - BEHAVIOUR (fake DOM): clicking a preset applies the seed, checks
 *     the matching mode radio, focuses the input for editing and
 *     reports on the status line; a preset with an unknown mode still
 *     applies the SEED (partial application, honest);
 *   - WIRING + STYLE: main.js starts the wiring; the chips sit on the
 *     --bg-page inset bed with lifted labels; the module keeps every
 *     dependency injected (import-safe in Node).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.QLOO_API_KEY = 'demo-presets-key';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
// The client's mode vocabulary is the HTTP ROUTE vocabulary (main.js
// posts /api/generate/<mode>); every value must be RESOLVABLE by the
// server dispatcher ('experiential' is a sanctioned alias of the
// canonical 'activation' id).
const { resolveMode } = await import('../server/src/engine/ModeDispatcher.js');
const { startPresets, applyPreset } = await import(
  path.join(CLIENT, 'src', 'js', 'presets.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

const EXPECTED = [
  { label: 'David Lynch Noir', seed: 'David Lynch Noir', mode: 'worldbuilder' },
  { label: 'Post-Punk Berlin', seed: 'Post-Punk Berlin', mode: 'worldbuilder' },
  { label: 'Ambient Festival', seed: 'Ambient Festival', mode: 'experiential' },
];

/** Minimal DOM double for the preset wiring. */
function fakeDom() {
  const makeButton = (dataset, label) => ({
    dataset, textContent: label, listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    fire(type) { return this.listeners.get(type)?.(); },
  });
  const seed = { value: '', focused: false, focus() { this.focused = true; } };
  // Radio GROUP semantics: checking one unchecks its siblings.
  const radios = {};
  for (const id of ['worldbuilder', 'experiential', 'antithesis']) {
    radios[id] = {
      _checked: false,
      get checked() { return this._checked; },
      set checked(value) {
        if (value) for (const other of Object.values(radios)) other._checked = false;
        this._checked = value;
      },
    };
  }
  const form = {
    querySelector(selector) {
      const value = selector.match(/\[value="(\w+)"\]/)?.[1];
      return radios[value] ?? null;
    },
  };
  const buttons = EXPECTED.map((p) => makeButton({ seed: p.seed, mode: p.mode }, p.label));
  const doc = {
    getElementById: (id) => ({ seed, 'generate-form': form }[id] ?? null),
    querySelectorAll: (selector) => (selector === '.preset' ? buttons : []),
  };
  return { doc, seed, radios, buttons };
}

test('exactly three pinned demo scenarios, all type=button', () => {
  const group = html.match(/<div class="presets" role="group" aria-label="Demo presets">([\s\S]*?)\n\s*<\/div>/);
  assert.ok(group, 'the demo presets group exists');
  assert.match(group[1], /<span class="presets-label">Demo<\/span>/, 'the group is labelled');

  const buttons = [...group[1].matchAll(
    /<button type="button" class="preset"\s+data-seed="([^"]+)" data-mode="(\w+)">([^<]+)<\/button>/g,
  )];
  assert.equal(buttons.length, 3, 'exactly three presets');
  for (let i = 0; i < 3; i += 1) {
    const [, seed, mode, label] = buttons[i];
    assert.equal(label, EXPECTED[i].label, `preset ${i + 1} label`);
    assert.equal(seed, EXPECTED[i].seed, `preset ${i + 1} seed`);
    assert.equal(mode, EXPECTED[i].mode, `preset ${i + 1} mode`);
  }
  assert.ok(!/<button(?![^>]*type="button")[^>]*class="preset"/.test(group[1]),
    'a preset can never default to submit');
});

test('every preset mode is resolvable by the server dispatcher', () => {
  for (const { label, mode } of EXPECTED) {
    const resolved = resolveMode(mode);
    assert.ok(resolved, `preset "${label}": mode "${mode}" resolves server-side`);
  }
  assert.equal(resolveMode('experiential'), 'activation',
    'experiential resolves to the canonical activation id (alias parity)');
});

test('behaviour: a click applies seed + mode, focuses, reports', () => {
  const { doc, seed, radios, buttons } = fakeDom();
  const applied = [];
  const stop = startPresets({ doc, onApplied: (message, tone) => applied.push({ message, tone }) });

  buttons[0].fire('click');
  assert.equal(seed.value, 'David Lynch Noir', 'the seed is applied');
  assert.equal(radios.worldbuilder.checked, true, 'the matching mode radio is checked');
  assert.equal(seed.focused, true, 'the input is focused for editing');
  assert.deepEqual(applied, [{ message: 'Preset applied: David Lynch Noir', tone: 'ok' }],
    'the status line reports the substitution');

  buttons[2].fire('click');
  assert.equal(seed.value, 'Ambient Festival');
  assert.equal(radios.experiential.checked, true);
  assert.equal(radios.worldbuilder.checked, false, 'the previous mode is deselected');

  stop();
  buttons[0].fire('click'); // detached: the listener is gone
  assert.equal(applied.length, 2, 'stop() detaches every handler');
});

test('behaviour: partial application and guards are honest', () => {
  // Unknown mode: the seed still applies (best-effort, not a no-op).
  const seed = { value: '', focus() {} };
  const form = { querySelector: () => null };
  assert.equal(applyPreset({ seed: 'X', mode: 'ghost' }, { input: seed, form }), true);
  assert.equal(seed.value, 'X', 'the seed applied despite the unknown mode');

  // Guards: no input / empty seed -> false, nothing thrown.
  assert.equal(applyPreset({ seed: 'X' }, { input: null }), false);
  assert.equal(applyPreset({ seed: '' }, { input: seed, form }), false);
  assert.equal(applyPreset(null, { input: seed, form }), false);
});

test('wiring and style: started on boot, inset chips, lifted labels', () => {
  assert.match(main, /startPresets\(\)/, 'main.js starts the preset wiring on boot');

  const chip = css.match(/\.preset\s*\{[^}]*\}/);
  assert.ok(chip, 'the preset chip rule exists');
  assert.ok(chip[0].includes('background: var(--bg-page)'),
    'chips sit on the inset --bg-page bed');
  assert.ok(chip[0].includes('color: var(--muted-hi)'),
    'chip labels are the lifted secondary tone');
  assert.ok(chip[0].includes('width: auto'),
    'chips stay inline (the generic button rule is a full-width block)');

  const label = css.match(/\.presets-label\s*\{[^}]*\}/);
  assert.ok(label[0].includes('color: var(--muted-hi)'),
    'the group label on the slate uses the lifted tone');
});

/**
 * Mode switcher gate (task 133) — pins the 3-mode agent switcher as a
 * MONOLITHIC tab bar with a GOLD focus frame:
 *
 *   - MARKUP: a fieldset with a legend wraps ONE .tab-bar container of
 *     three labelled native radios (name="mode"); the VALUES match the
 *     server mode ids exactly (worldbuilder / experiential /
 *     antithesis, imported from the dispatcher — client and server can
 *     never drift), and the CHECKED tab equals the dispatcher's
 *     DEFAULT_MODE; the legacy <select name="mode"> is GONE;
 *   - PATTERN HONESTY: this is a form VALUE choice, not tabpanel
 *     switching — hence a native radio group (free arrow-key support,
 *     form submission) skinned as tabs, NOT the ARIA tabs pattern
 *     (which would demand real tabpanels);
 *   - MONOLITHIC BAR: one outer bordered grid of three equal columns,
 *     inner dividers only (no per-tab frames, no gaps);
 *   - GOLD FOCUS FRAME: the focus ring is drawn on the tab around the
 *     focused radio via the sibling selector (no :has() dependency);
 *   - JS CONTRACT: main.js keeps reading form.mode.value — a named
 *     radio group exposes RadioNodeList.value, so the wiring survives
 *     the widget swap unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The dispatcher import chain is pure engine, but follow the repo's
// env-first pattern for any server import.
process.env.QLOO_API_KEY = 'mode-switcher-key';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { DEFAULT_MODE } = await import('../server/src/engine/ModeDispatcher.js');

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');

const rule = (pattern, probe) => [...css.matchAll(new RegExp(pattern, 'g'))]
  .map((m) => m[0])
  .find((block) => block.includes(probe));

test('three labelled radios in one fieldset, values matching the server', () => {
  assert.ok(!/<select[^>]*name="mode"/.test(html), 'the legacy mode <select> is gone');

  const fieldset = html.match(/<fieldset class="field mode-switch">([\s\S]*?)<\/fieldset>/);
  assert.ok(fieldset, 'the mode fieldset exists');
  const bar = fieldset[1];
  assert.match(bar, /<legend class="mode-legend">Agent mode<\/legend>/,
    'the switcher is named via a legend');

  const inputs = [...bar.matchAll(
    /<input class="tab-input" type="radio" name="mode" value="(\w+)"( checked)?>/g,
  )];
  assert.equal(inputs.length, 3, 'exactly three mode radios');
  assert.deepEqual(inputs.map((m) => m[1]).sort(),
    ['antithesis', 'experiential', 'worldbuilder'],
    'the values are the three server mode ids');

  const checked = inputs.filter((m) => m[2]).map((m) => m[1]);
  assert.deepEqual(checked, [DEFAULT_MODE],
    `exactly one tab is checked and it equals the dispatcher DEFAULT_MODE (${DEFAULT_MODE})`);

  // Every radio is wrapped by its label and carries a visible tab name.
  const labels = [...bar.matchAll(/<label class="tab"[^>]*>([\s\S]*?)<\/label>/g)];
  assert.equal(labels.length, 3, 'three tab labels');
  for (const [, body] of labels) {
    assert.match(body, /<input class="tab-input" type="radio"/, 'the label wraps its radio');
    assert.match(body, /<span class="tab-label">[^<]+<\/span>/, 'and names the tab');
  }
});

test('monolithic bar: one grid, equal columns, inner dividers only', () => {
  const container = rule('\\.tab-bar\\s*\\{[^}]*\\}', 'display: grid');
  assert.ok(container, 'the tab bar is a grid');
  assert.match(container, /grid-template-columns:\s*repeat\(3, 1fr\);/,
    'three equal columns');
  assert.match(container, /border:\s*1px solid var\(--line\);/,
    'ONE outer frame');
  assert.match(container, /overflow:\s*hidden;/, 'the frame clips the tabs');

  const divider = rule('\\.tab \\+ \\.tab\\s*\\{[^}]*\\}', 'border-left');
  assert.ok(divider, 'inner dividers exist');
  assert.match(divider, /border-left:\s*1px solid var\(--line\);/,
    'dividers only — no per-tab frames');
});

test('the gold focus frame lands on the tab around the focused radio', () => {
  const focus = rule('\\.tab-input:focus-visible \\+ \\.tab-label\\s*\\{[^}]*\\}', 'outline');
  assert.ok(focus, 'a :focus-visible rule targets the tab label via the sibling selector');
  assert.match(focus, /outline:\s*2px solid var\(--gold\);/,
    'the frame is the frozen gold, 2px');
});

test('selected and hover states use the lifted tones', () => {
  const selected = rule('\\.tab-input:checked \\+ \\.tab-label\\s*\\{[^}]*\\}', 'color');
  assert.ok(selected, 'the checked tab has a state rule');
  assert.match(selected, /color:\s*var\(--gold-hi\);/,
    'the selected tab is the lifted gold (on slate: 8.15:1)');
  assert.match(selected, /inset 0 -2px 0 0 var\(--gold\)/,
    'and carries the gold underline');
});

test('the form contract survives: main.js reads form.mode.value', () => {
  assert.match(main, /form\.mode\.value/, 'main.js still reads form.mode.value');
  assert.ok(/name="mode"/.test(html), 'the radios keep name="mode" (RadioNodeList.value)');
});

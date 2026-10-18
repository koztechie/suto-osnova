/**
 * Affinity widget gate (task 144) — pins the monochrome discrete
 * affinity-strength meters:
 *
 *   - PURE MATH: affinityCells is a clamped, discrete 10% stepping
 *     function, total for garbage input;
 *   - REAL CONTRACT EXTRACTION: extractAffinities reads the JSON
 *     envelope's dossier.data.ranked entries ({name, connection:
 *     {percent}}) — the values the BACKEND measured (the server's
 *     ScoreNormalizer produced them); unmeasured entries (percent
 *     null), nameless entries and absent payloads are honestly
 *     skipped — the widget never invents a number;
 *   - RENDERING (fake DOM): one row per entry — the label, exactly
 *     AFFINITY_CELLS discrete cells with the right filled count, and
 *     the percentage as TEXT in a role="meter" element carrying
 *     aria-valuenow/min/max (never colour-only); the widget hides
 *     itself when empty;
 *   - MONOCHROME STYLE: filled cells the single lifted-gold accent,
 *     empties the neutral muted — no traffic-light hues; the value in
 *     the mono stack;
 *   - WIRING: the named section ships hidden in the output panel; the
 *     JSON path shows it, the markdown/html/empty paths hide it;
 *     zero innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  affinityCells, extractAffinities, renderAffinityWidget, AFFINITY_CELLS,
} = await import(path.join(CLIENT, 'src', 'js', 'affinityMeter.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const ui = await readFile(path.join(CLIENT, 'src', 'js', 'ui.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'affinityMeter.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Minimal DOM double. */
function fakeContainer() {
  return {
    children: [], hidden: false, textContent: '',
    appendChild(child) { this.children.push(child); },
  };
}
const fakeDoc = {
  createElement: (tag) => ({
    tag, className: '', textContent: '', children: [], attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    appendChild(child) { this.children.push(child); },
  }),
};

test('affinityCells: clamped, discrete, total', () => {
  assert.equal(AFFINITY_CELLS, 10, 'ten cells at 10% steps');
  assert.equal(affinityCells(0), 0, 'zero fills nothing');
  assert.equal(affinityCells(34), 3, '34% rounds to three cells');
  assert.equal(affinityCells(65), 7, '65% rounds up to seven cells');
  assert.equal(affinityCells(100), 10, 'a full measure fills the bar');
  assert.equal(affinityCells(-5), 0, 'negatives clamp to zero');
  assert.equal(affinityCells(150), 10, 'overages clamp to full');
  assert.equal(affinityCells(NaN), 0, 'garbage fills nothing');
});

test('extraction reads the REAL envelope contract, never invents', () => {
  const payload = {
    dossier: {
      data: {
        ranked: [
          { name: 'Bohren & der Club of Gore', connection: { score: 0.87, percent: 87 } },
          { name: 'Unmeasured', connection: { score: null, percent: null } },
          { connection: { percent: 42 } }, // nameless -> skipped
          { name: 'Via entity', entity: { name: 'ignored' }, connection: { percent: 12 } },
          { name: 'From entity', entity: { name: 'Entity Name' }, connection: { percent: 55 } },
          'garbage',
          null,
        ],
      },
    },
  };
  assert.deepEqual(extractAffinities(payload), [
    { label: 'Bohren & der Club of Gore', percent: 87 },
    { label: 'Via entity', percent: 12 },
    { label: 'From entity', percent: 55 },
  ], 'measured + named entries extract; unmeasured/nameless/garbage skip');
  assert.deepEqual(extractAffinities({}), [], 'an absent payload yields nothing');
  assert.deepEqual(extractAffinities({ dossier: { data: {} } }), [], 'no ranked -> nothing');
});

test('rendering: discrete cells, meter semantics, self-hiding', () => {
  const container = fakeContainer();
  renderAffinityWidget(container, [
    { label: 'Ambient Artist', percent: 65 },
    { label: 'Low Signal', percent: 12 },
  ], fakeDoc);

  assert.equal(container.hidden, false, 'with entries the widget shows');
  assert.equal(container.children.length, 2, 'one row per entry');

  const [row] = container.children;
  const [name, bar, value] = row.children;
  assert.equal(name.className, 'affinity-label');
  assert.equal(name.textContent, 'Ambient Artist', 'the label is the pick name');
  assert.equal(bar.className, 'affinity-bar');
  assert.equal(bar.attrs.get('aria-hidden'), 'true', 'the bar shape is decorative');
  assert.equal(bar.children.length, AFFINITY_CELLS, 'exactly the discrete cell count');
  assert.equal(bar.children.filter((c) => c.className.includes('-filled')).length, 7,
    '65% fills seven cells');

  assert.equal(value.attrs.get('role'), 'meter', 'the number is a meter');
  assert.equal(value.attrs.get('aria-valuenow'), '65');
  assert.equal(value.attrs.get('aria-valuemin'), '0');
  assert.equal(value.attrs.get('aria-valuemax'), '100');
  assert.equal(value.textContent, '65%', 'the percentage is TEXT (never colour-only)');

  const empty = fakeContainer();
  renderAffinityWidget(empty, [], fakeDoc);
  assert.equal(empty.hidden, true, 'without measured values the widget hides itself');
  assert.equal(empty.children.length, 0, 'and renders no rows');
});

test('markup and style: named hidden section, monochrome cells', () => {
  assert.match(html,
    /<section id="affinity" class="affinity" aria-label="Affinity summary" hidden><\/section>/,
    'the widget section exists in the output panel, named and hidden at rest');

  const filled = mainCss.match(/\.affinity-cell-filled\s*\{[^}]*\}/)[0];
  assert.match(filled, /background:\s*var\(--gold-hi\);/,
    'filled cells are the SINGLE lifted-gold accent (8.15:1 on the panel)');
  const cell = mainCss.match(/\.affinity-cell\s*\{[^}]*\}/)[0];
  assert.match(cell, /background:\s*var\(--muted\);/,
    'empty cells are the neutral muted (no traffic-light hues anywhere)');
  const value = mainCss.match(/\.affinity-value\s*\{[^}]*\}/)[0];
  assert.match(value, /font-family:\s*var\(--font-mono\);/,
    'the percentage reads in the mono stack (technical data)');
});

test('wiring: the JSON path shows it, other paths hide it', () => {
  assert.match(ui, /renderAffinityWidget\(el\('affinity'\), extractAffinities\(payload\), document\)/,
    'renderJson feeds the widget from the payload');
  assert.match(ui, /el\('affinity'\)\.hidden = true;/,
    'hideOutputs() hides the widget (markdown/html/empty paths)');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the widget module never touches innerHTML');
});

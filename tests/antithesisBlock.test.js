/**
 * Cultural Antipode block gate (task 145) — pins the oxide-accented
 * Taste Antithesis display:
 *
 *   - REAL CONTRACT EXTRACTION: extractAntithesis reads
 *     dossier.data.antithesis.matrix ({domain, entries: [{name,
 *     divergencePercent}]}) — the divergence the backend's
 *     TasteInverter measured; entries without a finite percent or a
 *     name are skipped; an absent block (Modes 1/2) yields null; the
 *     per-domain structure survives so EMPTY domains stay visible —
 *     mirroring the server contract;
 *   - RENDERING (fake DOM): the title, one label per domain, rows of
 *     name + divergence TEXT in a role="meter" span (aria-valuenow/
 *     min/max — never colour-only); an empty domain shows "no measured
 *     antipode" (honest parity with the backend's visible count-0
 *     zones); the block self-hides without data;
 *   - THE OXIDE ACCENT (the task's literal spec): the block rule,
 *     the title and the divergence values use var(--rust), and the
 *     rust token chain RESOLVES to exactly #E06338 in tokens.css
 *     (the frozen task-123 mapping — the gate parses the chain);
 *   - WIRING: the named hidden section lives in the output panel;
 *     renderJson feeds it; hideOutputs hides it; zero innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { extractAntithesis, renderAntithesisBlock } = await import(
  path.join(CLIENT, 'src', 'js', 'antithesisBlock.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const ui = await readFile(path.join(CLIENT, 'src', 'js', 'ui.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'antithesisBlock.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = (await readFile(path.join(CLIENT, 'src', 'css', 'tokens.css'), 'utf8'))
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

const PAYLOAD = {
  dossier: {
    data: {
      antithesis: {
        matrix: [
          {
            domain: 'music', count: 2,
            entries: [
              { name: 'Bohren & der Club of Gore', divergencePercent: 92.5 },
              { name: 'Unmeasured', divergencePercent: null },
              { divergencePercent: 40 }, // nameless -> skipped
            ],
          },
          { domain: 'dining', count: 0, entries: [] }, // stays visible
        ],
        conflictDrivers: [],
      },
    },
  },
};

test('extraction reads the REAL antithesis contract, never invents', () => {
  const data = extractAntithesis(PAYLOAD);
  assert.ok(data, 'the block extracts');
  assert.deepEqual(data.domains, [
    { domain: 'music', entries: [{ name: 'Bohren & der Club of Gore', percent: 92.5 }] },
    { domain: 'dining', entries: [] },
  ], 'measured + named entries extract; unmeasured/nameless skip; EMPTY domains survive');

  assert.equal(extractAntithesis({}), null, 'an absent block (Modes 1/2) yields null');
  assert.equal(extractAntithesis({ dossier: { data: {} } }), null, 'no antithesis -> null');
  assert.equal(extractAntithesis({ dossier: { data: { antithesis: {} } } }), null,
    'a block without a matrix -> null');
});

test('rendering: oxide rows, meter semantics, honest empty zones', () => {
  const container = fakeContainer();
  renderAntithesisBlock(container, extractAntithesis(PAYLOAD), fakeDoc);

  assert.equal(container.hidden, false, 'with data the block shows');
  const [title, musicLabel, row, diningLabel, empty] = container.children;
  assert.equal(title.className, 'antithesis-title');
  assert.equal(title.textContent, 'Cultural Antipode', 'the exact block title');

  assert.equal(musicLabel.className, 'antithesis-domain');
  assert.equal(musicLabel.textContent, 'music', 'one label per domain');
  assert.equal(row.className, 'antithesis-row');
  const [name, value] = row.children;
  assert.equal(name.textContent, 'Bohren & der Club of Gore', 'the antipode name');
  assert.equal(value.attrs.get('role'), 'meter', 'the divergence is a meter');
  assert.equal(value.attrs.get('aria-valuenow'), '93', 'rounded for aria');
  assert.equal(value.textContent, '92.5%', 'the measured divergence as TEXT');

  assert.equal(diningLabel.textContent, 'dining', 'the empty domain stays visible');
  assert.equal(empty.className, 'antithesis-empty');
  assert.equal(empty.textContent, 'no measured antipode',
    'honest parity with the backend visible count-0 zones');

  const blank = fakeContainer();
  renderAntithesisBlock(blank, null, fakeDoc);
  assert.equal(blank.hidden, true, 'without data the block hides itself');
  assert.equal(blank.children.length, 0, 'and renders nothing');
});

test('the oxide accent resolves to exactly #E06338 through the chain', () => {
  // The task's literal spec: the accent is #E06338 — the frozen --rust.
  const alias = tokensCss.match(/--rust:\s*var\((--palette-\w+)\);/);
  assert.ok(alias, '--rust is an alias of a palette token');
  const palette = tokensCss.match(new RegExp(`${alias[1]}:\\s*(#[0-9a-fA-F]{6});`));
  assert.ok(palette, 'the palette token is declared');
  assert.equal(palette[1].toLowerCase(), '#e06338',
    'the rust chain resolves to exactly #E06338 (the frozen oxide)');

  // Every accent surface styles with the token, never a literal.
  const block = mainCss.match(/\.antithesis\s*\{[^}]*\}/)[0];
  assert.match(block, /border-left:\s*2px solid var\(--rust\);/,
    'the block carries the oxide rule');
  const title = mainCss.match(/\.antithesis-title\s*\{[^}]*\}/)[0];
  assert.match(title, /color:\s*var\(--rust\);/, 'the title is the oxide');
  const divergence = mainCss.match(/\.antithesis-divergence\s*\{[^}]*\}/)[0];
  assert.match(divergence, /color:\s*var\(--rust\);/, 'divergence values are the oxide');
  assert.match(divergence, /font-family:\s*var\(--font-mono\);/,
    'divergences read in the mono stack');
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(mainCss), 'main.css holds no hex literal at all');
});

test('markup and wiring: named hidden section, fed by the JSON path', () => {
  assert.match(html,
    /<section id="antithesis" class="antithesis" aria-label="Cultural antipode" hidden><\/section>/,
    'the block section exists in the output panel, named and hidden at rest');
  assert.match(ui, /renderAntithesisBlock\(el\('antithesis'\), extractAntithesis\(payload\), document\)/,
    'renderJson feeds the block from the payload');
  assert.match(ui, /el\('antithesis'\)\.hidden = true;/,
    'hideOutputs() hides the block (markdown/html/empty paths)');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
});

/**
 * Browser compatibility gate (task 157) — pins the ENGINE MATRIX for
 * Chrome, Firefox, Safari and Android Chrome, and PROBES the client
 * sources so any new feature forces a matrix update.
 *
 * The live verification (recorded in PLAN_STATE) ran the full
 * interface in REAL Chromium through the harness: boot, all five
 * featured cards, presets, generation, the affinity/antithesis
 * widgets, the inspector, ZERO console errors, ZERO external origins,
 * and Lighthouse 1.0/1.0/1.0 (a11y/best-practices/seo). Firefox,
 * Safari and mobile Chrome were NOT launchable in this environment —
 * their coverage is this feature-availability matrix plus the
 * documented manual protocol (PLAN_STATE), not a browser launch.
 *
 * The matrix is the contract:
 *   - every CSS/JS feature the client uses has a pinned minimum per
 *     engine (Chrome / Firefox / Safari / Android Chrome tracks the
 *     Chrome channel);
 *   - the two known floors are DOCUMENTED with their degradation:
 *     color-mix (Chrome 111 / FF 113 / Safari 16.2 — older engines
 *     drop the derived-token declarations, borders lose colour but
 *     the layout stands) and requestSubmit (Safari < 16 — the dispatch
 *     fallback exists and is probed);
 *   - the dual-path features are probed: scrollbar-width AND
 *     ::-webkit-scrollbar; clipboard AND execCommand; the tap
 *     highlight is a webkit-only property, ignored elsewhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const cssDir = path.join(CLIENT, 'src', 'css');
const jsDir = path.join(CLIENT, 'src', 'js');

const cssText = (await Promise.all(
  (await readdir(cssDir)).filter((f) => f.endsWith('.css'))
    .map((f) => readFile(path.join(cssDir, f), 'utf8')),
)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const jsText = (await Promise.all(
  (await readdir(jsDir)).filter((f) => f.endsWith('.js'))
    .map((f) => readFile(path.join(jsDir, f), 'utf8')),
)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

/** The pinned engine matrix: every feature -> minimums + degradation. */
const MATRIX = Object.freeze({
  css: Object.freeze({
    'css-grid': { chrome: '57', firefox: '52', safari: '10.1' },
    'calc()': { chrome: '26', firefox: '16', safari: '7' },
    'env()': { chrome: '87', firefox: '116', safari: '11.1', note: 'absent engines drop the padding declarations (base padding stays)' },
    'color-mix()': { chrome: '111', firefox: '113', safari: '16.2', note: 'THE FLOOR: older engines drop derived-token declarations (borders lose colour, layout stands)' },
    ':focus-visible': { chrome: '86', firefox: '85', safari: '15.4' },
    ':not()': { chrome: '1', firefox: '1', safari: '3' },
    'clip-path: inset()': { chrome: '55', firefox: '55', safari: '13.1' },
    'scrollbar-width': { chrome: '121', firefox: '64', safari: '17.4', note: 'older engines ignore it; the ::webkit-scrollbar path covers WebKit/Blink' },
    '::-webkit-scrollbar': { chrome: '1', firefox: '0', safari: '1', note: 'webkit-only pseudo; harmless where unsupported' },
    '-webkit-tap-highlight-color': { chrome: '1', firefox: '0', safari: '1', note: 'webkit-only property; ignored by Firefox harmlessly' },
    'prefers-reduced-motion': { chrome: '74', firefox: '63', safari: '10.1' },
    'min()/max()': { chrome: '79', firefox: '75', safari: '13.1' },
    '@media (max-width)': { chrome: '1', firefox: '1', safari: '1' },
    '@import': { chrome: '1', firefox: '1', safari: '1.2' },
  }),
  js: Object.freeze({
    'es-modules': { chrome: '61', firefox: '60', safari: '10.1' },
    'optional-chaining': { chrome: '80', firefox: '74', safari: '13.1' },
    'nullish-coalescing': { chrome: '80', firefox: '74', safari: '13.1' },
    'async/await': { chrome: '55', firefox: '52', safari: '10.1' },
    'String.matchAll': { chrome: '73', firefox: '67', safari: '13' },
    'Element.closest': { chrome: '41', firefox: '35', safari: '9' },
    'navigator.clipboard': { chrome: '66', firefox: '52', safari: '13', note: 'the execCommand fallback covers older/non-secure contexts' },
    'form.requestSubmit': { chrome: '77', firefox: '75', safari: '16', note: 'the dispatch fallback covers Safari < 16' },
    'iframe.srcdoc': { chrome: '20', firefox: '25', safari: '6' },
    'URL.createObjectURL': { chrome: '1', firefox: '1', safari: '1' },
    'matchMedia': { chrome: '1', firefox: '1', safari: '1' },
  }),
});

test('the matrix is complete and internally consistent', () => {
  for (const [feature, engines] of Object.entries({ ...MATRIX.css, ...MATRIX.js })) {
    for (const engine of ['chrome', 'firefox', 'safari']) {
      assert.ok(engines[engine] !== undefined, `${feature} pins a ${engine} minimum`);
      assert.match(engines[engine], /^\d+(\.\d+)?$/, `${feature}/${engine} is a version`);
    }
    assert.ok(engines.note === undefined || typeof engines.note === 'string',
      `${feature} notes are strings`);
  }
  // The two documented floors carry their degradation notes.
  assert.match(MATRIX.css['color-mix()'].note, /THE FLOOR/, 'the color-mix floor is flagged');
  assert.match(MATRIX.js['form.requestSubmit'].note, /fallback/, 'the requestSubmit fallback is flagged');
});

test('the css inventory stays inside the documented matrix', () => {
  const documented = ['calc(', 'env(', 'minmax(', 'repeat(', 'min(', 'color-mix(', 'inset(', 'not('];
  for (const fn of cssText.match(/[a-z-]+\(/g) ?? []) {
    if (/^((rgb|hsl|url|var|translate|scale|translateX|translateY|rotate)\()/.test(fn)) continue;
    assert.ok(documented.includes(fn),
      `undocumented CSS function "${fn}" — extend MATRIX.css and this gate`);
  }
  for (const atRule of cssText.match(/@[\w-]+/g) ?? []) {
    assert.ok(['@media', '@import'].includes(atRule), `undocumented at-rule "${atRule}"`);
  }
  // The features the matrix pins must actually be present (no stale rows).
  for (const feature of ['color-mix(', ':focus-visible', 'scrollbar-width', '::-webkit-scrollbar', '-webkit-tap-highlight-color', 'prefers-reduced-motion', 'clip-path']) {
    assert.ok(cssText.includes(feature), `${feature} is still used (the matrix row is live)`);
  }
});

test('the js inventory stays inside the documented matrix', () => {
  // Every file is a module; the syntax floors are the pinned ones.
  assert.ok(jsText.includes('?.') && jsText.includes('??'),
    'the optional-chaining/nullish floors are still in use');
  assert.ok(!/\bclass\s+\w+\s*\{[^}]*#[\w]/.test(jsText), 'no private class fields (an extra syntax floor)');
  assert.ok(!/Object\.groupBy|\.findLast\(|\.toSorted\(/.test(jsText),
    'no post-2023 instance helpers (the matrix floor stands)');
  assert.ok(!/require\(/.test(jsText), 'no CommonJS in the client');
});

test('the documented fallbacks exist in code', async () => {
  const clipboard = await readFile(path.join(jsDir, 'clipboard.js'), 'utf8');
  assert.match(clipboard, /execCommand/, 'the clipboard fallback path exists (Safari/older)');
  const keyboard = await readFile(path.join(jsDir, 'keyboard.js'), 'utf8');
  assert.match(keyboard, /dispatchEvent\(new Event\('submit'/,
    'the requestSubmit fallback exists (Safari < 16)');
  assert.match(cssText, /scrollbar-width:\s*none;/, 'the standard scrollbar path exists');
  assert.match(cssText, /\*::-webkit-scrollbar/, 'the webkit scrollbar path exists');
});

/**
 * Contrast gate (task 126) — the MAIN TEXT must clear 17.05:1 against
 * the effective page background (WCAG AAA is 7:1; the project bar is
 * higher than the standard).
 *
 * The facts that shaped the implementation:
 *   - the six palette values and their mapping are FROZEN (task 123):
 *     --text #F4EFE6 on the raw --bg #101114 measures 16.48:1 — short
 *     of the 17.05:1 bar (and --text on --surface is 13.82:1);
 *   - therefore the only palette-compliant lever is a DERIVED page
 *     background (the sanctioned Layer-2 color-mix mechanism, exactly
 *     how --line/--surface-hi/--focus-ring are derived): --bg-page =
 *     color-mix(in srgb, var(--bg) 65%, black) -> rgb(10,11,13),
 *     measured 17.19:1 (the 70/30 mix cleared the bar by only 0.04 —
 *     inside rounding noise — so 65/35 was chosen for margin).
 *
 * The gates:
 *   - MEASURED RATIO: the effective 8-bit background colour (the same
 *     rounding a browser performs on the color-mix result) is computed
 *     from first principles (WCAG 2.x relative luminance) and must
 *     clear 17.05:1 against the frozen --text;
 *   - NECESSITY: the raw --text-on---bg pairing must measure BELOW the
 *     bar — proving the derivation is required, not decorative;
 *   - TOKEN FORM: --bg-page is declared exactly as the palette-compliant
 *     color-mix (references --bg, mixes the `black` keyword, no hex);
 *   - WIRING: every TEXT-BEARING background in main.css (body, the
 *     input/select/button controls, the .output-text reading surface)
 *     styles with var(--bg-page) and NO rule keeps `background:
 *     var(--bg)`; the frozen --bg remains consumed by the non-text
 *     iframe backdrop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const TOKENS_CSS = path.join(CLIENT, 'src', 'css', 'tokens.css');
const MAIN_CSS = path.join(CLIENT, 'src', 'css', 'main.css');

const PROJECT_BAR = 17.05;
const WCAG_AAA = 7;
const TEXT_HEX = '#f4efe6'; // the frozen --text (task 123)
const BG_CHANNELS = [0x10, 0x11, 0x14]; // the frozen --bg (task 123)
const BG_KEEP = 0.65; // color-mix(in srgb, var(--bg) 65%, black)

/** WCAG 2.x relative luminance of one 8-bit sRGB channel. */
function channelLuminance(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an 8-bit sRGB triple. */
function luminance([r, g, b]) {
  return 0.2126 * channelLuminance(r)
    + 0.7152 * channelLuminance(g)
    + 0.0722 * channelLuminance(b);
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** WCAG 2.x contrast ratio (always >= 1, order-independent). */
function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokensCss = await readFile(TOKENS_CSS, 'utf8');
const mainCss = (await readFile(MAIN_CSS, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

test('the main text clears 17.05:1 on the effective page background', () => {
  // The colour a browser actually renders for the color-mix result,
  // quantised to 8 bits per channel.
  const effective = BG_CHANNELS.map((c) => Math.round(c * BG_KEEP));
  const ratio = contrastRatio(hexToRgb(TEXT_HEX), effective);
  assert.ok(ratio >= PROJECT_BAR,
    `--text on --bg-page must be >= ${PROJECT_BAR}:1, measured ${ratio.toFixed(2)}:1`);
  assert.ok(ratio >= WCAG_AAA, 'clears the WCAG AAA floor (7:1) as well');
});

test('the derivation is NECESSARY: the raw pairing misses the bar', () => {
  const naive = contrastRatio(hexToRgb(TEXT_HEX), BG_CHANNELS);
  assert.ok(naive < PROJECT_BAR,
    `the frozen --text-on---bg measures ${naive.toFixed(2)}:1 — below ${PROJECT_BAR}, ` +
    'which is exactly why --bg-page exists');
  assert.ok(naive >= WCAG_AAA,
    'and it still clears the WCAG AAA floor, so the palette itself stays legal');
});

test('--bg-page is declared as the palette-compliant color-mix', () => {
  const decl = tokensCss.match(/--bg-page:\s*([^;]+);/);
  assert.ok(decl, '--bg-page is declared in tokens.css');
  assert.equal(decl[1].trim(), 'color-mix(in srgb, var(--bg) 65%, black)',
    'the derived background references --bg and the `black` keyword — no hex literal');
  assert.ok(!/#[0-9a-fA-F]/.test(decl[1]), 'no hex literal inside the derivation');
});

test('every text-bearing background styles with --bg-page', () => {
  const rules = [...mainCss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));

  const textBearing = rules.filter(({ selector }) =>
    selector === 'body'
    || selector === 'input,\nselect,\nbutton'
    || selector === '.output-text');
  assert.equal(textBearing.length, 3, 'body, the controls and the reading surface found');

  for (const { selector, body } of textBearing) {
    assert.match(body, /background:\s*var\(--bg-page\);/,
      `${selector.replace(/\n/g, ' ')}: backgrounds the text with --bg-page`);
  }
  // The frozen --bg remains a real consumer — but ONLY as the NON-TEXT
  // iframe backdrop (the sandboxed print document carries its own bg).
  const frame = rules.find(({ selector }) => selector === '.output-frame');
  assert.ok(frame, 'the iframe backdrop rule exists');
  assert.match(frame.body, /background:\s*var\(--bg\);/,
    'the iframe backdrop still consumes the frozen --bg token');
  const textRuleBodies = textBearing.map(({ body }) => body).join('\n');
  assert.ok(!/background:\s*var\(--bg\);/.test(textRuleBodies),
    'no TEXT-BEARING rule keeps the raw --bg as its background');
});

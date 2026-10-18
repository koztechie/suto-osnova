/**
 * Contrast gate (tasks 126-127) — the project's contrast bars, both
 * higher than the WCAG floors:
 *
 *   MAIN TEXT on the page floor      >= 17.05:1 (WCAG AAA is 7:1)
 *   GOLD interactive on slate cards  >=  7.26:1 (WCAG AAA is 7:1)
 *   SECONDARY labels on slate plaques >= 6.15:1 (WCAG AA is 4.5:1)
 *
 * The facts that shaped the implementations:
 *   - the six palette values and their mapping are FROZEN (task 123):
 *     --text #F4EFE6 on the raw --bg #101114 measures 16.48:1 — short
 *     of the 17.05:1 bar (and --text on --surface is 13.82:1);
 *     --gold #D4A853 on the raw --surface #1F2326 is 7.18:1 — short of
 *     the 7.26:1 bar (and the old surface-hi button bed was 4.74:1);
 *   - therefore the only palette-compliant levers are DERIVED tones
 *     (the sanctioned Layer-2 color-mix mechanism, exactly how
 *     --line/--focus-ring are derived): --bg-page = 65% bg + 35% black
 *     -> 17.19:1 for the main text; --gold-hi = 85% gold + 15% white
 *     -> 8.15:1 for interactive gold on the slate.
 *
 * The gates:
 *   - MEASURED RATIOS: each effective 8-bit colour (the same rounding
 *     a browser performs on a color-mix result) is computed from first
 *     principles (WCAG 2.x relative luminance) and must clear its bar;
 *   - NECESSITY: each raw frozen pairing must measure BELOW its bar
 *     (while still clearing the applicable WCAG floor — AAA for the
 *     main text and gold, AA for the muted labels) — proving the
 *     derivations are required, not decorative;
 *   - TOKEN FORMS: each derived token is declared exactly as its
 *     palette-compliant color-mix (references a palette token, uses a
 *     colour keyword, contains no hex literal);
 *   - WIRING: every consumer styles via the right TOKEN pair
 *     (--text on --bg-page; --gold-hi on --surface), the frozen
 *     pairings keep only their legal non-text/upper-floor roles, and
 *     no token is left dead.
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
// Declarations are parsed from the COMMENT-STRIPPED sheet: contract
// prose may mention a token name followed by a colon (e.g. "--bg-page
// at 7.53:1"), which a naive match would treat as a declaration and
// swallow the NEXT real one up to its semicolon.
const tokensCssBare = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
const mainCss = (await readFile(MAIN_CSS, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

/** Parse `selector { body }` pairs (comments already stripped). */
function parseRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

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
  const decl = tokensCssBare.match(/--bg-page:\s*([^;]+);/);
  assert.ok(decl, '--bg-page is declared in tokens.css');
  assert.equal(decl[1].trim(), 'color-mix(in srgb, var(--bg) 65%, black)',
    'the derived background references --bg and the `black` keyword — no hex literal');
  assert.ok(!/#[0-9a-fA-F]/.test(decl[1]), 'no hex literal inside the derivation');
});

test('every text-bearing background styles with --bg-page', () => {
  const rules = parseRules(mainCss);

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

// --- Gold interactive elements on slate cards (task 127) -------------

const GOLD_HEX = '#d4a853'; // the frozen --gold (task 123)
const SLATE_CHANNELS = [0x1f, 0x23, 0x26]; // the frozen --surface
const SLATE_BAR = 7.26;
const GOLD_KEEP = 0.85; // color-mix(in srgb, var(--gold) 85%, white)

test('the raw gold-on-slate pairing misses the 7.26:1 bar', () => {
  const naive = contrastRatio(hexToRgb(GOLD_HEX), SLATE_CHANNELS);
  assert.ok(naive < SLATE_BAR,
    `the frozen --gold on the frozen --surface measures ${naive.toFixed(2)}:1 — below ` +
    `${SLATE_BAR}, which is exactly why --gold-hi exists`);
  assert.ok(naive >= WCAG_AAA, 'and it still clears the WCAG AAA floor (7:1)');
});

test('--gold-hi is declared as the palette-compliant color-mix', () => {
  const decl = tokensCssBare.match(/--gold-hi:\s*([^;]+);/);
  assert.ok(decl, '--gold-hi is declared in tokens.css');
  assert.equal(decl[1].trim(), 'color-mix(in srgb, var(--gold) 85%, white)',
    'the lifted gold references --gold and the `white` keyword — no hex literal');
  assert.ok(!/#[0-9a-fA-F]/.test(decl[1]), 'no hex literal inside the derivation');
});

test('interactive gold clears 7.26:1 on the slate card', () => {
  // The colour a browser actually renders, quantised to 8 bits.
  const effective = hexToRgb(GOLD_HEX)
    .map((c) => Math.round(c * GOLD_KEEP + 255 * (1 - GOLD_KEEP)));
  const ratio = contrastRatio(effective, SLATE_CHANNELS);
  assert.ok(ratio >= SLATE_BAR,
    `--gold-hi on --surface must be >= ${SLATE_BAR}:1, measured ${ratio.toFixed(2)}:1`);
  assert.ok(ratio >= WCAG_AAA, 'clears the WCAG AAA floor (7:1) as well');
});

test('gold-on-slate consumers use --gold-hi on --surface', () => {
  const rules = parseRules(mainCss);

  const button = rules.find(({ selector }) => selector === 'button');
  assert.ok(button, 'the button rule exists');
  assert.match(button.body, /color:\s*var\(--gold-hi\);/,
    'the button label is the lifted gold');
  assert.match(button.body, /background:\s*var\(--surface\);/,
    'the button sits on the slate card itself (never a lighter slate bed)');

  const okStatus = rules.find(({ selector }) => selector === '.status[data-tone="ok"]');
  assert.ok(okStatus, 'the ok-status rule exists');
  assert.match(okStatus.body, /color:\s*var\(--gold-hi\);/,
    'gold status text on the slate panel uses the lifted gold');

  // The frozen --gold keeps only its legal role: gold on the PAGE
  // FLOOR (the brand heading on --bg-page: 8.93:1) and non-text UI
  // borders (hover/focus outlines on slate: 7.18:1 — no text involved).
  const brand = rules.find(({ selector }) => selector === '.brand');
  assert.ok(brand, 'the brand rule exists');
  assert.match(brand.body, /color:\s*var\(--gold\);/,
    'the brand heading keeps the frozen --gold on --bg-page');
  const interactiveBodies = [button.body, okStatus.body].join('\n');
  assert.ok(!/color:\s*var\(--gold\);/.test(interactiveBodies),
    'no gold-on-slate TEXT rule keeps the raw (7.18:1) --gold');
});

// --- Secondary labels on slate plaques (task 128) --------------------

const MUTED_HEX = '#96a2a8'; // the frozen --muted (task 123)
const MUTED_BAR = 6.15;
const MUTED_KEEP = 0.9; // color-mix(in srgb, var(--muted) 90%, white)

test('the raw muted-on-slate pairing misses the 6.15:1 bar', () => {
  const naive = contrastRatio(hexToRgb(MUTED_HEX), SLATE_CHANNELS);
  assert.ok(naive < MUTED_BAR,
    `the frozen --muted on the frozen --surface measures ${naive.toFixed(2)}:1 — below ` +
    `${MUTED_BAR}, which is exactly why --muted-hi exists`);
  assert.ok(naive >= 4.5,
    'and it clears the WCAG AA floor (4.5:1) — this pairing was AA-legal, just short of the bar');
});

test('--muted-hi is declared as the palette-compliant color-mix', () => {
  const decl = tokensCssBare.match(/--muted-hi:\s*([^;]+);/);
  assert.ok(decl, '--muted-hi is declared in tokens.css');
  assert.equal(decl[1].trim(), 'color-mix(in srgb, var(--muted) 90%, white)',
    'the lifted muted references --muted and the `white` keyword — no hex literal');
  assert.ok(!/#[0-9a-fA-F]/.test(decl[1]), 'no hex literal inside the derivation');
});

test('secondary labels clear 6.15:1 on the slate plaque', () => {
  // The colour a browser actually renders, quantised to 8 bits.
  const effective = hexToRgb(MUTED_HEX)
    .map((c) => Math.round(c * MUTED_KEEP + 255 * (1 - MUTED_KEEP)));
  const ratio = contrastRatio(effective, SLATE_CHANNELS);
  assert.ok(ratio >= MUTED_BAR,
    `--muted-hi on --surface must be >= ${MUTED_BAR}:1, measured ${ratio.toFixed(2)}:1`);
  // Hierarchy stays legible: the lifted muted must remain clearly
  // BELOW the main text on the same slate (secondary vs primary).
  const textOnSlate = contrastRatio(hexToRgb(TEXT_HEX), SLATE_CHANNELS);
  assert.ok(ratio < textOnSlate / 2,
    'the secondary label stays less than half the primary contrast (hierarchy intact)');
});

test('slate-plaque labels use --muted-hi; the page floor keeps --muted', () => {
  const rules = parseRules(mainCss);

  for (const selector of ['label', '.status', '.output-empty', '.panel-heading', '.tab-label', '.mode-legend', '.suggestion', '.presets-label', '.preset']) {
    const rule = rules.find((r) => r.selector === selector);
    assert.ok(rule, `the ${selector} rule exists`);
    assert.match(rule.body, /color:\s*var\(--muted-hi\);/,
      `${selector} sits on a slate plaque and labels with --muted-hi`);
  }

  // Legal frozen-@--muted roles: ON THE PAGE FLOOR (--bg-page: 7.53:1).
  for (const selector of ['.tagline', '.site-footer']) {
    const rule = rules.find((r) => r.selector === selector);
    assert.match(rule.body, /color:\s*var\(--muted\);/,
      `${selector} lives on --bg-page and keeps the frozen --muted`);
  }
  const placeholder = rules.find((r) => r.selector === 'input::placeholder');
  assert.match(placeholder.body, /color:\s*var\(--muted\);/,
    'placeholders sit on the --bg-page control bed and keep --muted');

  // The disabled button sits on slate but is WCAG-EXEMPT and must
  // still READ as disabled — it deliberately keeps the dimmer --muted.
  const disabled = rules.find((r) => r.selector === 'button:disabled');
  assert.match(disabled.body, /color:\s*var\(--muted\);/,
    'disabled controls are contrast-exempt and keep the dim --muted');

  // The rust error channel is NOT a secondary label (semantic accent):
  // pinned here at its own floor — WCAG AA for normal text (4.5:1).
  const errorStatus = rules.find((r) => r.selector === '.status[data-tone="error"]');
  const rustOnSlate = contrastRatio(hexToRgb('#e06338'), SLATE_CHANNELS);
  assert.match(errorStatus.body, /color:\s*var\(--rust\);/,
    'the error tone keeps the frozen --rust');
  assert.ok(rustOnSlate >= 4.5,
    `the rust error channel clears WCAG AA on slate (${rustOnSlate.toFixed(2)}:1)`);
});

test('the degraded titlebar label clears WCAG AA on the page floor', () => {
  // The status titlebar lives on --bg-page (the page floor), not on
  // slate — its degraded warning label is frozen --rust text there.
  const floor = BG_CHANNELS.map((c) => Math.round(c * BG_KEEP));
  const ratio = contrastRatio(hexToRgb('#e06338'), floor);
  assert.ok(ratio >= 4.5,
    `--rust on --bg-page must clear WCAG AA (4.5:1), measured ${ratio.toFixed(2)}:1`);
});

/**
 * Responsive layout gate (task 152) — pins the full responsiveness for
 * the two target classes:
 *
 *   - SMARTPHONE 1080x2400 (physical): at DPR 2.6-3 that is ~360-412
 *     CSS px — the SMALL-VIEWPORT band. The gate pins the 420px
 *     refinement block (tighter workspace padding, tab labels, chips,
 *     the inspector panel) so nothing overflows in the 320-420 band;
 *   - MONITORS 1920x1080/1200: the DESKTOP COMPOSITION — the
 *     workspace is capped (max-width) and centered (margin-inline
 *     auto) so the results column stays readable instead of
 *     stretching to the bezel; below the cap it is full width;
 *   - CLOSED BREAKPOINT MAP: main.css may contain ONLY the documented
 *     max-width queries (880px = the two-column stack, 420px = the
 *     small-viewport refinement) — ad-hoc breakpoint sprawl fails;
 *   - ADAPTIVE GRIDS: every column container in the client is fluid —
 *     auto-fit/auto-fill minmax tracks, equal fr tracks or wrapped
 *     flex — never a fixed pixel column that could overflow at 320.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const cardsCss = (await readFile(path.join(CLIENT, 'src', 'css', 'cards.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
// The column grids of the featured cards live in cards.css; the
// workspace chrome lives in main.css — consult both.
const both = `${css}\n${cardsCss}`;

const rule = (selector, sheet = css) =>
  sheet.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? null;

test('the breakpoint map is CLOSED: exactly 880px and 420px', async () => {
  const dir = fileURLToPath(new URL('../client/src/css', import.meta.url));
  const sheets = (await readdir(dir)).filter((f) => f.endsWith('.css'));
  const found = [];
  for (const sheet of sheets) {
    const text = (await readFile(path.join(dir, sheet), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, value] of text.matchAll(/@media\s*\(max-width:\s*([\d.]+px)\)/g)) {
      found.push(value);
    }
  }
  assert.deepEqual([...new Set(found)].sort(), ['420px', '880px'],
    'only the two documented max-width queries exist across ALL sheets (no ad-hoc sprawl)');
});

test('the desktop composition: capped and centered at 1920/1200', () => {
  const body = rule('\\.workspace');
  assert.match(body, /max-width:\s*100rem;/,
    'the workspace is capped (1920/1200 stay composed, not stretched)');
  assert.match(body, /margin-inline:\s*auto;/, 'and centered under the cap');
});

test('the 880px stack and the 420px small-viewport refinement', () => {
  const stack = css.match(/@media \(max-width: 880px\) \{\s*\.workspace\s*\{([^}]*)\}\s*\}/);
  assert.ok(stack, 'the two-column collapse query exists');
  assert.match(stack[1], /grid-template-columns:\s*1fr;/, 'and collapses to one column');

  const small = css.match(/@media \(max-width: 420px\) \{([\s\S]*?)\n\}/);
  assert.ok(small, 'the small-viewport refinement block exists (1080x2400 phones)');
  for (const [selector, probe, description] of [
    ['\\.workspace', /padding:\s*1rem 0\.75rem;/, 'tighter workspace padding'],
    ['\\.tab-label', /font-size:\s*0\.7rem;/, 'smaller tab labels'],
    ['\\.preset,\\s*\\.action', /padding:\s*0\.35rem 0\.55rem;/, 'tighter chips (presets/actions)'],
    ['\\.inspector-panel', /padding:\s*0\.9rem;/, 'tighter inspector panel'],
  ]) {
    const body = small[1].match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    assert.match(body, probe, `${selector.replace(/\\/g, '')} gets ${description}`);
  }
});

test('every column container is fluid (no fixed pixel columns)', () => {
  // Grid containers: auto-fit/auto-fill minmax or equal fr tracks.
  // (The featured-card grids live in cards.css, the chrome in main.)
  for (const [selector, pattern] of [
    ['\\.domain-grid', /repeat\(auto-fill, minmax\(/],
    ['\\.sonic-columns', /repeat\(auto-fit, minmax\(/],
    ['\\.literary-columns', /repeat\(auto-fit, minmax\(/],
    ['\\.material-columns', /repeat\(auto-fit, minmax\(/],
    ['\\.gastronomy-columns', /repeat\(auto-fit, minmax\(/],
    ['\\.visual-columns', /repeat\(auto-fit, minmax\(/],
    ['\\.tab-bar', /repeat\(3, 1fr\)/],
    ['\\.affinity-row', /minmax\(/],
  ]) {
    const body = rule(selector, both) ?? '';
    assert.match(body, pattern, `${selector.replace(/\\/g, '')} adapts with the viewport`);
  }

  // Flex rows wrap instead of overflowing.
  for (const selector of ['\\.titlebar', '\\.presets', '\\.actions', '\\.site-nav']) {
    const body = rule(selector) ?? '';
    assert.match(body, /flex-wrap:\s*wrap;/, `${selector.replace(/\\/g, '')} wraps`);
  }

  // The two-column layout only exists above the stack, so its 320px
  // controls floor can never meet a narrow screen.
  const workspace = rule('\\.workspace');
  assert.match(workspace, /grid-template-columns:\s*minmax\(320px, 420px\)/,
    'the desktop controls column keeps its bounded track');
});

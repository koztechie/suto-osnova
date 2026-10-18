/**
 * Main workspace layout gate (task 137) — pins the results-display
 * workspace: a TWO-COLUMN grid on desktop that COLLAPSES into a
 * vertical stack on mobile.
 *
 *   - DESKTOP: .workspace is a grid with exactly two tracks — a
 *     bounded controls column and an OVERFLOW-SAFE results column
 *     (minmax(0, 1fr): it can shrink below its content's min-width,
 *     so long unbroken lines can never blow the layout out);
 *   - MOBILE: the pinned 880px media query collapses the grid to ONE
 *     track (1fr) — the panels stack vertically;
 *   - SOURCE ORDER: the controls section PRECEDES the results panel
 *     inside <main>, so the mobile stack reads inputs-first,
 *     results-second (the right order on a phone);
 *   - THE RESULTS ZONE: #output-panel is the second main child and
 *     hosts the three display modes (sandboxed iframe / preformatted
 *     text / empty state) with a desktop min-height and bounded
 *     internal scrolling (the column scrolls, the page does not
 *     explode).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');

const rule = (selector) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? null;

test('desktop: a two-column grid with an overflow-safe results column', () => {
  const body = rule('\\.workspace');
  assert.ok(body, 'the workspace rule exists');
  assert.match(body, /display:\s*grid;/, 'the workspace is a grid');

  const columns = body.match(/grid-template-columns:\s*([^;]+);/)[1].trim();
  // Tracks may contain spaces inside minmax(...) — parse by parens,
  // never by naive whitespace splitting.
  const tracks = columns.match(/minmax\([^)]*\)|\S+/g);
  assert.equal(tracks.length, 2, `exactly two desktop columns, got "${columns}"`);

  const [controls, results] = tracks;
  assert.match(controls, /^minmax\(\d+px, \d+px\)$/,
    'the controls column is a bounded minmax track');
  assert.equal(results, 'minmax(0, 1fr)',
    'the results column can SHRINK below its content (overflow-safe)');
  assert.match(body, /gap:\s*[\d.]+rem;/, 'the columns are gapped');
});

test('mobile: the pinned breakpoint collapses to a vertical stack', () => {
  const media = css.match(/@media \(max-width: (880px)\) \{\s*\.workspace\s*\{([^}]*)\}\s*\}/);
  assert.ok(media, 'a max-width media query targets .workspace at the pinned 880px');
  const columns = media[2].match(/grid-template-columns:\s*([^;]+);/)[1].trim();
  assert.equal(columns, '1fr', 'one track: the panels stack vertically');
});

test('source order: inputs first, results second (mobile stack order)', () => {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(main, 'the main workspace exists');
  const controlsAt = main[1].indexOf('class="panel controls"');
  const resultsAt = main[1].indexOf('id="output-panel"');
  assert.ok(controlsAt >= 0 && resultsAt >= 0, 'both panels live inside main');
  assert.ok(controlsAt < resultsAt,
    'the controls section precedes the results panel (stack shows inputs first)');
});

test('the results zone hosts the three display modes with bounded scroll', () => {
  const panel = html.match(/<section id="output-panel"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(panel, 'the results panel exists');
  for (const node of [
    /<iframe id="output-frame"[\s\S]*?<\/iframe>/,
    /<pre id="output-text"[^>]*><\/pre>/,
    /<p id="output-empty"[^>]*>[\s\S]*?<\/p>/,
  ]) {
    assert.ok(node.test(panel[1]), 'the panel hosts a display mode');
  }

  const panelRule = rule('\\.output-panel');
  assert.match(panelRule, /min-height:\s*[\d.]+rem|min-height:\s*\d+px/,
    'the results zone keeps a desktop presence (min-height)');
  assert.match(panelRule, /display:\s*flex;/, 'the panel lays its modes out as a column');

  const text = rule('\\.output-text');
  assert.match(text, /overflow:\s*auto;/, 'long documents scroll INSIDE the results column');
  assert.match(text, /max-height:\s*[\d.]+vh;/, 'the internal scroll area is bounded');
  assert.match(text, /word-break:\s*break-word;/,
    'unbroken lines wrap instead of expanding the column');
  assert.match(text, /white-space:\s*pre-wrap;/, 'the document keeps its formatting');

  const frame = rule('\\.output-frame');
  assert.match(frame, /width:\s*100%;/, 'the print-document frame fills the column');
});

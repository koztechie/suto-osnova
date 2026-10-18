/**
 * Reduced motion gate (task 154) — pins the system prefers-reduced-
 * motion support with FORCED disabling of transitions and delays:
 *
 *   - CSS GUARDRAIL: a prefers-reduced-motion block force-disables
 *     animation/transition durations and scroll-behavior for the
 *     universal selector. No transition exists in the sheets today
 *     (the design is discrete by contract) — the block neutralises
 *     any FUTURE one the day it lands;
 *   - THE PROGRESS READOUT (the only animated surface): with the
 *     preference active, startProgress NEVER schedules the stepping —
 *     the readout lands on ONE static "working" frame (no interval,
 *     no cap timer, no delay) and stop() empties it; the animated
 *     path stays the default everywhere else;
 *   - prefersReducedMotion is total over its injection (absent
 *     window/matchMedia/non-matching query -> false);
 *   - functional timers (the clipboard label revert, the progress
 *     cap) are NOT motion and are deliberately untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { prefersReducedMotion, startProgress } = await import(
  path.join(CLIENT, 'src', 'js', 'progress.js')
);

const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'progress.js'), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A counting text node. */
function countingElement() {
  const node = { textWrites: 0, _text: '' };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text; },
    set(v) { node.textWrites += 1; node._text = v; },
  });
  return node;
}

const reducedWin = { matchMedia: (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }) };
const normalWin = { matchMedia: () => ({ matches: false }) };

test('the css guardrail force-disables transitions and animations', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(block, 'the prefers-reduced-motion block exists');
  const universal = block[1].match(/\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/);
  assert.ok(universal, 'it targets the universal selector');
  for (const declaration of [
    /animation-duration:\s*0\.01ms !important;/,
    /animation-iteration-count:\s*1 !important;/,
    /transition-duration:\s*0\.01ms !important;/,
    /scroll-behavior:\s*auto !important;/,
  ]) {
    assert.match(universal[1], declaration, 'each forced disable is pinned');
  }
});

test('prefersReducedMotion: total over its injection', () => {
  assert.equal(prefersReducedMotion(reducedWin), true, 'the matching query says true');
  assert.equal(prefersReducedMotion(normalWin), false, 'a non-matching query says false');
  assert.equal(prefersReducedMotion({}), false, 'an absent matchMedia says false');
  assert.equal(prefersReducedMotion(undefined), false,
    'no window at all (Node) says false — the animated default');
});

test('reduced motion: ONE static frame, zero timers, zero delays', async () => {
  const element = countingElement();
  const stop = startProgress({ element, intervalMs: 5, maxDurationMs: 20, win: reducedWin });
  assert.equal(element.textWrites, 1, 'exactly one write — the static frame');
  assert.equal(element.textContent, '[----------] working',
    'the honest "still working" signal WITHOUT the motion');

  await sleep(40); // well past the interval AND the cap
  assert.equal(element.textWrites, 1,
    'no interval and no cap timer were EVER scheduled (delays disabled)');

  stop();
  assert.equal(element.textContent, '', 'stop() still empties the readout');
});

test('the default path keeps the animated stepping', async () => {
  const element = countingElement();
  const stop = startProgress({ element, intervalMs: 5, maxDurationMs: 400, win: normalWin });
  assert.equal(element.textWrites, 1, 'the first frame lands');
  await sleep(25);
  assert.ok(element.textWrites > 1, 'the stepping advances (the preference is absent)');
  stop();
});

test('discipline: the preference is read at start, zero innerHTML', () => {
  assert.match(source, /export function prefersReducedMotion\(win\)/,
    'the media query helper is exported (pure over injection)');
  assert.match(source, /if \(prefersReducedMotion\(win\)\) \{/,
    'startProgress branches on it BEFORE scheduling anything');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'zero innerHTML');
});

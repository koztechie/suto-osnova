/**
 * Terminal progress indicator gate (task 136) — pins the discrete
 * loading readout shown while the taste graph is polled:
 *
 *   - PURE FRAMES: barFrame/spinnerFrame/progressFrame are exact and
 *     TOTAL (wrap-around for any tick, negative included), ASCII-only
 *     (zero pictographs — the repo-wide emoji probe's sibling);
 *   - BEHAVIOUR: the readout starts on the FIRST frame immediately,
 *     STEPS on the interval (discrete, never smooth), stop() empties
 *     the element, and the motion HARD-CAPS into a STATIC "still
 *     working" frame (WCAG 2.2.2: moving content cannot run forever);
 *   - DECORATIVE: the element sits OUTSIDE the aria-live status line
 *     with aria-hidden (WCAG 4.1.3 — no 160ms announcements);
 *   - STYLE: the mono technical stack (task 125) + lifted gold on the
 *     slate plaque (task-127 family), white-space:pre so the frames
 *     keep their spacing;
 *   - WIRING: main.js starts it on submit and stops it in finally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  barFrame, spinnerFrame, progressFrame, startProgress,
  SPIN_FRAMES, PROGRESS_INTERVAL_MS, PROGRESS_MAX_DURATION_MS,
} = await import(path.join(CLIENT, 'src', 'js', 'progress.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const css = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('frames are exact, total and ASCII-only', () => {
  assert.equal(barFrame(0), '[----------]', 'tick 0: an empty bar');
  assert.equal(barFrame(1), '[#---------]', 'tick 1: one step filled');
  assert.equal(barFrame(10), '[##########]', 'tick 10: full');
  assert.equal(barFrame(11), '[----------]', 'tick 11: wraps around');
  assert.equal(barFrame(12), '[#---------]', 'tick 12: the cycle repeats');
  assert.equal(barFrame(-1), '[##########]', 'negative ticks are total (pos 10)');

  assert.deepEqual([...SPIN_FRAMES], ['|', '/', '-', '\\'], 'the classic spinner set');
  assert.equal(spinnerFrame(0), '|');
  assert.equal(spinnerFrame(4), '|', 'the spinner wraps');
  assert.equal(progressFrame(3), '[###-------] \\', 'bar + spinner compose (tick 3 = backslash)');

  for (let tick = -2; tick < 20; tick += 1) {
    assert.match(progressFrame(tick), /^[\[\]#\-|\\/ ]+$/,
      `frame ${tick} is pure ASCII terminal glyphs`);
  }
});

test('behaviour: steps discretely, stops and empties, caps the motion', async () => {
  const element = { textContent: '' };

  const stop = startProgress({ element, intervalMs: 10, maxDurationMs: 400 });
  assert.equal(element.textContent, progressFrame(0), 'the first frame lands immediately');

  await sleep(35);
  assert.notEqual(element.textContent, progressFrame(0), 'the readout has stepped');
  assert.match(element.textContent, /^[\[\]#\-|\\/ ]+$/, 'still pure ASCII while running');

  stop();
  const afterStop = element.textContent;
  assert.equal(afterStop, '', 'stop() EMPTIES the element (the request settled)');
  await sleep(30);
  assert.equal(element.textContent, '', 'and no timer keeps writing');

  // The motion hard-cap: after maxDuration the readout FREEZES into a
  // static frame and never advances again (WCAG 2.2.2).
  const capped = { textContent: '' };
  const stopCap = startProgress({ element: capped, intervalMs: 10, maxDurationMs: 40 });
  await sleep(90);
  assert.equal(capped.textContent, `${barFrame(0)} still working`,
    'the capped frame is the static "still working" readout');
  await sleep(30);
  assert.equal(capped.textContent, `${barFrame(0)} still working`,
    'the capped readout never moves again');
  stopCap();

  // A missing element degrades to a noop handle.
  assert.equal(typeof startProgress({}), 'function');
});

test('the readout is decorative: outside the live region, aria-hidden', () => {
  const status = html.match(/<p id="status"[^>]*>[\s\S]*?<\/p>/);
  assert.ok(status, 'the status live region exists');
  assert.ok(!status[0].includes('id="progress"'),
    'the readout is NOT inside the aria-live status line (no announcement spam)');

  const progress = html.match(/<span id="progress" class="progress" aria-hidden="true"><\/span>/);
  assert.ok(progress, 'the readout element exists, aria-hidden (decorative motion)');
});

test('style: mono technical stack, lifted gold, frames keep spacing', () => {
  const rule = css.match(/\.progress\s*\{[^}]*\}/);
  assert.ok(rule, 'the readout rule exists');
  assert.ok(rule[0].includes('font-family: var(--font-mono);'),
    'the technical mono stack (task 125)');
  assert.ok(rule[0].includes('color: var(--gold-hi);'),
    'lifted gold on the slate plaque (task-127 family, 8.15:1)');
  assert.ok(rule[0].includes('white-space: pre'),
    'pre keeps the discrete frame spacing');
});

test('wiring: started on submit, stopped in finally', () => {
  assert.match(main, /import \{ startProgress \} from '\.\/progress\.js';/,
    'main.js imports the indicator');
  const onSubmit = main.match(/async function onSubmit[\s\S]*?\n}/);
  assert.ok(onSubmit, 'the submit handler exists');
  assert.match(onSubmit[0], /startProgress\(\{/, 'the indicator starts per request');
  assert.match(onSubmit[0], /finally \{[\s\S]*stopProgress\(\)/,
    'and is stopped in finally — success AND failure');
});

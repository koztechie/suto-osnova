/**
 * SUTO OSNOVA — terminal progress indicator (task 136).
 * A DISCRETE monospace progress readout shown while the agent polls
 * the taste graph: a stepping ASCII bar plus a rotating spinner frame
 * (`[####----] |`), advanced on a fixed interval — discrete frames,
 * never a smooth animation, never an emoji.
 *
 * Contracts:
 *   - DECORATIVE MOTION: the readout lives OUTSIDE the aria-live
 *     status line (aria-hidden) — screen readers hear the ONE status
 *     message, not a 160ms metronome (WCAG 4.1.3);
 *   - BOUNDED MOTION: the animation runs only while a request is in
 *     flight AND hard-caps at PROGRESS_MAX_DURATION_MS into a STATIC
 *     "still working" frame — moving content can never run forever
 *     (WCAG 2.2.2);
 *   - ASCII ONLY: frames match ^[\[\]#\-|\\/ ]+$ — zero Unicode
 *     pictographs anywhere;
 *   - PURE GENERATION: barFrame/spinnerFrame/progressFrame are pure
 *     and unit-pinned; startProgress only schedules them.
 *
 * Import-safe in Node: no document at load; the element is injected.
 */

/** How often the readout steps to the next frame. */
export const PROGRESS_INTERVAL_MS = 160;

/** Motion hard-cap: after this, the readout freezes (WCAG 2.2.2). */
export const PROGRESS_MAX_DURATION_MS = 30_000;

/** The rotating spinner frames (classic terminal set). */
export const SPIN_FRAMES = Object.freeze(['|', '/', '-', '\\']);

/** The stepping bar for a tick: filled '#' up to the step, '-' after. */
export function barFrame(tick, width = 10) {
  const period = width + 1;
  const pos = ((tick % period) + period) % period; // total even for negatives
  return `[${'#'.repeat(pos)}${'-'.repeat(width - pos)}]`;
}

/** The rotating spinner char for a tick. */
export function spinnerFrame(tick) {
  return SPIN_FRAMES[((tick % 4) + 4) % 4];
}

/** One full discrete frame: bar + spinner. */
export function progressFrame(tick, width = 10) {
  return `${barFrame(tick, width)} ${spinnerFrame(tick)}`;
}

/**
 * Start the readout on an element. Returns a stop() handle that clears
 * every timer and EMPTIES the element (the request settled).
 */
export function startProgress({
  element,
  intervalMs = PROGRESS_INTERVAL_MS,
  maxDurationMs = PROGRESS_MAX_DURATION_MS,
} = {}) {
  if (!element) return () => {};
  let tick = 0;
  let capped = false;

  element.textContent = progressFrame(0);

  const interval = setInterval(() => {
    if (capped) return;
    tick += 1;
    element.textContent = progressFrame(tick);
  }, intervalMs);

  const cap = setTimeout(() => {
    // Freeze into a static frame: motion is bounded, the honest
    // "still working" signal remains.
    capped = true;
    clearInterval(interval);
    element.textContent = `${barFrame(0)} still working`;
  }, maxDurationMs);

  return () => {
    clearInterval(interval);
    clearTimeout(cap);
    element.textContent = '';
  };
}

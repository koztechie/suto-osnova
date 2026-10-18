/**
 * SUTO OSNOVA — clipboard with instant feedback (task 147).
 * Copy text FRAGMENTS to the clipboard; the clicked button itself is
 * the indicator (its label swaps to "Copied"/"Copy failed" and its
 * data-feedback carries the tone — text FIRST, colour only as a
 * secondary cue: never a colour-only signal).
 *
 * Honesty contracts:
 *   - copyText PREFERS navigator.clipboard.writeText (secure
 *     contexts) and falls back to a hidden textarea + execCommand —
 *     the most portable path in non-secure contexts; if both fail it
 *     returns false and NEVER throws;
 *   - an empty fragment is "Nothing to copy" feedback, never a silent
 *     success;
 *   - the feedback is INSTANT (the label swaps as soon as the copy
 *     settles) and SELF-REVERTING (revertMs, default 1.5s);
 *   - fragments travel as data attributes / return values, written
 *     via setAttribute/textContent (XSS-safe);
 *   - import-safe in Node: clipboard/doc/revert timers injected.
 */

const FEEDBACK = Object.freeze({
  copied: 'Copied',
  failed: 'Copy failed',
  empty: 'Nothing to copy',
});

/** Pure: copy one string; resolves true/false, never rejects. */
export async function copyText(text, { clipboard, doc } = {}) {
  const clip = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  if (clip?.writeText) {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (permission denied, etc.).
    }
  }
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope?.body || typeof scope.execCommand !== 'function') return false;
  try {
    const area = scope.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    scope.body.appendChild(area);
    area.select?.();
    const ok = scope.execCommand('copy');
    area.remove();
    return ok === true;
  } catch {
    return false;
  }
}

async function runCopy(button, text, { clipboard, doc, revertMs }) {
  const original = button.dataset?.original ?? button.textContent;
  if (button.dataset) button.dataset.original = original;
  if (!text) {
    button.textContent = FEEDBACK.empty;
    if (button.dataset) button.dataset.feedback = 'failed';
    scheduleRevert();
    return false;
  }
  const ok = await copyText(text, { clipboard, doc });
  button.textContent = ok ? FEEDBACK.copied : FEEDBACK.failed;
  if (button.dataset) button.dataset.feedback = ok ? 'copied' : 'failed';
  scheduleRevert();
  return ok;

  function scheduleRevert() {
    setTimeout(() => {
      button.textContent = original;
      if (button.dataset) delete button.dataset.feedback;
    }, revertMs);
  }
}

/** Wire ONE known button (e.g. "Copy document"). Returns stop(). */
export function attachCopyButton({
  button,
  getText,
  clipboard,
  doc,
  revertMs = 1500,
} = {}) {
  if (!button) return () => {};
  const onClick = () => {
    const text = typeof getText === 'function' ? getText() : '';
    runCopy(button, text, { clipboard, doc, revertMs });
  };
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}

/**
 * Wire a DELEGATED copy surface: any [data-copy] descendant of root is
 * a copyable fragment (its own button is the indicator). Returns
 * stop().
 */
export function attachCopyDelegation({
  root,
  clipboard,
  doc,
  revertMs = 1500,
} = {}) {
  if (!root?.addEventListener) return () => {};
  const onClick = async (event) => {
    const button = event.target?.closest?.('[data-copy]');
    if (!button || !root.contains(button)) return;
    event.preventDefault?.();
    await runCopy(button, button.getAttribute('data-copy'), { clipboard, doc, revertMs });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export const COPY_FEEDBACK = FEEDBACK;

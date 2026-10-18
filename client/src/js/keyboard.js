/**
 * SUTO OSNOVA — keyboard control (task 149).
 *
 * 1. TAB (the mode switcher): the tab bar is a NATIVE radio group
 *    (task 133) — Tab enters/exits the group in one stop, the arrow
 *    keys rotate between the three tabs, and the gold focus frame is
 *    drawn by the :focus-visible sibling rule. NO custom keydown code
 *    may touch the switcher (interfering would only break what the
 *    platform already provides); this module pins the consequence in
 *    its gate, it does not re-implement it.
 *
 * 2. SUBMIT SHORTCUT: Ctrl+Enter / Cmd+Enter submits the generate form
 *    through the EXISTING submit pipeline (form.requestSubmit() fires
 *    the same event the button does — one path, one validation, one
 *    busy cycle). The combination is exposed to assistive tech via
 *    aria-keyshortcuts on the submit button and shown as a visible
 *    hint.
 *
 * Contracts: the predicate is pure and total (garbage -> false); the
 * wiring never throws (a missing form degrades to a noop stop); the
 * default browser behaviour of the combination is PREVENTED only when
 * the shortcut actually matches; import-safe in Node.
 */

/** Pure: is this keyboard event the submit shortcut? */
export function isSubmitShortcut(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.key !== 'Enter') return false;
  return event.ctrlKey === true || event.metaKey === true;
}

/**
 * Wire Ctrl/Cmd+Enter on the form -> the existing submit pipeline.
 * Returns a stop() handle.
 */
export function startKeyboard({ form } = {}) {
  if (!form?.addEventListener) return () => {};

  const onKeydown = (event) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault?.();
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      // Older engines: dispatch the same cancellable submit event the
      // button would fire (the form carries novalidate by design).
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  };

  form.addEventListener('keydown', onKeydown);
  return () => form.removeEventListener('keydown', onKeydown);
}

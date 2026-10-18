/**
 * SUTO OSNOVA — render guards (task 153).
 * ZERO UNNECESSARY DOM WRITES: the browser diffs textContent and
 * attributes internally, but every redundant write still costs a
 * style/layout invalidation round — these two helpers make every
 * hot-path write CONDITIONAL on the value actually changing.
 *
 * Contracts:
 *   - setTextIfChanged writes node.textContent ONLY when it differs
 *     from the current value (returns whether it wrote);
 *   - setAttrIfChanged sets an attribute ONLY when it differs (the
 *     comparison is string-based, like the DOM);
 *   - a missing node is a silent false (never a throw);
 *   - pure over the injected node — import-safe in Node.
 */

/** Write textContent only when the value differs. */
export function setTextIfChanged(node, text) {
  if (!node || node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/** Set an attribute only when the value differs. */
export function setAttrIfChanged(node, name, value) {
  if (!node || typeof node.getAttribute !== 'function') return false;
  if (node.getAttribute(name) === String(value)) return false;
  node.setAttribute(name, value);
  return true;
}

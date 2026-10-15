/**
 * deepFreeze — recursive Object.freeze for plain data (engine internal).
 *
 * Used on the EGRESS path of the agent session facade (task 43): every
 * state view handed to callers is deep-frozen, so no external code can
 * mutate nested structures either. Cycles are tolerated via a WeakSet
 * (already-visited objects are skipped); primitives are returned as-is;
 * the SAME object reference is returned after freezing (idempotent).
 */

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

export default deepFreeze;

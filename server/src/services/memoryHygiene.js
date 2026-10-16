/**
 * MemoryHygiene (task 76) — memory isolation for the dossier
 * generation cycle: garbage collection after each completed cycle so a
 * long-running agent process does not accumulate cycle garbage.
 *
 * REALITY CHECK (professional GC practice): portable Node.js cannot
 * FORCE collection — `global.gc` exists only when the process runs
 * with `--expose-gc` (see the `test:gc` npm script). This module is
 * therefore BEST-EFFORT AND HONEST:
 *
 *   collectGarbage()  — calls `global.gc` when exposed (optionally a
 *                       second lazy sweep after an event-loop turn);
 *                       otherwise returns performed:false with the
 *                       reason. Never throws, never pretends;
 *   cycleMemorySnapshot() — heapUsed/heapTotal/rss in bytes;
 *   isolateCycle(run, options) — THE wrapper: executes one generation
 *                       cycle, DROPS its intermediates (only the
 *                       returned record survives — the caller never
 *                       holds cycle internals), runs garbage
 *                       collection when available and reports the
 *                       memory delta: {result, memory: {before, after,
 *                       gcPerformed, heapDeltaBytes, rssDeltaBytes},
 *                       pressure} where pressure flags post-isolation
 *                       heap growth beyond maxHeapGrowthBytes
 *                       (default 8 MB — the executor decides what to
 *                       do with the flag; the module reports).
 *
 * The isolation CONTRACT: cycle code must not leak references into
 * module-level state; the wrapper guarantees the CALLER side (nothing
 * but the frozen result escapes) and the RUNTIME side (GC runs when
 * the host allows it).
 */

/** Documented defaults (exported tuning contract). */
export const MEMORY_DEFAULTS = Object.freeze({
  maxHeapGrowthBytes: 8_000_000,
  deep: true, // second lazy sweep after an event-loop turn
});

/**
 * Best-effort garbage collection. Honest about the host: performed is
 * false when the process lacks --expose-gc.
 *
 * @param {{deep?: boolean}} [options] deep runs a second sweep after
 *        a setImmediate turn (lazy-sweep follow-up).
 * @returns {Promise<Readonly<{performed, sweeps, reason}>>} frozen.
 */
export async function collectGarbage(options = {}) {
  const { deep } = { ...MEMORY_DEFAULTS, ...options };
  if (typeof globalThis.gc !== 'function') {
    return Object.freeze({
      performed: false,
      sweeps: 0,
      reason: 'gc_not_exposed',
    });
  }

  let sweeps = 0;
  globalThis.gc();
  sweeps += 1;
  if (deep) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
    sweeps += 1;
  }
  return Object.freeze({ performed: true, sweeps, reason: null });
}

/** A point-in-time memory snapshot (bytes). */
export function cycleMemorySnapshot() {
  const usage = process.memoryUsage();
  return Object.freeze({
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
  });
}

/**
 * Runs ONE generation cycle with memory isolation.
 *
 * @param {() => Promise<unknown>|unknown} run the cycle function; only
 *        its RETURN VALUE survives the isolation.
 * @param {object} [options] {maxHeapGrowthBytes, deep} + a `gc` escape
 *        hatch is intentionally NOT offered — the hook is host-level.
 * @returns {Promise<Readonly<{result, memory, pressure}>>} frozen:
 *          memory = {before, after, gcPerformed, gcSweeps,
 *          heapDeltaBytes, rssDeltaBytes}; pressure flags
 *          post-GC heap growth beyond the threshold.
 * @throws {TypeError} when run is not a function.
 */
export async function isolateCycle(run, options = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('isolateCycle: run must be a function');
  }
  const { maxHeapGrowthBytes, deep } = { ...MEMORY_DEFAULTS, ...options };

  const before = cycleMemorySnapshot();
  // The cycle result is the ONLY reference that escapes; every
  // intermediate of `run` becomes unreachable on return.
  const result = await run();
  const gcReport = await collectGarbage({ deep });
  const after = cycleMemorySnapshot();

  return Object.freeze({
    result,
    memory: Object.freeze({
      before,
      after,
      gcPerformed: gcReport.performed,
      gcSweeps: gcReport.sweeps,
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss,
    }),
    pressure: after.heapUsed - before.heapUsed > maxHeapGrowthBytes,
  });
}

const memoryHygiene = {
  collectGarbage,
  cycleMemorySnapshot,
  isolateCycle,
  MEMORY_DEFAULTS,
};

export default memoryHygiene;

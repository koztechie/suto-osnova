/**
 * ParallelTasks (task 75) — async orchestration utilities that keep the
 * Node.js main thread responsive: allSettled-style isolation for
 * heterogeneous task batches and an event-loop yield for CPU-heavy
 * batches.
 *
 * runParallelTasks(tasks, {concurrency}): runs {name, run} tasks
 * CONCURRENTLY through a bounded worker pool; a task rejection is
 * CAPTURED per slot (never aborts siblings, never rejects the batch —
 * the Promise.allSettled contract, applied with backpressure). Results
 * are index-aligned with the input: completion order never leaks into
 * the output (the repo-wide determinism rule). concurrency defaults to
 * the batch size (full parallelism — for network legs the limiter in
 * qlooClient already bounds upstream pressure); a finite value caps
 * in-flight work so a large batch cannot flood the loop with pending
 * timers.
 *
 * chunkedProcess(items, handler, {chunkSize}): the CPU-blocking
 * counterpart — synchronous-ish batches processed in slices with an
 * explicit setImmediate YIELD between chunks, so long computations
 * cannot starve I/O callbacks. Order preserved; handler errors reject
 * (they are programming errors, not task data).
 *
 * Both utilities are pure of domain logic: no I/O of their own, no
 * clocks (timing belongs to tests/profilers), no RNG.
 */

const finitePositiveInt = (value, fallback) =>
  Number.isInteger(value) && value > 0 ? value : fallback;

const validateTasks = (tasks) => {
  if (!Array.isArray(tasks)) {
    throw new TypeError('runParallelTasks: tasks must be an array');
  }
  tasks.forEach((task, index) => {
    if (!task || typeof task !== 'object' || typeof task.name !== 'string' || task.name.length === 0) {
      throw new TypeError(`runParallelTasks: tasks[${index}].name must be a non-empty string`);
    }
    if (typeof task.run !== 'function') {
      throw new TypeError(`runParallelTasks: tasks[${index}].run must be a function`);
    }
  });
};

/**
 * Runs heterogeneous async tasks concurrently with per-task isolation.
 *
 * @param {Array<{name: string, run: () => Promise<unknown>}>} tasks
 * @param {{concurrency?: number}} [options] bounded lanes (default: all
 *        tasks at once).
 * @returns {ReadonlyArray<Readonly<{name, status, value?, reason?}>>}
 *          frozen, index-aligned; status 'fulfilled'|'rejected'.
 */
export async function runParallelTasks(tasks, options = {}) {
  validateTasks(tasks);
  const total = tasks.length;
  if (total === 0) return Object.freeze([]);

  const lanes = Math.min(finitePositiveInt(options.concurrency, total), total);
  const results = new Array(total);
  let cursor = 0;

  const lane = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      const task = tasks[index];
      try {
        results[index] = Object.freeze({
          name: task.name,
          status: 'fulfilled',
          value: await task.run(),
        });
      } catch (reason) {
        results[index] = Object.freeze({
          name: task.name,
          status: 'rejected',
          reason,
        });
      }
    }
  };

  // The lanes themselves never reject (each slot swallows into its
  // record) — allSettled makes the batch join explicit and inert.
  await Promise.allSettled(Array.from({ length: lanes }, lane));

  return Object.freeze(results);
}

/**
 * Processes a batch in slices, YIELDING to the event loop between
 * chunks so long CPU work cannot starve I/O callbacks.
 *
 * @param {Array} items
 * @param {(item: unknown, index: number) => Promise<unknown>|unknown} handler
 * @param {{chunkSize?: number}} [options] (default 100).
 * @returns {Promise<Array>} results in input order.
 * @throws {TypeError} on invalid inputs/handler.
 */
export async function chunkedProcess(items, handler, options = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError('chunkedProcess: items must be an array');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('chunkedProcess: handler must be a function');
  }
  const chunkSize = finitePositiveInt(options.chunkSize, 100);

  const out = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);
    for (let i = start; i < end; i += 1) {
      out.push(await handler(items[i], i));
    }
    if (end < items.length) {
      // The explicit yield: let pending I/O callbacks run.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return out;
}

const parallelTasks = {
  runParallelTasks,
  chunkedProcess,
};

export default parallelTasks;

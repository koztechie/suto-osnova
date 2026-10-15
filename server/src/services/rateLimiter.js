/**
 * Outbound rate limiter protecting the Qloo hackathon API key quota.
 *
 * Design (token bucket + concurrency semaphore + bounded FIFO queue):
 * - `capacity` / `intervalMs` control the sustained request rate: the bucket
 *   refills at `capacity / intervalMs` tokens per millisecond and never
 *   exceeds `capacity` (burst size).
 * - `maxConcurrent` caps how many tasks execute at the same time, so a burst
 *   of agent activity cannot open an unbounded number of parallel sockets.
 * - `maxQueue` bounds the waiting backlog. When it is full the limiter
 *   rejects immediately (`RateLimitExceededError`) instead of queueing work
 *   that would only burn the API key quota later — failing fast is cheaper
 *   than a guaranteed 429 from upstream.
 *
 * The limiter is transport-agnostic: it schedules any `() => Promise` task
 * and resolves with that task's result.
 */

export class RateLimitExceededError extends Error {
  constructor(message, { queued = 0 } = {}) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.queued = queued;
  }
}

const MIN_INTERVAL_MS = 1;

export class RateLimiter {
  #capacity;
  #intervalMs;
  #maxConcurrent;
  #maxQueue;
  #tokens;
  #lastRefillAt;
  #active = 0;
  #queue = [];
  #timer = null;

  constructor({
    capacity = 10,
    intervalMs = 1000,
    maxConcurrent = 3,
    maxQueue = 50,
  } = {}) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new TypeError('RateLimiter: capacity must be a number >= 1');
    }
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
      throw new TypeError(
        `RateLimiter: intervalMs must be a number >= ${MIN_INTERVAL_MS}`
      );
    }
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new TypeError('RateLimiter: maxConcurrent must be a number >= 1');
    }
    if (!Number.isFinite(maxQueue) || maxQueue < 1) {
      throw new TypeError('RateLimiter: maxQueue must be a number >= 1');
    }

    this.#capacity = capacity;
    this.#intervalMs = intervalMs;
    this.#maxConcurrent = maxConcurrent;
    this.#maxQueue = maxQueue;
    this.#tokens = capacity;
    this.#lastRefillAt = Date.now();
  }

  /** Observability snapshot (safe to expose in diagnostics endpoints). */
  get stats() {
    return {
      active: this.#active,
      queued: this.#queue.length,
      availableTokens: Math.floor(this.#tokens),
      capacity: this.#capacity,
      maxConcurrent: this.#maxConcurrent,
      maxQueue: this.#maxQueue,
    };
  }

  /**
   * Enqueue `task` and run it once a rate token and a concurrency slot are
   * available. Returns the task's result (or rejection).
   */
  schedule(task) {
    if (typeof task !== 'function') {
      throw new TypeError('RateLimiter.schedule(task) requires a function');
    }

    if (this.#queue.length >= this.#maxQueue) {
      return Promise.reject(
        new RateLimitExceededError(
          `Outbound rate limiter queue is full (${this.#maxQueue} pending). ` +
            'Rejecting request to protect the Qloo API key quota.',
          { queued: this.#queue.length }
        )
      );
    }

    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this.#pump();
    });
  }

  #refill(now) {
    if (now <= this.#lastRefillAt) return;
    const elapsed = now - this.#lastRefillAt;
    const gained = (elapsed * this.#capacity) / this.#intervalMs;
    this.#tokens = Math.min(this.#capacity, this.#tokens + gained);
    this.#lastRefillAt = now;
  }

  #pump() {
    this.#refill(Date.now());

    while (
      this.#active < this.#maxConcurrent &&
      this.#queue.length > 0 &&
      this.#tokens >= 1
    ) {
      this.#tokens -= 1;
      this.#active += 1;
      const entry = this.#queue.shift();

      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1;
          this.#pump();
        });
    }

    this.#scheduleWakeUp();
  }

  #scheduleWakeUp() {
    if (this.#queue.length === 0) {
      // Nothing is waiting: drop any pending timer so it cannot keep the
      // event loop alive (or fire spuriously) after the queue drains.
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      return;
    }

    if (this.#timer === null) {
      const tokensNeeded = Math.max(0, 1 - this.#tokens);
      const waitMs = Math.max(
        1,
        Math.ceil((tokensNeeded * this.#intervalMs) / this.#capacity)
      );

      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#pump();
      }, waitMs);
    }

    // Ref-state must be re-evaluated on every pump: the bottleneck can move
    // between tokens and execution slots as tasks start and finish.
    // - Slots busy: task completion re-pumps anyway, so unref the timer to
    //   let an idle process exit.
    // - Tokens are the bottleneck: the timer is the only wake-up source and
    //   must keep the loop alive, otherwise queued work would be stranded.
    if (this.#active >= this.#maxConcurrent) {
      this.#timer.unref?.();
    } else {
      this.#timer.ref?.();
    }
  }
}

export default RateLimiter;

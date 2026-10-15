import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RateLimiter,
  RateLimitExceededError,
} from '../src/services/rateLimiter.js';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runs tasks immediately up to the burst capacity', async () => {
  const limiter = new RateLimiter({
    capacity: 3,
    intervalMs: 60_000,
    maxConcurrent: 10,
    maxQueue: 10,
  });

  const results = await Promise.all(
    [1, 2, 3].map((n) => limiter.schedule(async () => n * 10))
  );

  assert.deepEqual(results, [10, 20, 30]);
  assert.equal(limiter.stats.availableTokens, 0);
});

test('sustains the configured rate over time', async () => {
  const limiter = new RateLimiter({
    capacity: 2,
    intervalMs: 100,
    maxConcurrent: 5,
    maxQueue: 10,
  });

  const startedAt = Date.now();
  // 2 burst + 3 more needing refill at 20 tokens/s => ~150ms extra.
  await Promise.all(
    Array.from({ length: 5 }, () => limiter.schedule(async () => tick(5)))
  );
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed >= 120, `expected >= 120ms, got ${elapsed}ms`);
});

test('caps concurrent executions', async () => {
  const limiter = new RateLimiter({
    capacity: 100,
    intervalMs: 1000,
    maxConcurrent: 2,
    maxQueue: 50,
  });

  let running = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 6 }, () =>
      limiter.schedule(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick(20);
        running -= 1;
      })
    )
  );

  assert.equal(peak, 2);
});

test('rejects with RateLimitExceededError when the queue is full', async () => {
  const limiter = new RateLimiter({
    capacity: 1,
    intervalMs: 60_000,
    maxConcurrent: 1,
    maxQueue: 1,
  });

  const first = limiter.schedule(() => tick(50).then(() => 'first'));
  const queued = limiter.schedule(async () => 'queued');

  await assert.rejects(
    limiter.schedule(async () => 'overflow'),
    (err) => {
      assert.ok(err instanceof RateLimitExceededError);
      assert.match(err.message, /queue is full/);
      return true;
    }
  );

  assert.equal(await first, 'first');
  assert.equal(await queued, 'queued');
});

test('propagates task rejections and keeps draining the queue', async () => {
  const limiter = new RateLimiter({
    capacity: 10,
    intervalMs: 1000,
    maxConcurrent: 1,
    maxQueue: 10,
  });

  const failing = limiter.schedule(async () => {
    throw new Error('boom');
  });
  const following = limiter.schedule(async () => 'ok');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'ok');
});

test('rejects invalid constructor options', () => {
  assert.throws(() => new RateLimiter({ capacity: 0 }), TypeError);
  assert.throws(() => new RateLimiter({ intervalMs: 0 }), TypeError);
  assert.throws(() => new RateLimiter({ maxConcurrent: 0 }), TypeError);
  assert.throws(() => new RateLimiter({ maxQueue: 0 }), TypeError);
});

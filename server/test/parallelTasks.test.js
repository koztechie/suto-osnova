/**
 * ParallelTasks + DossierLayers tests (task 75) — pins the async
 * orchestration: allSettled isolation with backpressure, index-aligned
 * results under out-of-order completion, bounded lanes, the event-loop
 * yield of chunkedProcess, the CONCURRENT five-layer composition with
 * per-layer failure isolation, and the wall-time proof that one
 * parallel wave beats sequential awaiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'parallel-tasks-test-key';

const {
  runParallelTasks,
  chunkedProcess,
} = await import('../src/services/parallelTasks.js');
const { extractAllLayers, DOSSIER_LAYERS } = await import('../src/services/dossierLayers.js');
const { extractSoundProfile } = await import('../src/services/soundExtractor.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('runParallelTasks: concurrent, index-aligned, isolated', async () => {
  const gates = [deferred(), deferred(), deferred()];
  let inFlight = 0;
  let maxInFlight = 0;

  const pending = runParallelTasks(
    gates.map((gate, i) => ({
      name: `t${i}`,
      run: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gate.promise;
        inFlight -= 1;
        return `v${i}`;
      },
    }))
  );

  // All three lanes are in flight simultaneously...
  await tick();
  assert.equal(maxInFlight, 3, 'full parallelism by default');

  // ...and complete in REVERSE order — slots stay index-aligned.
  gates[2].resolve();
  gates[0].resolve();
  gates[1].resolve();
  const results = await pending;

  assert.deepEqual(results.map((r) => r.value), ['v0', 'v1', 'v2']);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled']);
  assert.ok(Object.isFrozen(results));
  assert.ok(Object.isFrozen(results[0]));
});

test('runParallelTasks: a rejection never aborts its siblings', async () => {
  const boom = new Error('layer down');
  const results = await runParallelTasks([
    { name: 'ok1', run: async () => 1 },
    { name: 'bad', run: async () => { throw boom; } },
    { name: 'ok2', run: () => 2 },
  ]);

  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[1].reason, boom, 'cause preserved');
  assert.equal(results[1].value, undefined);
  assert.equal(results[0].value, 1);
});

test('runParallelTasks: bounded concurrency caps in-flight work', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 8 }, (_, i) => ({
    name: `t${i}`,
    run: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return i;
    },
  }));

  const results = await runParallelTasks(items, { concurrency: 2 });
  assert.ok(maxInFlight <= 2, `max in flight was ${maxInFlight}`);
  assert.deepEqual(results.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(await runParallelTasks([]), [], 'empty batch');
});

test('runParallelTasks: validation', async () => {
  await assert.rejects(() => runParallelTasks('x'), TypeError);
  await assert.rejects(() => runParallelTasks([{ name: '', run: async () => {} }]), TypeError);
  await assert.rejects(() => runParallelTasks([{ name: 'a' }]), TypeError);
});

test('chunkedProcess: order preserved, yields between chunks', async () => {
  let macrotaskRan = false;
  setImmediate(() => { macrotaskRan = true; });

  const out = await chunkedProcess([1, 2, 3, 4, 5], (n) => n * 2, { chunkSize: 2 });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.equal(macrotaskRan, true, 'the event loop ran between chunks');

  assert.deepEqual(await chunkedProcess([], () => 1), []);
  await assert.rejects(() => chunkedProcess('x', () => 1), TypeError);
  await assert.rejects(() => chunkedProcess([1], null), TypeError);
});

test('extractAllLayers: five layers in ONE concurrent wave', async () => {
  // Every client awaits the same latch — sequential awaiting would
  // deadlock (or take 5 sequential latch rounds); concurrency proves
  // itself by completing on the first release.
  let inFlight = 0;
  let maxInFlight = 0;
  const latch = deferred();
  const countingClient = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await latch.promise;
    inFlight -= 1;
    return { results: [] };
  };

  const pending = extractAllLayers(
    { id: UUID_LOCAL('seed'), name: 'Anchor', category: 'film' },
    { affinityFn: countingClient, searchFn: countingClient, tagsFn: countingClient }
  );
  await tick();
  latch.resolve();

  const batch = await pending;
  assert.ok(maxInFlight >= 2, 'at least two layers hit their clients concurrently');
  assert.deepEqual(DOSSIER_LAYERS.map((l) => batch.coverage[l]), [true, true, true, true, true]);
  assert.deepEqual(batch.failures, []);
  assert.ok(Object.isFrozen(batch));
  assert.ok(Object.isFrozen(batch.layers));
});

test('extractAllLayers: per-layer failure isolation with coverage flags', async () => {
  const anchor = { id: UUID_LOCAL('seed'), name: 'Anchor', category: 'film' };
  // Each service isolates its OWN legs; a layer REJECTS only when all
  // of its legs fail. Killing affinityFn takes down literary (both of
  // its legs ride affinity) while the other layers survive on their
  // remaining legs.
  const failingAffinity = async () => {
    throw new Error('insights endpoint down');
  };

  const batch = await extractAllLayers(anchor, {
    affinityFn: failingAffinity,
    searchFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.equal(batch.coverage.literary, false, 'both literary legs ride affinity -> all_legs_failed');
  assert.equal(batch.coverage.sound, true, 'sound survives on tags/search legs');
  assert.equal(batch.coverage.material, true);
  assert.equal(batch.coverage.gastronomy, true);
  assert.equal(batch.coverage.visual, true);
  assert.equal(batch.failures.length, 1);
  assert.equal(batch.failures[0].layer, 'literary');
  assert.ok(
    batch.failures[0].message.includes('leg failed'),
    'the layer records its typed all_legs_failed wrapper (cause carries the root)'
  );
  assert.equal(batch.layers.literary, null, 'failed layers are null, never partial');
});

test('extractAllLayers: invalid anchor is a typed programmer error', async () => {
  await assert.rejects(() => extractAllLayers({}), TypeError);
  await assert.rejects(() => extractAllLayers(null), TypeError);
});

test('wall-time: the concurrent wave beats sequential awaiting', async () => {
  const DELAY_MS = 30;
  const slowClient = async () => {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    return { results: [] };
  };
  const anchor = { id: UUID_LOCAL('seed'), name: 'Anchor', category: 'film' };
  const clients = {
    affinityFn: slowClient, searchFn: slowClient, tagsFn: slowClient,
  };

  // Sequential baseline: five layers awaited one after another.
  const sequentialStart = performance.now();
  await extractSoundProfile(anchor, clients);
  await extractSoundProfile(anchor, clients);
  await extractSoundProfile(anchor, clients);
  await extractSoundProfile(anchor, clients);
  await extractSoundProfile(anchor, clients);
  const sequentialMs = performance.now() - sequentialStart;

  const parallelStart = performance.now();
  const batch = await extractAllLayers(anchor, clients);
  const parallelMs = performance.now() - parallelStart;

  assert.ok(batch.coverage.sound, 'the parallel batch really ran');
  assert.ok(
    parallelMs < sequentialMs / 2,
    `parallel ${parallelMs.toFixed(0)}ms vs sequential ${sequentialMs.toFixed(0)}ms — ` +
      'the wave must collapse the sum of round-trips'
  );
});

function UUID_LOCAL(tag) {
  return `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
}

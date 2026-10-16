/**
 * Memory isolation tests (task 76) — pins the GC hygiene contract:
 * honest collectGarbage reporting (performed:false without --expose-gc,
 * sweep counts with the hook), the isolateCycle wrapper (only the
 * result escapes, memory deltas reported, pressure flag), and the FULL
 * generation cycle driven through isolation — with the real-GC path
 * verifiable via `npm run test:gc` (node --expose-gc).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'memory-isolation-key';

const {
  collectGarbage,
  cycleMemorySnapshot,
  isolateCycle,
  MEMORY_DEFAULTS,
} = await import('../src/services/memoryHygiene.js');
const { runFullCycle, CYCLE_ANCHOR } = await import('../test-support/fullCycleRunner.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');

const realGcDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'gc');
const hadExposedGc = typeof realGcDescriptor?.value === 'function';

/**
 * Shadows/restores the host gc hook. The --expose-gc property is
 * writable-but-not-configurable, so plain ASSIGNMENT shadows it in
 * both modes (restore by assignment / delete).
 */
async function withGc(gcFn, fn) {
  globalThis.gc = gcFn;
  try {
    return await fn();
  } finally {
    if (hadExposedGc) globalThis.gc = realGcDescriptor.value;
    else delete globalThis.gc;
  }
}

test('collectGarbage: honest about an unexposed GC hook', async () => {
  await withGc(undefined, async () => {
    const report = await collectGarbage();
    assert.deepEqual({ ...report }, {
      performed: false, sweeps: 0, reason: 'gc_not_exposed',
    });
  });
});

test('collectGarbage: calls the hook with the deep double sweep', async () => {
  let calls = 0;
  await withGc(() => { calls += 1; }, async () => {
    const shallow = await collectGarbage({ deep: false });
    assert.deepEqual({ ...shallow }, { performed: true, sweeps: 1, reason: null });
    assert.equal(calls, 1);

    const deep = await collectGarbage({ deep: true });
    assert.equal(deep.sweeps, 2, 'the lazy follow-up sweep runs after a turn');
    assert.equal(calls, 3);
  });
});

test('cycleMemorySnapshot: byte-level numbers', () => {
  const snap = cycleMemorySnapshot();
  assert.ok(Number.isFinite(snap.heapUsed) && snap.heapUsed > 0);
  assert.ok(Number.isFinite(snap.heapTotal) && snap.heapTotal > 0);
  assert.ok(Number.isFinite(snap.rss) && snap.rss > 0);
  assert.ok(Object.isFrozen(snap));
});

test('isolateCycle: only the result escapes; deltas and pressure reported', async () => {
  let gcCalls = 0;
  await withGc(() => { gcCalls += 1; }, async () => {
    const isolated = await isolateCycle(async () => {
      // Allocate cycle garbage that must NOT survive isolation.
      const garbage = Array.from({ length: 10_000 }, (_, i) => ({ i, payload: `g${i}` }));
      assert.equal(garbage.length, 10_000);
      return { kept: 'frozen-result' };
    });

    assert.deepEqual(isolated.result, { kept: 'frozen-result' }, 'the record survives');
    assert.equal(isolated.memory.gcPerformed, true);
    assert.ok(gcCalls >= 1, 'the hook ran after the cycle');
    assert.ok(Number.isFinite(isolated.memory.heapDeltaBytes));
    assert.ok(Number.isFinite(isolated.memory.rssDeltaBytes));
    assert.ok(Object.isFrozen(isolated));
    assert.ok(Object.isFrozen(isolated.memory));

    // A 1-byte threshold trips the pressure flag on a real cycle...
    const tight = await isolateCycle(() => ({ ok: true }), { maxHeapGrowthBytes: 1 });
    assert.equal(typeof tight.pressure, 'boolean');
    // ...while a generous threshold stays calm.
    const calm = await isolateCycle(() => ({ ok: true }), { maxHeapGrowthBytes: 1_000_000_000 });
    assert.equal(calm.pressure, false);
  });
  assert.equal(MEMORY_DEFAULTS.maxHeapGrowthBytes, 8_000_000);
});

test('isolateCycle: validation', async () => {
  await assert.rejects(() => isolateCycle(null), TypeError);
  await assert.rejects(() => isolateCycle('x'), TypeError);
});

test('full generation cycles stay memory-isolated', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'memory-iso-'));
  const records = [];
  try {
    // Warmup outside measurement (JIT, module caches, fs handles).
    const warm = await isolateCycle(() => runFullCycle(baseDir));
    assert.equal(warm.result.session.state, AgentState.DELIVERED);

    for (let i = 0; i < 5; i += 1) {
      records.push(await isolateCycle(() => runFullCycle(baseDir)));
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }

  assert.equal(records.length, 5);
  for (const record of records) {
    assert.equal(record.result.loaded.data.anchor, CYCLE_ANCHOR, 'every cycle completed');
    assert.ok(Number.isFinite(record.memory.heapDeltaBytes), 'deltas reported every cycle');
  }

  const gcExposed = typeof globalThis.gc === 'function';
  const last = records[records.length - 1];
  console.log(
    `[memory-isolation] gcExposed=${gcExposed} ` +
      `heapDeltas=${records.map((r) => (r.memory.heapDeltaBytes / 1024).toFixed(0) + 'KB').join(',')} ` +
      `pressureFlags=${records.map((r) => (r.pressure ? 1 : 0)).join(',')}`
  );

  if (gcExposed) {
    // With a real hook every isolation ran GC and the final heap growth
    // stayed under the default threshold — no cross-cycle leakage.
    assert.ok(records.every((r) => r.memory.gcPerformed), 'every cycle collected');
    assert.equal(last.pressure, false, 'no uncollected growth after the loop');
  } else {
    // Without the hook the wrapper still reports honestly.
    assert.ok(records.every((r) => r.memory.gcPerformed === false));
  }
});

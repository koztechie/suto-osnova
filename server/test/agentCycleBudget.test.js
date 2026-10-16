/**
 * AGENT CYCLE BUDGET (task 74) — verification that the FULL agent
 * generation cycle runs within the task's hard budget: <= 4.5 seconds
 * on AMD A4-class hardware. The cycle itself lives in
 * server/test/helpers/fullCycleRunner.js (shared with the task-76
 * memory-isolation gate, so both gates measure the SAME path).
 *
 * METHOD (professional perf-gate practice):
 *   - stress-scaled stub data (30-candidate chains, 30-row layer
 *     pages, all five extraction layers CONCURRENT (task 75), graph +
 *     weights, synthesis stub, validator, session save/load) so
 *     accidental super-linear regressions BITE the numbers;
 *   - 1 warmup + 5 measured runs, assertion on the MEDIAN
 *     (noise-immune) plus a per-run worst ceiling;
 *   - the local gate is A4_BUDGET_MS / A4_SLOWDOWN_FACTOR =
 *     4500/5 = 900ms with the factor DOCUMENTED as one constant; the
 *     report prints the measured median and the A4 projection so the
 *     headroom is auditable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'cycle-budget-key';

import { AgentState } from '../src/engine/AgentStateMachine.js';
import { AgentPhase } from '../src/engine/AgentPhases.js';

// The runner pulls in env-dependent services — load it AFTER the env
// setup (repo-wide top-level-await pattern).
const { runFullCycle, CYCLE_ANCHOR } = await import('../test-support/fullCycleRunner.js');

const A4_BUDGET_MS = 4500; // the task contract
const A4_SLOWDOWN_FACTOR = 5; // documented: A4-5300-class vs the dev box
const LOCAL_BUDGET_MS = A4_BUDGET_MS / A4_SLOWDOWN_FACTOR; // 900 ms
const CYCLES = 5;

test('full agent generation cycle stays inside the AMD A4 budget', async (t) => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'cycle-budget-'));
  const timings = [];

  try {
    // One warmup (JIT, fs caches) — not measured.
    const warm = await runFullCycle(baseDir);
    assert.equal(warm.session.state, AgentState.DELIVERED);
    assert.equal(warm.session.phase, AgentPhase.COMPLETED);
    assert.equal(warm.loaded.data.anchor, CYCLE_ANCHOR, 'the cycle really completed end to end');
    assert.ok(
      Object.values(warm.coverage).every((v) => v === true),
      'every layer of the concurrent wave succeeded'
    );

    for (let i = 0; i < CYCLES; i += 1) {
      const started = performance.now();
      await runFullCycle(baseDir);
      timings.push(performance.now() - started);
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];

  // The auditable report.
  console.log(
    `[cycle-budget] median=${median.toFixed(1)}ms worst=${worst.toFixed(1)}ms ` +
      `localBudget=${LOCAL_BUDGET_MS}ms A4-projected=${(median * A4_SLOWDOWN_FACTOR).toFixed(0)}ms ` +
      `of ${A4_BUDGET_MS}ms (x${A4_SLOWDOWN_FACTOR} assumption)`
  );

  assert.ok(
    median < LOCAL_BUDGET_MS,
    `median ${median.toFixed(1)}ms exceeds the local budget ${LOCAL_BUDGET_MS}ms ` +
      `(A4 projection ${(median * A4_SLOWDOWN_FACTOR).toFixed(0)}ms of ${A4_BUDGET_MS}ms)`
  );
  assert.ok(
    worst < LOCAL_BUDGET_MS * 1.5,
    `a single noisy run (${worst.toFixed(1)}ms) suggests instability, not just slowness`
  );
});

test('the budget model itself stays honest', () => {
  assert.equal(A4_BUDGET_MS, 4500, 'the task contract');
  assert.equal(LOCAL_BUDGET_MS * A4_SLOWDOWN_FACTOR, A4_BUDGET_MS, 'the scaling identity');
  assert.ok(A4_SLOWDOWN_FACTOR >= 3, 'the A4 assumption stays conservative');
  assert.ok(CYCLES >= 5, 'median over an odd, noise-resistant sample');
});

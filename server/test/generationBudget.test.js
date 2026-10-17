/**
 * Generation budget gate (task 117) — verifies the DOSSIER
 * GENERATION TIME in the MOST COMPLEX mode (Mode 1: the worldbuilder,
 * all five layers + the LLM narrative synthesis), against the PRD
 * acceptance criterion (< 4.5s for the full 5-domain cycle).
 *
 * WHY MODE 1: it issues the most upstream work — the five-domain
 * expansion, the five extraction layers, and the LLM synthesis call —
 * so it is the worst-case generation path.
 *
 * OFFLINE HONESTY: the Qloo + LLM clients are STUBBED (zero network),
 * so the measured time is the pipeline's own COMPUTE plus the
 * simulated LLM latency. The gate therefore proves two things:
 *   1. the COMPUTE-ONLY full run (a 0-latency LLM stub) is far under
 *      the budget (leaving headroom for real network + LLM time);
 *   2. a run with a REALISTIC simulated LLM latency (~1.5s) still
 *      completes under 4.5s — the generation INCLUDING an LLM call
 *      fits the budget.
 * A warm-up run absorbs first-call JIT/import costs before measuring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'budget-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

/** The PRD acceptance budget (ms) for the full 5-domain cycle. */
const PRD_BUDGET_MS = 4500;
/** A realistic LLM round-trip latency for the "including LLM" run. */
const SIMULATED_LLM_MS = 1500;

const llmStub = (latencyMs) => async () => {
  if (latencyMs > 0) {
    await new Promise((resolve) => { setTimeout(resolve, latencyMs); });
  }
  return {
    ok: true, status: 200,
    json: async () => ({
      model: 'stub',
      usage: { prompt_tokens: 900, completion_tokens: 140 },
      choices: [{ message: { content: '"Hereditary" opens with "Gothic" dread and "Post-Punk" silence.' } }],
    }),
  };
};

const options = (llm) => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: tagsStub,
  fetchFn: llm,
  apiKey: 'perf-key',
  // synthesis defaults to ON (the most complex path).
});

test('a warm-up run absorbs JIT/import costs before measuring', async () => {
  await runWorldbuilder('A24 Psychological Horror', options(llmStub(0)));
});

test('the compute-only Mode 1 + LLM run fits the PRD budget with headroom', async () => {
  const timings = [];
  for (let i = 0; i < 5; i += 1) {
    const started = performance.now();
    const bundle = await runWorldbuilder('A24 Psychological Horror', options(llmStub(0)));
    timings.push(performance.now() - started);
    // The LLM path genuinely ran on every iteration.
    assert.equal(bundle.synthesis.attempted, true, 'the LLM synthesis ran');
    assert.ok(bundle.synthesis.text, 'the synthesis produced narrative text');
    assert.ok(bundle.ranked.length > 0, 'the dossier ranked picks');
  }
  const worst = Math.max(...timings);
  const mean = timings.reduce((sum, t) => sum + t, 0) / timings.length;
  assert.ok(worst < PRD_BUDGET_MS,
    `the full Mode-1 + LLM compute must fit <${PRD_BUDGET_MS}ms (PRD); worst ${worst.toFixed(1)}ms, mean ${mean.toFixed(1)}ms`);
  // The compute alone must leave clear headroom for real network + LLM.
  assert.ok(worst < PRD_BUDGET_MS - SIMULATED_LLM_MS,
    `compute (${worst.toFixed(1)}ms) must leave headroom for a ~${SIMULATED_LLM_MS}ms LLM call inside the budget`);
});

test('generation INCLUDING a realistic LLM call still fits the budget', async () => {
  const started = performance.now();
  const bundle = await runWorldbuilder('A24 Psychological Horror', options(llmStub(SIMULATED_LLM_MS)));
  const elapsed = performance.now() - started;

  assert.equal(bundle.synthesis.attempted, true);
  assert.ok(bundle.synthesis.text, 'the LLM narrative is in the dossier');
  assert.ok(elapsed < PRD_BUDGET_MS,
    `Mode 1 including a ~${SIMULATED_LLM_MS}ms LLM call must fit <${PRD_BUDGET_MS}ms; took ${elapsed.toFixed(1)}ms`);
  // The LLM latency actually dominated (the call was not optimized away).
  assert.ok(elapsed >= SIMULATED_LLM_MS,
    `the simulated LLM latency must be felt (${elapsed.toFixed(1)}ms >= ${SIMULATED_LLM_MS}ms)`);
});

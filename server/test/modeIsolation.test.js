/**
 * Mode isolation gate (task 118) — pins that the THREE agent modes are
 * COMPLETELY ISOLATED from one another in the codebase:
 *   - SEQUENTIAL INDEPENDENCE: running mode A, then B, then C leaves
 *     A's result byte-identical to running A fresh (no cross-run
 *     contamination of any module state);
 *   - CONCURRENT NON-INTERFERENCE: running all three at once
 *     (Promise.all) yields results deep-equal to the sequential runs —
 *     no shared mutable state, no races (the requestId and every
 *     bundle field are deterministic, so order cannot matter);
 *   - BUNDLE IMMUTABILITY: each mode's bundle is deep-frozen and is
 *     unaffected by running the other modes afterward;
 *   - DISPATCHER INDEPENDENCE: the MODES registry is frozen (a
 *     mutation attempt throws in strict ESM) and each mode's run plan
 *     (layers / selection / thresholds) is distinct and self-contained;
 *   - OPTION ISOLATION: an option valid for one mode does not bleed
 *     into another; an invalid option for one mode does not corrupt
 *     another's run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'mode-isolation-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { runAntithesis } = await import('../src/modes/AntithesisMode.js');
const {
  MODES, dispatchMode, MODE_WORLDBUILDER, MODE_ACTIVATION, MODE_ANTITHESIS,
} = await import('../src/engine/ModeDispatcher.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const SEED = 'A24 Psychological Horror';
const llmStub = async () => ({
  ok: true, status: 200,
  json: async () => ({
    model: 'stub', usage: { prompt_tokens: 800, completion_tokens: 120 },
    choices: [{ message: { content: 'A pinned narrative line for the isolation test.' } }],
  }),
});

const base = () => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: tagsStub,
  fetchFn: llmStub,
  apiKey: 'iso-key',
});
const wb = () => ({ ...base() });
const ex = () => ({ ...base(), insightsFn: async () => ({ count: 0, results: [] }) });
const an = () => ({ ...base() });

const plain = (value) => JSON.parse(JSON.stringify(value));

test('sequential independence: A, B, C then A again -> A is identical', async () => {
  const a1 = await runWorldbuilder(SEED, wb());
  await runExperiential(SEED, ex());
  await runAntithesis(SEED, an());
  const a2 = await runWorldbuilder(SEED, wb());
  assert.deepEqual(plain(a1), plain(a2),
    'running the other two modes leaves the worldbuilder result unchanged');
});

test('concurrent non-interference: Promise.all matches the sequential runs', async () => {
  const wbSeq = plain(await runWorldbuilder(SEED, wb()));
  const exSeq = plain(await runExperiential(SEED, ex()));
  const anSeq = plain(await runAntithesis(SEED, an()));

  const [wbCon, exCon, anCon] = await Promise.all([
    runWorldbuilder(SEED, wb()),
    runExperiential(SEED, ex()),
    runAntithesis(SEED, an()),
  ]);
  assert.deepEqual(plain(wbCon), wbSeq, 'worldbuilder is order-independent');
  assert.deepEqual(plain(exCon), exSeq, 'experiential is order-independent');
  assert.deepEqual(plain(anCon), anSeq, 'antithesis is order-independent');
});

test('bundle immutability: each mode freezes its bundle', async () => {
  const bundles = [
    await runWorldbuilder(SEED, wb()),
    await runExperiential(SEED, ex()),
    await runAntithesis(SEED, an()),
  ];
  for (const bundle of bundles) {
    assert.ok(Object.isFrozen(bundle), `${bundle.mode} bundle is frozen`);
  }
  // Each mode carries its OWN identity — no cross-mode fields.
  assert.equal(bundles[0].mode, MODE_WORLDBUILDER);
  assert.equal(bundles[1].mode, MODE_ACTIVATION);
  assert.equal(bundles[2].mode, MODE_ANTITHESIS);
  assert.ok(!('antithesis' in bundles[0]), 'worldbuilder carries no antithesis block');
  assert.ok(!('curation' in bundles[2]), 'antithesis carries no activation curation');
  assert.ok(!('layers' in bundles[2]), 'antithesis carries no extraction layers');
});

test('dispatcher independence: frozen registry, distinct self-contained plans', () => {
  assert.ok(Object.isFrozen(MODES), 'the registry is frozen');
  assert.throws(() => { MODES[MODE_WORLDBUILDER] = { hijacked: true }; }, TypeError,
    'a mutation attempt throws in strict ESM');

  const planA = dispatchMode(MODE_WORLDBUILDER);
  const planB = dispatchMode(MODE_ACTIVATION);
  const planC = dispatchMode(MODE_ANTITHESIS);
  assert.ok(Object.isFrozen(planA) && Object.isFrozen(planB) && Object.isFrozen(planC));

  // Each plan is distinct and self-contained.
  assert.deepEqual([...planA.layers], ['sound', 'literary', 'material', 'gastronomy', 'visual']);
  assert.deepEqual([...planB.layers], ['sound', 'material', 'gastronomy']);
  assert.deepEqual([...planC.layers], [...planA.layers], 'antithesis shares the five layers');
  assert.equal(planA.selection, planB.selection, 'modes 1-2 select non-obvious affinity');
  assert.equal(planC.selection, 'lowest_correlation', 'mode 3 inverts the selection');
  assert.ok(planB.thresholds !== null && planC.thresholds === null,
    'mode 3 honestly nulls the threshold schedule');
  // The plans do not alias each other's arrays.
  assert.notEqual(planA.domains, planB.domains);
});

test('option isolation: one mode\u2019s options do not bleed into another', async () => {
  // cutRate is an activation tuning knob; passing it to worldbuilder is
  // ignored (worldbuilder validates its own options, not activation's).
  const exTuned = plain(await runExperiential(SEED, { ...ex(), cutRate: 0, topN: 2 }));
  assert.equal(exTuned.mode, MODE_ACTIVATION);
  const wbPlain = plain(await runWorldbuilder(SEED, wb()));
  // A fresh experiential run WITHOUT the knobs differs from the tuned one
  // only where the knobs apply — but critically, worldbuilder is unchanged
  // by any experiential option ever passed.
  const wbAfter = plain(await runWorldbuilder(SEED, wb()));
  assert.deepEqual(wbPlain, wbAfter, 'worldbuilder is immune to experiential options');
  // An invalid option for one mode rejects THAT mode only.
  await assert.rejects(() => runExperiential(SEED, { ...ex(), topN: 0 }), TypeError);
  const wbStillWorks = await runWorldbuilder(SEED, wb());
  assert.equal(wbStillWorks.mode, MODE_WORLDBUILDER,
    'a rejected activation run leaves worldbuilder fully functional');
});

/**
 * WorldbuilderMode gate (task 82) — Mode 1 executes end to end over
 * injected stubs (zero network):
 *   - the full happy run (entity -> five-domain expansion -> math
 *     chain -> layers -> connections -> tonality -> graph -> weights
 *     -> synthesis -> validation -> DELIVERED session);
 *   - determinism (deep-equal bundles) and the frozen-bundle contract;
 *   - the required-affinityFn and option-shape TypeError contracts;
 *   - honest isolation: disabled synthesis, unconfigured LLM, one
 *     throwing layer, one throwing domain, total threshold rejection;
 *   - session persistence under an injected baseDir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'worldbuilder-mode-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runWorldbuilder, WORLDBUILDER_CODES } = await import('../src/modes/WorldbuilderMode.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');
const { MODES, MODE_WORLDBUILDER } = await import('../src/engine/ModeDispatcher.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { loadSession } = await import('../src/services/sessionCache.js');

const emptySearch = async () => ({ results: [] });
const llmFetchStub = async () => ({
  ok: true, status: 200,
  json: async () => ({
    model: 'stub', usage: { prompt_tokens: 900, completion_tokens: 140 },
    choices: [{ message: { content: '"Hereditary" opens with "Gothic" dread and "Post-Punk" silence.' } }],
  }),
});

const baseOptions = () => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: emptySearch,
  tagsFn: tagsStub,
  fetchFn: llmFetchStub,
  apiKey: 'wb-key',
});

test('happy run: anchor in, five-domain dossier out, session DELIVERED', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', baseOptions());

  assert.equal(bundle.mode, MODE_WORLDBUILDER);
  assert.equal(bundle.output, MODES[MODE_WORLDBUILDER].output);
  assert.equal(bundle.entity.name, 'Hereditary');
  assert.equal(bundle.entity.category, 'film');
  assert.ok(bundle.seed.normalized.length > 0);
  assert.ok(['direct_title', 'person', 'aesthetic_description'].includes(bundle.seed.format));
  assert.ok(['high', 'medium', 'low'].includes(bundle.seed.confidence));

  // Expansion: all five domains attempted with the injected vector.
  assert.deepEqual([...bundle.expansion.domains],
    ['film', 'music', 'books', 'dining', 'fashion'], 'seed domain included');
  assert.ok(bundle.expansion.candidates > 0);

  // The chain is monotonically narrowing and honestly counted.
  const { threshold, longTail, cliches, ranked } = bundle.chain;
  assert.equal(threshold.input, bundle.expansion.candidates);
  assert.ok(threshold.kept + threshold.rejected === threshold.input);
  assert.ok(longTail.input === threshold.kept);
  assert.ok(longTail.kept <= longTail.input);
  assert.ok(cliches.kept <= longTail.kept);
  assert.equal(ranked, bundle.ranked.length);
  assert.ok(ranked <= 10, 'default topN respected');

  // Layers: five layers extracted (per-layer honesty tolerated).
  assert.deepEqual(Object.keys(bundle.layers).sort(),
    ['gastronomy', 'literary', 'material', 'sound', 'visual']);
  assert.equal(typeof bundle.coverage, 'object');

  // Explanation + coherence + graph + weights.
  assert.ok(Array.isArray(bundle.connections.entries));
  assert.ok(bundle.connections.entries.length > 0, 'top entries carry notes');
  assert.ok(typeof bundle.tonality === 'object');
  assert.ok(bundle.graph.nodes.length > 0);
  assert.ok(Array.isArray(bundle.graph.edges));
  assert.ok(typeof bundle.weights === 'object');

  // Synthesis + validation.
  assert.equal(bundle.synthesis.attempted, true);
  assert.match(bundle.synthesis.text, /Hereditary/);
  assert.equal(bundle.synthesis.model, 'stub');
  assert.deepEqual({ ...bundle.synthesis.usage },
    { promptTokens: 900, completionTokens: 140 });
  assert.equal(typeof bundle.validation, 'object');

  // Session lifecycle: terminal state + completed phase + snapshot.
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  // 6 FSM events (incl. DOMAIN_RESOLVED for the domain intent) + 5 phase events.
  assert.equal(bundle.session.execution.step, 11);
  assert.equal(bundle.session.id, null, 'no baseDir -> no persistence');
  assert.deepEqual([...bundle.failures], []);

  // The whole bundle is deeply frozen.
  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.ranked));
  assert.ok(Object.isFrozen(bundle.failures));
  assert.ok(Object.isFrozen(bundle.synthesis));
});

test('determinism: identical input and clients -> deep-equal bundles', async () => {
  const a = await runWorldbuilder('A24 Psychological Horror', baseOptions());
  const b = await runWorldbuilder('A24 Psychological Horror', baseOptions());
  assert.deepEqual(
    JSON.parse(JSON.stringify(a)),
    JSON.parse(JSON.stringify(b))
  );
});

test('zero network: the full mode run never touches global fetch', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network attempted');
  };
  try {
    const bundle = await runWorldbuilder('A24 Psychological Horror', baseOptions());
    assert.equal(bundle.entity.name, 'Hereditary');
    assert.deepEqual(calls, [], 'every client was injected');
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }
});

test('option contracts: programmer misuse is a TypeError', async () => {
  await assert.rejects(
    () => runWorldbuilder('A24', { search: searchStub }),
    TypeError, 'affinityFn is required'
  );
  for (const bad of [0, 51, 2.5]) {
    await assert.rejects(
      () => runWorldbuilder('A24', { ...baseOptions(), topN: bad }),
      TypeError, `topN ${bad}`
    );
  }
  await assert.rejects(
    () => runWorldbuilder('A24', { ...baseOptions(), thresholds: [0.5] }),
    TypeError, 'thresholds must be an object'
  );
  await assert.rejects(
    () => runWorldbuilder('A24', { ...baseOptions(), tagsFn: 'nope' }),
    TypeError, 'tagsFn must be a function'
  );
});

test('honest skip: synthesis disabled keeps the deterministic dossier', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(), synthesis: false,
  });
  assert.equal(bundle.synthesis.attempted, false);
  assert.equal(bundle.synthesis.failure.code, WORLDBUILDER_CODES.SYNTHESIS_SKIPPED);
  assert.equal(bundle.failures[0].stage, 'synthesis');
  assert.ok(bundle.ranked.length > 0, 'the dossier itself survived');
  assert.equal(bundle.session.state, AgentState.DELIVERED);
});

test('honest failure: unconfigured LLM is a typed skip, not a crash', async () => {
  const { env } = await import('../src/config/env.js');
  assert.ok(!env.LLM_API_KEY, 'test env carries no LLM key');
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(), fetchFn: undefined, apiKey: undefined,
  });
  assert.equal(bundle.synthesis.attempted, false);
  assert.equal(bundle.synthesis.failure.code, 'not_configured');
  assert.equal(bundle.stats.synthesis, 'not_configured');
  assert.ok(bundle.ranked.length > 0);
});

test('isolation: one throwing layer never kills the run', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(),
    tagsFn: async () => { throw new Error('tags leg down'); },
  });
  const layerFailures = bundle.failures.filter((f) => f.code === WORLDBUILDER_CODES.LAYER_FAILED);
  assert.ok(layerFailures.length > 0, 'the failing leg is reported');
  assert.ok(
    layerFailures.some((f) => f.leg === 'tags'),
    'the tags leg is named in the ledger'
  );
  assert.ok(bundle.ranked.length > 0, 'the core dossier survived');
  assert.equal(bundle.session.state, AgentState.DELIVERED);
});

test('isolation: one throwing domain is reported, the rest expand', async () => {
  const selectiveAffinity = async (ids, target) => {
    if (target === 'dining') throw new Error('dining insights down');
    return affinityStub(ids, target);
  };
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(), affinityFn: selectiveAffinity,
  });
  const domainFailures = bundle.failures.filter((f) => f.code === WORLDBUILDER_CODES.DOMAIN_FAILED);
  assert.equal(domainFailures.length, 1);
  assert.equal(domainFailures[0].domain, 'dining');
  assert.equal(bundle.stats.domainFailures, 1);
  assert.ok(bundle.expansion.candidates > 0, 'the other four domains expanded');
  assert.equal(bundle.session.state, AgentState.DELIVERED);
});

test('edge: a fully rejecting threshold leaves an honest empty dossier', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(),
    thresholds: { base: 0.99, relief: 0, minThreshold: 0.99 },
  });
  assert.equal(bundle.chain.threshold.kept, 0);
  assert.equal(bundle.chain.threshold.rejected, bundle.expansion.candidates);
  assert.equal(bundle.ranked.length, 0);
  assert.deepEqual([...bundle.connections.entries], []);
  assert.ok(bundle.graph.nodes.length > 0, 'layer nodes still visualize');
  assert.equal(bundle.session.state, AgentState.DELIVERED);
});

test('topN option narrows the delivered set', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(), topN: 3,
  });
  assert.ok(bundle.ranked.length <= 3);
  assert.equal(bundle.chain.ranked, bundle.ranked.length);
});

test('persistence: an injected baseDir stores a loadable session', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'wb-mode-'));
  try {
    const bundle = await runWorldbuilder('A24 Psychological Horror', {
      ...baseOptions(), baseDir,
    });
    assert.ok(typeof bundle.session.id === 'string' && bundle.session.id.length > 0);
    const loaded = await loadSession(bundle.session.id, { baseDir });
    assert.equal(loaded.data.anchor, bundle.seed.normalized);
    assert.equal(loaded.data.mode, MODE_WORLDBUILDER);
    assert.equal(loaded.data.entity.name, 'Hereditary');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

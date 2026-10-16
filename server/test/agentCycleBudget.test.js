/**
 * AGENT CYCLE BUDGET (task 74) — verification that the FULL agent
 * generation cycle runs within the task's hard budget: <= 4.5 seconds
 * on AMD A4-class hardware.
 *
 * METHOD (professional perf-gate practice):
 *   - the cycle mirrors the golden scenarios (tasks 71-73) end to end
 *     over STRESS-SCALED stub data (30-candidate chains, 30-row
 *     expansion pages, all five extraction layers, graph + weights,
 *     synthesis stub, validator, session save/load) so accidental
 *     super-linear regressions BITE the numbers instead of hiding;
 *   - the suite runs the cycle N times and asserts on the MEDIAN
 *     (noise-immune) with a per-run ceiling as well;
 *   - the machine here is not an AMD A4: the local gate is
 *     A4_BUDGET_MS / A4_SLOWDOWN_FACTOR with the factor DOCUMENTED
 *     (conservative 5x single-thread gap for A4-5300-class parts vs
 *     the dev/CI box). The report prints the measured median and the
 *     A4-projected time so the headroom is auditable; if the A4
 *     assumption changes, ONE constant changes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'cycle-budget-key';

// Pure engine modules (env-free) — static imports.
import { resolveSeed } from '../src/engine/SeedResolver.js';
import { classifySeedFormat } from '../src/engine/SeedClassifier.js';
import { AgentSession } from '../src/engine/AgentSession.js';
import {
  AgentEvent, AgentIntent, AgentState,
} from '../src/engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent } from '../src/engine/AgentPhases.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';
import { cutMassCliches } from '../src/engine/PopClicheFilter.js';
import { annotateUniqueness } from '../src/engine/UniquenessCoefficient.js';
import { normalizeArtifactScores } from '../src/engine/ScoreNormalizer.js';
import { sortByNonObvious } from '../src/engine/NonObviousSorter.js';
import { expansionPlan, expandTastes } from '../src/engine/CrossDomainExpander.js';
import { annotateConnections } from '../src/engine/ConnectionNotes.js';
import { checkTonalCoherence } from '../src/engine/TonalityEngine.js';
import { buildContextGraph } from '../src/engine/ContextGraph.js';
import { generateEdgeWeights } from '../src/engine/GraphWeights.js';
import { validateSynthesis } from '../src/engine/OutputValidator.js';

// Env-dependent services — loaded after the env setup (named exports).
const { resolveTextQuery } = await import('../src/services/seedEntityResolver.js');
const { extractSoundProfile } = await import('../src/services/soundExtractor.js');
const { extractLiteraryProfile } = await import('../src/services/literaryExtractor.js');
const { extractMaterialProfile } = await import('../src/services/materialCultureExtractor.js');
const { extractGastronomyContext } = await import('../src/services/gastronomyExtractor.js');
const { extractVisualContext } = await import('../src/services/visualContextExtractor.js');
const { synthesizeDossier } = await import('../src/services/llmSynthesizer.js');
const { saveSession, loadSession } = await import('../src/services/sessionCache.js');

const A4_BUDGET_MS = 4500; // the task contract
const A4_SLOWDOWN_FACTOR = 5; // documented: A4-5300-class vs the dev box
const LOCAL_BUDGET_MS = A4_BUDGET_MS / A4_SLOWDOWN_FACTOR; // 900 ms
const CYCLES = 5;

const ANCHOR = 'A24 Psychological Horror';
const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});
const mediaTag = (value, name) => tag('genre:media', value, name);

// --- stress-scaled deterministic stubs ------------------------------------

const NAMES = [
  'Hereditary', 'Midsommar', 'The Lighthouse', 'The Witch', 'It Comes at Night',
  'The Killing of a Sacred Deer', 'Under the Skin', 'Suspiria', 'Raw', 'It Follows',
];

const searchStub = async () => ({
  results: NAMES.slice(0, 6).map((name, i) => ({
    id: UUID(`a${i}000${i}`), name, subtype: 'urn:entity:movie', popularity: 0.9 - i * 0.1,
    tags: [mediaTag('horror', 'Horror')],
  })),
});

const manyCandidates = Array.from({ length: 30 }, (_, i) => ({
  id: `c${i}`,
  name: `Candidate ${i}`,
  affinity: 0.9 - (i % 10) * 0.03,
  popularity: ((i * 37) % 100) / 100,
}));

const affinityStub = async (ids, urn) => ({
  results: Array.from({ length: 30 }, (_, i) => ({
    id: UUID(`${(i % 16).toString(16).padStart(4, '0').repeat(2).slice(0, 4)}${(i % 16).toString(16).padStart(4, '0')}${(i % 16).toString(16).padStart(4, '0')}${(i % 16).toString(16).padStart(4, '0')}${(i % 16).toString(16).padStart(4, '0')}`),
    name: `Neighbor ${i}`,
    subtype: urn === 'urn:entity:person' ? 'urn:entity:person'
      : urn === 'urn:entity:place' ? 'urn:entity:place'
      : urn === 'urn:entity:brand' ? 'urn:entity:brand'
      : urn === 'urn:entity:book' ? 'urn:entity:book' : 'urn:entity:artist',
    affinity: 0.95 - i * 0.01,
    popularity: (i % 100) / 100,
    tags: [tag(urn.includes('place') ? 'genre:place' : 'genre:music', 'gothic', 'Gothic'), tag('genre:music', 'dark', 'Dark')],
  })),
});

const tagsStub = async (entityId, type) => ({
  results: [
    tag('genre:music', 'post_punk', 'Post-Punk'),
    tag('genre:music', 'gothic', 'Gothic'),
    mediaTag('brutalist', 'Brutalist'),
    mediaTag('monochrome', 'Monochrome'),
  ],
});

/** One FULL agent generation cycle (mirrors the golden scenarios). */
async function runFullCycle(baseDir) {
  // Ingest + format.
  const seed = resolveSeed(ANCHOR);
  const format = classifySeedFormat(seed);

  // Resolution.
  const resolved = await resolveTextQuery(ANCHOR, { search: searchStub });

  // FSM + phase ladder.
  const session = new AgentSession();
  session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'perf' } });
  session.dispatch({ type: AgentEvent.INPUT_VALID });
  session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.CAPABILITIES } });
  session.dispatch({ type: AgentEvent.EXECUTION_SUCCEEDED, payload: { result: { entityId: resolved.entity.id } } });
  session.dispatch({ type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'pinned' } } });
  session.advancePhase({ type: PhaseEvent.START });
  session.advancePhase({ type: PhaseEvent.SEED_RESOLVED, payload: { seed: { id: resolved.entity.id, domain: 'film' } } });
  session.advancePhase({ type: PhaseEvent.AFFINITIES_COLLECTED, payload: { affinities: [] } });
  session.advancePhase({ type: PhaseEvent.ANTITHESIS_READY, payload: { antithesis: {} } });
  session.advancePhase({ type: PhaseEvent.DOSSIER_READY, payload: { dossier: {} } });

  // The math chain over the stress pool.
  const longTail = filterLongTail(manyCandidates);
  const cliches = cutMassCliches(longTail.kept, { alwaysCutAtLeastOne: false });
  const unique = annotateUniqueness(cliches.kept);
  const scaled = normalizeArtifactScores(unique.entries);
  const ranked = sortByNonObvious(scaled.entries);

  // Expansion + the five layers.
  const plan = expansionPlan({ id: resolved.entity.id, domain: 'film' });
  const expansion = expandTastes(plan, {});

  const anchorFor = { id: resolved.entity.id, name: 'Hereditary', category: 'film' };
  const sound = await extractSoundProfile(anchorFor, { affinityFn: affinityStub, searchFn: async () => ({ results: [] }), tagsFn: tagsStub });
  const literary = await extractLiteraryProfile(anchorFor, { affinityFn: affinityStub });
  const material = await extractMaterialProfile(anchorFor, { affinityFn: affinityStub, tagsFn: tagsStub });
  const gastro = await extractGastronomyContext(anchorFor, { affinityFn: affinityStub, tagsFn: tagsStub });
  const visual = await extractVisualContext(anchorFor, { affinityFn: affinityStub, tagsFn: tagsStub });

  // Notes + tonality.
  const connections = annotateConnections(
    ranked.entries.slice(0, 10).map((entry) => ({
      source: { name: 'Hereditary', domain: 'film', tags: [mediaTag('horror', 'Horror')] },
      target: entry,
      percent: Math.round((entry.affinity ?? 0.5) * 100),
    }))
  );
  const tonality = checkTonalCoherence(connections.entries);

  // Graph + weights.
  const graph = buildContextGraph({
    anchor: { id: 'anchor-1', name: ANCHOR, domain: 'film' },
    resolved,
    layers: { sound, literary, material, gastro, visual },
    connections: connections.entries,
  });
  const client = generateEdgeWeights(graph);

  // Synthesis stub + the hallucination backstop.
  const dossier = { anchor: { name: ANCHOR }, entity: resolved.entity, sound };
  const fetchFn = async () => ({
    ok: true, status: 200,
    json: async () => ({
      model: 'stub', usage: { prompt_tokens: 800, completion_tokens: 120 },
      choices: [{ message: { content: '"Hereditary" with "Gothic" markers.' } }],
    }),
  });
  const synthesis = await synthesizeDossier(dossier, { fetchFn, apiKey: 'perf-key' });
  const verdict = validateSynthesis(synthesis.text, dossier);

  // Session persistence.
  const saved = await saveSession(
    { anchor: ANCHOR, ranked: ranked.entries.length, graph: client.stats },
    { baseDir }
  );
  const loaded = await loadSession(saved.id, { baseDir });

  return { format, resolved, session, ranked, expansion, connections, tonality, client, verdict, loaded };
}

test('full agent generation cycle stays inside the AMD A4 budget', async (t) => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'cycle-budget-'));
  const timings = [];

  try {
    // One warmup (JIT, fs caches) — not measured.
    const warm = await runFullCycle(baseDir);
    assert.equal(warm.session.state, AgentState.DELIVERED);
    assert.equal(warm.session.phase, AgentPhase.COMPLETED);
    assert.equal(warm.loaded.data.anchor, ANCHOR, 'the cycle really completed end to end');

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
  const projectedA4 = median * A4_SLOWDOWN_FACTOR;

  // The auditable report.
  console.log(
    `[cycle-budget] median=${median.toFixed(1)}ms worst=${worst.toFixed(1)}ms ` +
      `localBudget=${LOCAL_BUDGET_MS}ms A4-projected=${projectedA4.toFixed(0)}ms ` +
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

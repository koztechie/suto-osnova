/**
 * ENGINE A24 SCENARIO (task 71) — the automated agent run for the test
 * anchor "A24 Psychological Horror": a golden end-to-end walk through
 * the whole deterministic stack with INJECTED clients (zero network).
 *
 * The scenario proves the pieces COMPOSE: ingest -> format recognition
 * -> verified resolution -> FSM + phase-ladder driving -> the math
 * chain (56-61) -> cross-domain expansion -> the five extraction
 * layers -> explanatory notes -> tonal coherence -> context graph ->
 * client weights -> LLM synthesis with the hallucination backstop ->
 * session cache persistence. Every service receives a canned A24-
 * flavored catalog (dark psychological horror aesthetics), so the run
 * is reproducible byte-for-byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Repo pattern: env before the env-dependent modules load.
process.env.QLOO_API_KEY = 'a24-scenario-key';

// Pure engine modules (env-free) — static imports.
import { resolveSeed } from '../server/src/engine/SeedResolver.js';
import { classifySeedFormat } from '../server/src/engine/SeedClassifier.js';
import { AgentSession } from '../server/src/engine/AgentSession.js';
import {
  AgentEvent, AgentIntent, AgentState,
} from '../server/src/engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent } from '../server/src/engine/AgentPhases.js';
import { filterLongTail } from '../server/src/engine/LongTailFilter.js';
import { cutMassCliches } from '../server/src/engine/PopClicheFilter.js';
import { annotateUniqueness } from '../server/src/engine/UniquenessCoefficient.js';
import { normalizeArtifactScores } from '../server/src/engine/ScoreNormalizer.js';
import { sortByNonObvious } from '../server/src/engine/NonObviousSorter.js';
import { expansionPlan, expandTastes } from '../server/src/engine/CrossDomainExpander.js';
import { annotateConnections } from '../server/src/engine/ConnectionNotes.js';
import { checkTonalCoherence } from '../server/src/engine/TonalityEngine.js';
import { buildContextGraph } from '../server/src/engine/ContextGraph.js';
import { generateEdgeWeights } from '../server/src/engine/GraphWeights.js';
import { validateSynthesis } from '../server/src/engine/OutputValidator.js';

// Env-dependent services — loaded after the env setup (named exports).
const { resolveTextQuery } = await import('../server/src/services/seedEntityResolver.js');
const { extractSoundProfile } = await import('../server/src/services/soundExtractor.js');
const { extractLiteraryProfile } = await import('../server/src/services/literaryExtractor.js');
const { extractMaterialProfile } = await import('../server/src/services/materialCultureExtractor.js');
const { extractGastronomyContext } = await import('../server/src/services/gastronomyExtractor.js');
const { extractVisualContext } = await import('../server/src/services/visualContextExtractor.js');
const { synthesizeDossier } = await import('../server/src/services/llmSynthesizer.js');
const { saveSession, loadSession, createSessionId } = await import('../server/src/services/sessionCache.js');

const ANCHOR = 'A24 Psychological Horror';
const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});
const mediaTag = (value, name) => tag('genre:media', value, name);

// --- the canned A24-flavored catalog (deterministic stubs) ---------------

const HEREDITARY = {
  id: UUID('A240001'), name: 'Hereditary', subtype: 'urn:entity:movie',
  popularity: 0.8,
  tags: [mediaTag('horror', 'Horror'), mediaTag('grief', 'Grief'), mediaTag('dysfunctional_family', 'Dysfunctional Family')],
};
const MIDSOMMAR = {
  id: UUID('A240002'), name: 'Midsommar', subtype: 'urn:entity:movie',
  popularity: 0.75,
  tags: [mediaTag('horror', 'Horror'), mediaTag('folk', 'Folk'), mediaTag('daylight', 'Daylight')],
};
const LIGHTHOUSE = {
  id: UUID('A240003'), name: 'The Lighthouse', subtype: 'urn:entity:movie',
  popularity: 0.5,
  tags: [mediaTag('horror', 'Horror'), mediaTag('noir', 'Noir'), mediaTag('black_and_white', 'Black And White')],
};

const searchStub = async (query) => {
  if (query.includes('A24')) return { results: [HEREDITARY, MIDSOMMAR] };
  return { results: [] };
};

const PERSONS = [
  { id: UUID('PER0001'), name: 'Thomas Ligotti', subtype: 'urn:entity:person', affinity: 0.9, popularity: 0.1, tags: [tag('genre:book', 'essays', 'Essays'), tag('genre:book', 'weird_fiction', 'Weird Fiction')] },
  { id: UUID('PER0002'), name: 'Cormac McCarthy', subtype: 'urn:entity:person', affinity: 0.7, popularity: 0.5, tags: [tag('genre:book', 'american_gothic', 'American Gothic')] },
  { id: UUID('PER0003'), name: 'Mainstream Author', subtype: 'urn:entity:person', affinity: 0.5, popularity: 0.9, tags: [] },
];

const affinityStub = async (ids, urn) => {
  if (urn === 'urn:entity:person') {
    return { results: PERSONS };
  }
  if (urn === 'urn:entity:artist') {
    return {
      results: [
        { id: UUID('MUS0001'), name: 'Bohren & der Club of Gore', subtype: 'urn:entity:artist', affinity: 0.88, popularity: 0.15, tags: [tag('genre:music', 'dark_jazz', 'Dark Jazz'), tag('genre:music', 'noir', 'Noir')] },
        { id: UUID('MUS0002'), name: 'Dead Can Dance', subtype: 'urn:entity:artist', affinity: 0.82, popularity: 0.4, tags: [tag('genre:music', 'gothic', 'Gothic'), tag('genre:music', 'darkwave', 'Darkwave')] },
      ],
    };
  }
  if (urn === 'urn:entity:book') {
    return {
      results: [
        { id: UUID('BOK0001'), name: 'Songs of a Dead Dreamer', subtype: 'urn:entity:book', affinity: 0.9, popularity: 0.1, tags: [tag('genre:book', 'weird_fiction', 'Weird Fiction')] },
        { id: UUID('BOK0002'), name: 'Blood Meridian', subtype: 'urn:entity:book', affinity: 0.7, popularity: 0.5, tags: [tag('genre:book', 'american_gothic', 'American Gothic')] },
        { id: UUID('BOK0003'), name: 'Mainstream Bestseller', subtype: 'urn:entity:book', affinity: 0.5, popularity: 0.9, tags: [] },
      ],
    };
  }
  if (urn === 'urn:entity:place') {
    return {
      results: [
        { id: UUID('PLC0001'), name: 'Noir Speakeasy', subtype: 'urn:entity:place', affinity: 0.8, popularity: 0.2,
          tags: [tag('genre:place', 'speakeasy', 'Speakeasy'), tag('genre:place', 'dark_interior', 'Dark Interior'), tag('genre:place', 'restaurant', 'Restaurant')] },
      ],
    };
  }
  if (urn === 'urn:entity:brand') {
    return {
      results: [
        { id: UUID('BRD0001'), name: 'Gloom Atelier', subtype: 'urn:entity:brand', affinity: 0.78, popularity: 0.12,
          tags: [tag('genre:brand', 'streetwear', 'Streetwear'), tag('genre:brand', 'velvet', 'Velvet')] },
      ],
    };
  }
  if (urn === 'urn:entity:movie') {
    return {
      results: [
        { ...LIGHTHOUSE, affinity: 0.85 },
        { ...MIDSOMMAR, affinity: 0.8 },
        { id: UUID('MOV0009'), name: 'Blockbuster Sequel', subtype: 'urn:entity:movie', affinity: 0.7, popularity: 0.99, tags: [mediaTag('action', 'Action')] },
      ],
    };
  }
  return { results: [] };
};

const tagsStub = async (entityId, type) => {
  // Material types include BOTH place and media families — media must
  // be checked first so the brutalism/gothic markers arrive.
  if (Array.isArray(type) && type.some((t) => t.includes('media'))) {
    return { results: [mediaTag('gothic', 'Gothic'), mediaTag('brutalist', 'Brutalist')] };
  }
  if (Array.isArray(type) && type.some((t) => t.includes('place'))) {
    return { results: [tag('genre:place', 'speakeasy', 'Speakeasy')] };
  }
  return { results: [] };
};

test('agent run: "A24 Psychological Horror" end to end', async (t) => {
  const ctx = {};

  await t.test('step 1: ingest and format recognition', () => {
    const seed = resolveSeed(ANCHOR);
    assert.equal(seed.normalized, ANCHOR);

    const format = classifySeedFormat(seed);
    assert.equal(format.format, 'direct_title', 'pinned deterministic classification');
    assert.equal(format.confidence, 'low');
    ctx.seed = seed;
  });

  await t.test('step 2: verified resolution into the film domain', async () => {
    const resolved = await resolveTextQuery(ANCHOR, { search: searchStub });
    assert.equal(resolved.verified, true);
    assert.equal(resolved.entity.name, 'Hereditary', 'top-ranked exact-less candidate');
    assert.equal(resolved.entity.category, 'film');
    assert.ok(resolved.entity.id.startsWith('A240001'), 'Qloo-issued id, never synthesized');
    ctx.resolved = resolved;
  });

  await t.test('step 3: FSM + phase ladder drive the session to the dossier', () => {
    const session = new AgentSession();

    session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'a24-run' } });
    session.dispatch({ type: AgentEvent.INPUT_VALID });
    session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.CAPABILITIES } });
    assert.equal(session.state, AgentState.EXECUTE);

    const snapshotMid = session.getExecutionSnapshot();
    assert.equal(snapshotMid.step, 3);
    assert.ok(Object.isFrozen(snapshotMid));

    session.dispatch({
      type: AgentEvent.EXECUTION_SUCCEEDED,
      payload: { result: { entityId: ctx.resolved.entity.id, category: 'film' } },
    });
    session.dispatch({ type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'pinned' } } });

    session.advancePhase({ type: PhaseEvent.START });
    session.advancePhase({
      type: PhaseEvent.SEED_RESOLVED,
      payload: { seed: { id: ctx.resolved.entity.id, domain: 'film' } },
    });
    session.advancePhase({ type: PhaseEvent.AFFINITIES_COLLECTED, payload: { affinities: [] } });
    session.advancePhase({ type: PhaseEvent.ANTITHESIS_READY, payload: { antithesis: {} } });
    session.advancePhase({ type: PhaseEvent.DOSSIER_READY, payload: { dossier: {} } });

    assert.equal(session.state, AgentState.DELIVERED);
    assert.equal(session.phase, AgentPhase.COMPLETED);
    assert.equal(session.getExecutionSnapshot().step, 10);
    ctx.session = session;
  });

  await t.test('step 4: the math chain cuts the noise, keeps the non-obvious', () => {
    const candidates = [
      { id: 'c1', name: 'Hereditary', affinity: 0.92, popularity: 0.8 },
      { id: 'c2', name: 'The Lighthouse', affinity: 0.85, popularity: 0.5 },
      { id: 'c3', name: 'Blockbuster Sequel', affinity: 0.72, popularity: 0.99 },
      { id: 'c4', name: 'Obscure Indie', affinity: 0.8, popularity: 0.002 },
    ];

    const longTail = filterLongTail(candidates);
    assert.ok(!longTail.kept.some((e) => e.id === 'c3'), 'fame-explained noise cut (task 56)');

    // The felt-minimum valve would cut ONE survivor from a 3-entry
    // pool; the scenario runs the pure floor (documented option).
    const cliches = cutMassCliches(longTail.kept, { alwaysCutAtLeastOne: false });
    assert.equal(cliches.stats.cutCount, 0, 'survivors are provably non-banal (task 58)');

    const unique = annotateUniqueness(cliches.kept);
    const scaled = normalizeArtifactScores(unique.entries);
    const ranked = sortByNonObvious(scaled.entries);

    assert.equal(ranked.entries[0].id, 'c4', 'the rare confirmed correlation leads (task 61)');
    assert.ok(ranked.entries[0].sorting.surprise > ranked.entries[1].sorting.surprise);
    assert.equal(ranked.entries[0].uniqueness.tier, 'long_tail', 'U(0.002) ~= 0.45');
    ctx.ranked = ranked;
  });

  await t.test('step 5: cross-domain expansion off the resolved seed', () => {
    const plan = expansionPlan({ id: ctx.resolved.entity.id, domain: ctx.resolved.entity.category });
    assert.deepEqual([...plan.domains], ['music', 'books', 'dining', 'fashion']);

    const expansion = expandTastes(plan, {});
    assert.equal(expansion.coverage.planned, 4);
    ctx.plan = plan;
  });

  await t.test('step 6: the five extraction layers', async () => {
    const anchorFor = { id: ctx.resolved.entity.id, name: 'Hereditary', category: 'film' };

    const sound = await extractSoundProfile(anchorFor, {
      affinityFn: affinityStub, searchFn: async () => ({ results: [] }), tagsFn: tagsStub,
    });
    assert.deepEqual(sound.artists.map((a) => a.name), ['Bohren & der Club of Gore', 'Dead Can Dance']);
    assert.ok(sound.genres.some((g) => g.name === 'Gothic'));

    const literary = await extractLiteraryProfile(anchorFor, { affinityFn: affinityStub });
    assert.deepEqual(literary.authors.map((a) => a.name), ['Thomas Ligotti', 'Cormac McCarthy']);
    assert.equal(literary.coverage.droppedBelowCorrelation, 2, 'the 0.65 gate drops one author AND one text');
    assert.equal(literary.essayists.length, 1, 'Ligotti carries the essay marker');

    const material = await extractMaterialProfile(anchorFor, {
      affinityFn: affinityStub, tagsFn: tagsStub,
    });
    assert.ok(material.architecture.some((a) => a.name === 'Brutalist'));
    assert.ok(material.objects.some((o) => o.name === 'Noir Speakeasy'));

    const gastro = await extractGastronomyContext(anchorFor, {
      affinityFn: affinityStub, tagsFn: tagsStub,
    });
    assert.ok(gastro.venueTypes.some((v) => v.name === 'Speakeasy'));

    const visual = await extractVisualContext(anchorFor, {
      affinityFn: affinityStub, tagsFn: tagsStub,
    });
    assert.ok(visual.films.some((f) => f.name === 'The Lighthouse'));

    ctx.layers = { sound, literary, material, gastro, visual };
  });

  await t.test('step 7: explanatory notes and a single dark tonality', () => {
    const connections = annotateConnections([
      {
        source: { name: 'Hereditary', domain: 'film', tags: [mediaTag('horror', 'Horror')] },
        target: { name: 'Dead Can Dance', category: 'music', affinity: 0.82, popularity: 0.4, tags: [tag('genre:music', 'gothic', 'Gothic')] },
        percent: 82,
      },
      {
        source: { name: 'Hereditary', domain: 'film', tags: [mediaTag('horror', 'Horror')] },
        target: { name: 'Blockbuster Pop Act', category: 'music', affinity: 0.8, popularity: 0.95 },
        percent: 80,
      },
    ]);
    assert.ok(connections.entries[0].note.includes('film -> music bridge'));
    assert.equal(connections.entries[0].confidence, 'evidence_backed');

    const tonality = checkTonalCoherence(connections.entries);
    assert.equal(tonality.stats.classified, 1, 'the mass pick carries no tone evidence');
    assert.equal(tonality.coherent, true, 'one dark tonality, no dissenters');
    ctx.connections = connections;
    ctx.tonality = tonality;
  });

  await t.test('step 8: context graph and client-ready weights', () => {
    const graph = buildContextGraph({
      anchor: { id: 'anchor-1', name: ANCHOR, domain: 'film' },
      resolved: ctx.resolved,
      layers: ctx.layers,
      connections: ctx.connections.entries,
    });
    assert.ok(graph.stats.nodesByKind.entity > 0);
    assert.ok(graph.edges.some((e) => e.type === 'connection'));

    const client = generateEdgeWeights(graph);
    assert.ok(client.edges.every((e) => Number.isFinite(e.weight) && e.weight > 0));
    assert.ok(client.nodes.some((n) => n.strength > 0.8), 'the anchor hub dominates');
    ctx.graph = client;
  });

  await t.test('step 9: LLM synthesis with the hallucination backstop', async () => {
    const dossier = {
      anchor: { name: ANCHOR },
      entity: ctx.resolved.entity,
      ranked: ctx.ranked.entries,
      sound: ctx.layers.sound,
      material: ctx.layers.material,
      notes: ctx.connections.entries.map((e) => e.note),
      graph: { nodes: ctx.graph.nodes.length, edges: ctx.graph.edges.length },
    };
    const prose =
      '"Hereditary" anchors the dossier; "Bohren & der Club of Gore" ' +
      'and Dead Can Dance carry its dark jazz/gothic sound, with ' +
      '"Gothic" and "Brutalist" marking the visual-material layer.';

    const fetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({
        model: 'stub-model',
        choices: [{ message: { content: prose } }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      }),
    });

    const synthesis = await synthesizeDossier(dossier, { fetchFn, apiKey: 'scenario-key' });
    assert.equal(synthesis.text, prose);

    const verdict = validateSynthesis(synthesis.text, dossier);
    assert.deepEqual(verdict.hallucinated, [], 'the backstop passes the honest prose');
    assert.equal(verdict.ok, true);
    assert.ok(verdict.matched >= 4, 'every name traced to the payload');
    ctx.synthesis = synthesis;
  });

  await t.test('step 10: the session persists in the UUID cache', async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'a24-session-'));
    try {
      const session = {
        anchor: ANCHOR,
        resolved: ctx.resolved.entity,
        ranked: ctx.ranked.entries,
        notes: ctx.connections.entries.map((e) => e.note),
        tonality: ctx.tonality.stats,
        graph: ctx.graph.stats,
        synthesis: ctx.synthesis.text,
        fsm: { state: ctx.session.state, phase: ctx.session.phase },
      };

      const saved = await saveSession(session, { baseDir });
      const loaded = await loadSession(saved.id, { baseDir });

      assert.match(saved.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(loaded.data, session, 'the whole run roundtrips');
      assert.equal(loaded.data.fsm.state, AgentState.DELIVERED);
      assert.equal(loaded.data.fsm.phase, AgentPhase.COMPLETED);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

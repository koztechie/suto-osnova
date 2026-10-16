/**
 * ENGINE POST-PUNK SCENARIO (task 72) — the automated agent-run test
 * for the anchor "1970s Post-Punk".
 *
 * Where the A24 scenario (task 71) walked the happy breadth, this run
 * deliberately exercises DIFFERENT branches of the stack with injected
 * clients (zero network): the DOMAIN-intent FSM path (INTENT -> DOMAIN
 * -> DOMAIN_RESOLVED -> EXECUTE), resolution under an explicit music
 * domain hint, the task-67 ADAPTIVE THRESHOLD gate (a rare band with
 * moderate affinity passes, an equally-scored famous one fails), a
 * tonal OUTLIER (coherence fails honestly), a CAUGHT hallucination in
 * the synthesis backstop, the task-69 RELATIVE weight scale and the
 * session-cache RESUME (explicit-id overwrite) path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'postpunk-scenario-key';

// Pure engine modules (env-free) — static imports.
import { resolveSeed } from '../server/src/engine/SeedResolver.js';
import { classifySeedFormat } from '../server/src/engine/SeedClassifier.js';
import { AgentSession } from '../server/src/engine/AgentSession.js';
import {
  AgentEvent, AgentIntent, AgentState,
} from '../server/src/engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent } from '../server/src/engine/AgentPhases.js';
import { filterLongTail } from '../server/src/engine/LongTailFilter.js';
import { filterByAdaptiveThreshold } from '../server/src/engine/AdaptiveThreshold.js';
import { expansionPlan, expandTastes } from '../server/src/engine/CrossDomainExpander.js';
import { annotateConnections } from '../server/src/engine/ConnectionNotes.js';
import { checkTonalCoherence } from '../server/src/engine/TonalityEngine.js';
import { buildContextGraph } from '../server/src/engine/ContextGraph.js';
import { generateEdgeWeights } from '../server/src/engine/GraphWeights.js';
import { validateSynthesis } from '../server/src/engine/OutputValidator.js';

// Env-dependent services — loaded after the env setup (named exports).
const { resolveTextQuery } = await import('../server/src/services/seedEntityResolver.js');
const { extractSoundProfile } = await import('../server/src/services/soundExtractor.js');
const { extractVisualContext } = await import('../server/src/services/visualContextExtractor.js');
const { synthesizeDossier } = await import('../server/src/services/llmSynthesizer.js');
const { saveSession, loadSession } = await import('../server/src/services/sessionCache.js');

const ANCHOR = '1970s Post-Punk';
const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});
const mediaTag = (value, name) => tag('genre:media', value, name);

// --- the canned post-punk catalog (deterministic stubs) -------------------

const JOY_DIVISION = {
  id: UUID('aa0001'), name: 'Joy Division', subtype: 'urn:entity:artist',
  popularity: 0.7,
  tags: [tag('genre:music', 'post_punk', 'Post-Punk'), tag('genre:music', 'gothic', 'Gothic'), tag('genre:music', 'minimal', 'Minimal')],
};
const BAUHAUS_BAND = {
  id: UUID('bb0002'), name: 'Bauhaus', subtype: 'urn:entity:artist',
  popularity: 0.45,
  tags: [tag('genre:music', 'post_punk', 'Post-Punk'), tag('genre:music', 'gothic', 'Gothic'), tag('genre:music', 'darkwave', 'Darkwave')],
};

const searchStub = async (query) => {
  if (query.includes('Post-Punk')) {
    return { results: [JOY_DIVISION, BAUHAUS_BAND] };
  }
  return { results: [] };
};

const affinityStub = async (ids, urn) => {
  if (urn === 'urn:entity:artist') {
    return {
      results: [
        { ...BAUHAUS_BAND, affinity: 0.86 },
        { id: UUID('cc0003'), name: 'The Sisters of Mercy', subtype: 'urn:entity:artist', affinity: 0.8, popularity: 0.5, tags: [tag('genre:music', 'gothic', 'Gothic'), tag('genre:music', 'darkwave', 'Darkwave')] },
      ],
    };
  }
  if (urn === 'urn:entity:movie') {
    return {
      results: [
        { id: UUID('dd0001'), name: '24 Hour Party People', subtype: 'urn:entity:movie', affinity: 0.84, popularity: 0.4, tags: [mediaTag('music_film', 'Music Film'), mediaTag('noir', 'Noir')] },
        { id: UUID('ee0002'), name: 'Blockbuster Musical', subtype: 'urn:entity:movie', affinity: 0.8, popularity: 0.97, tags: [mediaTag('musical', 'Musical'), mediaTag('bright', 'Bright')] },
      ],
    };
  }
  return { results: [] };
};

const tagsStub = async (entityId, type) => {
  if (typeof type === 'string' && type.includes('music')) {
    return { results: [tag('genre:music', 'post_punk', 'Post-Punk'), tag('genre:music', 'gothic', 'Gothic')] };
  }
  return { results: [] };
};

test('agent run: "1970s Post-Punk" end to end', async (t) => {
  const ctx = {};

  await t.test('step 1: ingest and format recognition', () => {
    const seed = resolveSeed(ANCHOR);
    assert.equal(seed.normalized, ANCHOR);

    const format = classifySeedFormat(seed);
    assert.equal(format.format, 'direct_title', 'pinned: the era prefix blocks the title run');
    assert.equal(format.confidence, 'low');
    ctx.seed = seed;
  });

  await t.test('step 2: resolution under an explicit music domain hint', async () => {
    const resolved = await resolveTextQuery(ANCHOR, { domain: 'music', search: searchStub });
    assert.equal(resolved.verified, true);
    assert.equal(resolved.entity.name, 'Joy Division', 'highest popularity among fuzzy matches');
    assert.equal(resolved.entity.category, 'music');
    ctx.resolved = resolved;
  });

  await t.test('step 3: the DOMAIN-intent FSM path reaches EXECUTE', () => {
    const session = new AgentSession();

    session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'pp-run' } });
    session.dispatch({ type: AgentEvent.INPUT_VALID });
    session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.SEARCH } });
    assert.equal(session.state, AgentState.DOMAIN, 'domain intents route through DOMAIN');

    session.dispatch({ type: AgentEvent.DOMAIN_RESOLVED, payload: { domains: ['music'] } });
    assert.equal(session.state, AgentState.EXECUTE);

    session.dispatch({
      type: AgentEvent.EXECUTION_SUCCEEDED,
      payload: { result: { entityId: ctx.resolved.entity.id } },
    });
    session.dispatch({ type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'pinned' } } });

    session.advancePhase({ type: PhaseEvent.START });
    session.advancePhase({ type: PhaseEvent.SEED_RESOLVED, payload: { seed: { id: ctx.resolved.entity.id, domain: 'music' } } });
    session.advancePhase({ type: PhaseEvent.AFFINITIES_COLLECTED, payload: { affinities: [] } });
    session.advancePhase({ type: PhaseEvent.ANTITHESIS_READY, payload: { antithesis: {} } });
    session.advancePhase({ type: PhaseEvent.DOSSIER_READY, payload: { dossier: {} } });

    assert.equal(session.state, AgentState.DELIVERED);
    assert.equal(session.phase, AgentPhase.COMPLETED);
    ctx.session = session;
  });

  await t.test('step 4: the adaptive threshold gate (task 67)', () => {
    const candidates = [
      { id: 'rare', name: 'Contemporary Post-Punk Revival', affinity: 0.55, popularity: 0.001 },
      { id: 'famous', name: 'Festival Headliner', affinity: 0.55, popularity: 0.7 },
      { id: 'blind', name: 'Unscored Act' },
    ];

    const longTail = filterLongTail(candidates);
    assert.equal(longTail.kept.length, 3, 'all carry positive excess (task 56)');

    const gated = filterByAdaptiveThreshold(longTail.kept);
    assert.deepEqual(gated.kept.map((e) => e.id), ['rare'], 'rarity buys the relief');
    assert.deepEqual(gated.rejected.map((e) => e.id), ['famous', 'blind']);
    assert.deepEqual(gated.rejected.map((e) => e.reason), ['below_threshold', 'no_affinity']);
    assert.ok(gated.kept[0].threshold.margin > 0, 'the rare band clears its relieved gate');
    ctx.gated = gated;
  });

  await t.test('step 5: expansion off the music seed', () => {
    const plan = expansionPlan({ id: ctx.resolved.entity.id, domain: 'music' });
    assert.deepEqual([...plan.domains], ['film', 'books', 'dining', 'fashion']);

    const expansion = expandTastes(plan, {});
    assert.equal(expansion.coverage.planned, 4);
    assert.equal(expansion.totals.entities, 0, 'honest empty expansion over empty payloads');
    ctx.plan = plan;
  });

  await t.test('step 6: the sound and visual layers', async () => {
    const anchorFor = { id: ctx.resolved.entity.id, name: 'Joy Division', category: 'music' };

    const sound = await extractSoundProfile(anchorFor, {
      affinityFn: affinityStub,
      searchFn: async () => ({ results: [] }),
      tagsFn: tagsStub,
    });
    assert.deepEqual(sound.artists.map((a) => a.name), ['Bauhaus', 'The Sisters of Mercy']);
    assert.ok(sound.genres.some((g) => g.name === 'Post-Punk'), 'anchor-scoped genre catalog');
    assert.ok(sound.genres.some((g) => g.name === 'Gothic'));

    const visual = await extractVisualContext(anchorFor, {
      affinityFn: affinityStub, tagsFn: async () => ({ results: [] }),
    });
    assert.ok(visual.films.some((f) => f.name === '24 Hour Party People'));

    ctx.layers = { sound, visual };
  });

  await t.test('step 7: a tonal OUTLIER is caught honestly (task 66)', () => {
    const darkTag = (name) => ({ id: `urn:tag:genre:music:${name.toLowerCase()}`, name, type: 'urn:tag:genre:music' });
    const connections = annotateConnections([
      { source: { name: 'Joy Division', domain: 'music' }, target: { name: 'Bauhaus', category: 'music', affinity: 0.86, popularity: 0.45, tags: [darkTag('Gothic'), darkTag('Darkwave')] }, percent: 86 },
      { source: { name: 'Joy Division', domain: 'music' }, target: { name: 'The Sisters of Mercy', category: 'music', affinity: 0.8, popularity: 0.5, tags: [darkTag('Gothic'), darkTag('Minimal')] }, percent: 80 },
      { source: { name: 'Joy Division', domain: 'music' }, target: { name: 'Clan of Xymox', category: 'music', affinity: 0.78, popularity: 0.3, tags: [darkTag('Darkwave'), darkTag('Noir')] }, percent: 78 },
      { source: { name: 'Joy Division', domain: 'music' }, target: { name: 'Sunshine Pop Revival', category: 'music', affinity: 0.75, popularity: 0.35, tags: [{ id: 'urn:tag:genre:music:cheerful', name: 'Cheerful', type: 'urn:tag:genre:music' }, { id: 'urn:tag:genre:music:bright', name: 'Bright', type: 'urn:tag:genre:music' }] }, percent: 75 },
    ]);

    const tonality = checkTonalCoherence(connections.entries);
    assert.equal(tonality.stats.classified, 4, 'every connection carries tone evidence');
    const outlier = tonality.connections.find((c) => c.name === 'Sunshine Pop Revival');
    assert.equal(outlier.outlier, true, 'the cheerful pick deviates from the dark centroid');
    assert.equal(tonality.coherent, false, 'honest incoherence report');
    assert.equal(tonality.stats.outliers, 1);
    ctx.connections = connections;
    ctx.tonality = tonality;
  });

  await t.test('step 8: the graph on the RELATIVE weight scale (task 69)', () => {
    const graph = buildContextGraph({
      anchor: { id: 'anchor-1', name: ANCHOR, domain: 'music' },
      resolved: ctx.resolved,
      layers: ctx.layers,
      connections: ctx.connections.entries,
    });

    const client = generateEdgeWeights(graph, { mode: 'relative' });
    const weights = client.edges.map((e) => e.weight);
    assert.ok(weights.every((w) => Number.isFinite(w) && w >= 0), 'relative scale includes 0');
    assert.equal(Math.min(...weights), 0, 'the weakest link lands at 0%');
    assert.ok(Math.max(...weights) > 0, 'the strongest above');
    assert.ok(client.nodes.some((n) => n.strength > 0.5), 'the anchor hub dominates its era');
    ctx.graph = client;
  });

  await t.test('step 9: the backstop CAUGHT a hallucinated band', async () => {
    const dossier = {
      anchor: { name: ANCHOR },
      entity: ctx.resolved.entity,
      sound: ctx.layers.sound,
    };
    const prose =
      'The dossier traces post-punk through "Bauhaus", "The Sisters of ' +
      'Mercy" and the invented "Kraftwerk" connection.';

    const fetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({ model: 'stub-model', choices: [{ message: { content: prose } }] }),
    });

    const synthesis = await synthesizeDossier(dossier, { fetchFn, apiKey: 'scenario-key' });
    const verdict = validateSynthesis(synthesis.text, dossier);

    assert.equal(verdict.ok, false, 'the validator rejects the fabricated name');
    assert.deepEqual(verdict.hallucinated.map((h) => h.mention), ['Kraftwerk']);
    assert.equal(verdict.hallucinated[0].form, 'quoted');
    assert.ok(verdict.matched >= 2, 'the honest names still traced');
    ctx.verdict = verdict;
  });

  await t.test('step 10: session RESUME — explicit-id overwrite in the cache', async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'pp-session-'));
    try {
      const id = '2f7c9a1e-4b6d-4e8f-9a2b-3c5d7e9f1a2b';
      const draft = { anchor: ANCHOR, stage: 'draft' };
      const final = {
        anchor: ANCHOR,
        resolved: ctx.resolved.entity.name,
        gated: ctx.gated.kept.map((e) => e.name),
        tonality: ctx.tonality.stats,
        verdict: ctx.verdict.hallucinated.map((h) => h.mention),
        fsm: { state: ctx.session.state, phase: ctx.session.phase },
      };

      await saveSession(draft, { baseDir, id });
      await saveSession(final, { baseDir, id });
      const loaded = await loadSession(id, { baseDir });

      assert.deepEqual(loaded.data, final, 'the resumed session replaced the draft');
      assert.equal(loaded.data.fsm.state, AgentState.DELIVERED);
      assert.equal(loaded.data.fsm.phase, AgentPhase.COMPLETED);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

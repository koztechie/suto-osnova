/**
 * ENGINE BRUTALISM SCENARIO (task 73) — the automated agent-run test
 * for the anchor "Brutalist Architecture".
 *
 * The third golden scenario broadens branch coverage further (injected
 * clients, zero network): the DISAMBIGUATION FSM path
 * (DOMAIN -> DOMAIN_UNRESOLVED -> DISAMBIGUATION ->
 * CLARIFICATION_PROVIDED -> DOMAIN -> DOMAIN_RESOLVED -> EXECUTE), an
 * EXACT-match resolution under a books hint, the PopClicheFilter
 * felt-minimum valve in its DEFAULT on-state, the material-culture
 * layer as the PRIMARY lens (brutalist architecture + concrete
 * textures), the brutalist MINIMAL tonal signature (centroid on the
 * minimal axis), a synthesis caught with TWO fabricated names and the
 * session-cache list/delete lifecycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'brutalism-scenario-key';

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
import { normalizeArtifactScores } from '../server/src/engine/ScoreNormalizer.js';
import { sortByNonObvious } from '../server/src/engine/NonObviousSorter.js';
import { annotateConnections } from '../server/src/engine/ConnectionNotes.js';
import { checkTonalCoherence } from '../server/src/engine/TonalityEngine.js';
import { buildContextGraph } from '../server/src/engine/ContextGraph.js';
import { generateEdgeWeights } from '../server/src/engine/GraphWeights.js';
import { validateSynthesis } from '../server/src/engine/OutputValidator.js';

// Env-dependent services — loaded after the env setup (named exports).
const { resolveTextQuery } = await import('../server/src/services/seedEntityResolver.js');
const { extractMaterialProfile } = await import('../server/src/services/materialCultureExtractor.js');
const { extractVisualContext } = await import('../server/src/services/visualContextExtractor.js');
const { synthesizeDossier } = await import('../server/src/services/llmSynthesizer.js');
const {
  saveSession, loadSession, listSessions, deleteSession, createSessionId,
} = await import('../server/src/services/sessionCache.js');

const ANCHOR = 'Brutalist Architecture';
const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});
const mediaTag = (value, name) => tag('genre:media', value, name);

// --- the canned brutalist catalog (deterministic stubs) -------------------

const ANTHOLOGY = {
  id: UUID('ba0001'), name: 'Brutalist Architecture', subtype: 'urn:entity:book',
  popularity: 0.35,
  tags: [tag('genre:book', 'architecture', 'Architecture'), tag('genre:book', 'essays', 'Essays')],
};

const searchStub = async (query) => {
  if (query === 'Brutalist Architecture') {
    // The clean probe matches the anthology title EXACTLY.
    return { results: [ANTHOLOGY] };
  }
  return { results: [] };
};

const NATIONAL_THEATRE = {
  id: UUID('ce0001'), name: 'National Theatre', subtype: 'urn:entity:place',
  affinity: 0.88, popularity: 0.5,
  tags: [tag('genre:place', 'brutalist', 'Brutalist'), tag('genre:place', 'minimal', 'Minimal'), tag('genre:place', 'interior', 'Interior'), tag('genre:place', 'restaurant', 'Restaurant')],
};
const CONCRETE_FORM = {
  id: UUID('ce0002'), name: 'Concrete Form', subtype: 'urn:entity:brand',
  affinity: 0.72, popularity: 0.1,
  tags: [tag('genre:brand', 'streetwear', 'Streetwear'), tag('genre:brand', 'concrete', 'Concrete')],
};

const affinityStub = async (ids, urn) => {
  if (urn === 'urn:entity:place') return { results: [NATIONAL_THEATRE] };
  if (urn === 'urn:entity:brand') return { results: [CONCRETE_FORM] };
  if (urn === 'urn:entity:movie') {
    return {
      results: [
        { id: UUID('de0001'), name: 'Koyaanisqatsi', subtype: 'urn:entity:movie', affinity: 0.83, popularity: 0.3, tags: [mediaTag('minimal', 'Minimal'), mediaTag('industrial', 'Industrial')] },
      ],
    };
  }
  return { results: [] };
};

const materialTagsStub = async (entityId, type) => {
  if (Array.isArray(type) && type.some((t) => t.includes('media'))) {
    return {
      results: [
        mediaTag('brutalist', 'Brutalist'),
        mediaTag('concrete', 'Concrete'),
        mediaTag('monochrome', 'Monochrome'),
      ],
    };
  }
  return { results: [] };
};

test('agent run: "Brutalist Architecture" end to end', async (t) => {
  const ctx = {};

  await t.test('step 1: ingest and the title-case tie in format recognition', () => {
    const seed = resolveSeed(ANCHOR);
    assert.equal(seed.normalized, ANCHOR);

    const format = classifySeedFormat(seed);
    assert.equal(format.format, 'direct_title', 'two title-case words tie; precedence decides');
    assert.equal(format.confidence, 'low');
    assert.equal(format.alternatives[0], 'person', 'the person reading is honestly reported');
    ctx.seed = seed;
  });

  await t.test('step 2: EXACT-match resolution under a books hint', async () => {
    const resolved = await resolveTextQuery(ANCHOR, { domain: 'books', search: searchStub });
    assert.equal(resolved.verified, true);
    assert.equal(resolved.entity.name, ANCHOR, 'the probe matches the anthology title verbatim');
    assert.equal(resolved.match, 'exact', 'the exact-match selection path');
    assert.equal(resolved.entity.category, 'books');
    ctx.resolved = resolved;
  });

  await t.test('step 3: the DISAMBIGUATION FSM path', () => {
    const session = new AgentSession();

    session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'br-run' } });
    session.dispatch({ type: AgentEvent.INPUT_VALID });
    session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.SEARCH } });
    assert.equal(session.state, AgentState.DOMAIN);

    session.dispatch({
      type: AgentEvent.DOMAIN_UNRESOLVED,
      payload: { candidates: [{ id: 'cand-1', name: 'Brutalist Architecture' }, { id: 'cand-2', name: 'Concrete Poetry' }] },
    });
    assert.equal(session.state, AgentState.DISAMBIGUATION, 'unclear domain parks for clarification');

    session.dispatch({ type: AgentEvent.CLARIFICATION_PROVIDED });
    assert.equal(session.state, AgentState.DOMAIN);

    session.dispatch({ type: AgentEvent.DOMAIN_RESOLVED, payload: { domains: ['books'] } });
    assert.equal(session.state, AgentState.EXECUTE);

    session.dispatch({ type: AgentEvent.EXECUTION_SUCCEEDED, payload: { result: { entityId: ctx.resolved.entity.id } } });
    session.dispatch({ type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'pinned' } } });

    session.advancePhase({ type: PhaseEvent.START });
    session.advancePhase({ type: PhaseEvent.SEED_RESOLVED, payload: { seed: { id: ctx.resolved.entity.id, domain: 'books' } } });
    session.advancePhase({ type: PhaseEvent.AFFINITIES_COLLECTED, payload: { affinities: [] } });
    session.advancePhase({ type: PhaseEvent.ANTITHESIS_READY, payload: { antithesis: {} } });
    session.advancePhase({ type: PhaseEvent.DOSSIER_READY, payload: { dossier: {} } });

    assert.equal(session.state, AgentState.DELIVERED);
    assert.equal(session.phase, AgentPhase.COMPLETED);
    ctx.session = session;
  });

  await t.test('step 4: the math chain with the DEFAULT felt-minimum valve', () => {
    const candidates = [
      { id: 'a', name: 'The Concrete Century', affinity: 0.9, popularity: 0.2 },
      { id: 'b', name: 'Homes for Sheffield', affinity: 0.85, popularity: 0.15 },
      { id: 'c', name: 'Megastructure Revival', affinity: 0.82, popularity: 0.6 },
      { id: 'd', name: 'Blockbuster Documentary', affinity: 0.7, popularity: 0.97 },
    ];

    const longTail = filterLongTail(candidates);
    assert.ok(!longTail.kept.some((e) => e.id === 'd'), 'fame-explained noise cut (task 56)');

    // DEFAULT valve ON: floor(3 * 0.15) = 0 -> one survivor is cut.
    const cliches = cutMassCliches(longTail.kept);
    assert.equal(cliches.stats.cutCount, 1, 'the felt minimum bites in a small pool');
    assert.equal(cliches.removed[0].id, 'c', 'the most banal survivor goes first');

    const scaled = normalizeArtifactScores(cliches.kept);
    const ranked = sortByNonObvious(scaled.entries);
    assert.equal(ranked.entries[0].id, 'a', 'the rarest confirmed link leads');
    ctx.ranked = ranked;
  });

  await t.test('step 5: the material-culture layer as the primary lens', async () => {
    const material = await extractMaterialProfile(
      { id: ctx.resolved.entity.id, name: ANCHOR, category: 'books' },
      { affinityFn: affinityStub, tagsFn: materialTagsStub }
    );

    assert.ok(material.architecture.some((a) => a.name === 'Brutalist'), 'catalog marker lands');
    assert.ok(material.textures.some((x) => x.name === 'Concrete'), 'the concrete texture');
    assert.ok(material.objects.some((o) => o.name === 'National Theatre'), 'the landmark carrier');
    assert.equal(material.objects[0].category, 'dining', 'restaurant tag family classifies the place');
    ctx.material = material;
  });

  await t.test('step 6: the visual layer picks the industrial-minimal film', async () => {
    const visual = await extractVisualContext(
      { id: ctx.resolved.entity.id, name: ANCHOR, category: 'books' },
      { affinityFn: affinityStub, tagsFn: async () => ({ results: [] }) }
    );

    assert.ok(visual.films.some((f) => f.name === 'Koyaanisqatsi'));
    ctx.visual = visual;
  });

  await t.test('step 7: the brutalist MINIMAL tonal signature', () => {
    const connections = annotateConnections([
      { source: { name: ANCHOR, domain: 'books' }, target: { name: 'National Theatre', category: 'dining', affinity: 0.88, popularity: 0.5, tags: [{ id: 'urn:tag:genre:place:minimal', name: 'Minimal', type: 'urn:tag:genre:place' }, { id: 'urn:tag:genre:place:brutalist', name: 'Brutalist', type: 'urn:tag:genre:place' }] }, percent: 88 },
      { source: { name: ANCHOR, domain: 'books' }, target: { name: 'Koyaanisqatsi', category: 'film', affinity: 0.83, popularity: 0.3, tags: [{ id: 'urn:tag:genre:media:minimal', name: 'Minimal', type: 'urn:tag:genre:media' }, { id: 'urn:tag:genre:media:industrial', name: 'Industrial', type: 'urn:tag:genre:media' }] }, percent: 83 },
    ]);

    const tonality = checkTonalCoherence(connections.entries);
    assert.equal(tonality.coherent, true, 'one austere tonality');
    assert.ok(tonality.centroid.axes.minimal_ornate < 0, 'the minimal axis leans negative');
    assert.ok(tonality.centroid.axes.dark_light < 0, 'brutalist/industrial read dark');
    ctx.connections = connections;
    ctx.tonality = tonality;
  });

  await t.test('step 8: graph assembly with prior-backed structural edges', () => {
    const graph = buildContextGraph({
      anchor: { id: 'anchor-1', name: ANCHOR, domain: 'books' },
      resolved: ctx.resolved,
      layers: { material: ctx.material, visual: ctx.visual },
      connections: ctx.connections.entries,
    });

    const client = generateEdgeWeights(graph);
    const tagged = client.edges.filter((e) => e.type === 'tagged');
    assert.ok(tagged.length > 0, 'the material tags produce structural edges');
    assert.ok(tagged.every((e) => e.weight > 0), 'zero carrier shares fall back to priors');
    assert.ok(client.nodes.some((n) => n.kind === 'tag' && n.label === 'Concrete'));
    ctx.graph = client;
  });

  await t.test('step 9: the backstop catches TWO fabricated names', async () => {
    const dossier = {
      anchor: { name: ANCHOR },
      entity: ctx.resolved.entity,
      material: ctx.material,
      visual: ctx.visual,
    };
    const prose =
      'The dossier anchors on "Brutalist Architecture", the ' +
      '"National Theatre" landmark and "Koyaanisqatsi", while the ' +
      '"Brutalism Biennale" and "Modernist Manifesto" are invented noise.';

    const fetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({ model: 'stub-model', choices: [{ message: { content: prose } }] }),
    });

    const synthesis = await synthesizeDossier(dossier, { fetchFn, apiKey: 'scenario-key' });
    const verdict = validateSynthesis(synthesis.text, dossier);

    assert.equal(verdict.ok, false);
    assert.deepEqual(
      verdict.hallucinated.map((h) => h.mention).sort(),
      ['Brutalism Biennale', 'Modernist Manifesto']
    );
    assert.ok(verdict.matched >= 3, 'the honest quotes traced to the payload');
  });

  await t.test('step 10: the session-cache list/delete lifecycle', async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'brutalism-session-'));
    try {
      const saved = await saveSession(
        { anchor: ANCHOR, resolved: ctx.resolved.entity.name, verdict: 'clean' },
        { baseDir }
      );

      const list = await listSessions({ baseDir });
      assert.equal(list.length, 1);
      assert.equal(list[0].live, true);

      assert.equal(await deleteSession(saved.id, { baseDir }), true);
      assert.equal(await loadSession(saved.id, { baseDir }), null, 'deleted means gone');
      assert.deepEqual(await listSessions({ baseDir }), [], 'the cache reports empty');

      // A fresh session id differs from the consumed one.
      assert.notEqual(createSessionId(), saved.id);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

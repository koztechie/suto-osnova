/**
 * Full cycle runner (tasks 74/75/76) — THE shared agent generation
 * cycle used by the budget gate and the memory-isolation tests, so
 * both verify the same code path. Mirrors the golden scenarios end to
 * end over injected stub clients (zero network).
 */

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
import { extractAllLayers } from '../src/services/dossierLayers.js';
import { resolveTextQuery } from '../src/services/seedEntityResolver.js';
import { synthesizeDossier } from '../src/services/llmSynthesizer.js';
import { saveSession, loadSession } from '../src/services/sessionCache.js';

export const CYCLE_ANCHOR = 'A24 Psychological Horror';

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});
const mediaTag = (value, name) => tag('genre:media', value, name);

const NAMES = [
  'Hereditary', 'Midsommar', 'The Lighthouse', 'The Witch', 'It Comes at Night',
  'The Killing of a Sacred Deer', 'Under the Skin', 'Suspiria', 'Raw', 'It Follows',
];

export const searchStub = async () => ({
  results: NAMES.slice(0, 6).map((name, i) => ({
    id: UUID(`a${i}000${i}`), name, subtype: 'urn:entity:movie', popularity: 0.9 - i * 0.1,
    tags: [mediaTag('horror', 'Horror')],
  })),
});

export const manyCandidates = Array.from({ length: 30 }, (_, i) => ({
  id: `c${i}`,
  name: `Candidate ${i}`,
  affinity: 0.9 - (i % 10) * 0.03,
  popularity: ((i * 37) % 100) / 100,
}));

export const affinityStub = async (ids, urn) => ({
  results: Array.from({ length: 30 }, (_, i) => ({
    id: UUID(`${(i % 15).toString(16).padStart(4, '0')}${(i % 15).toString(16).padStart(4, '0')}${(i % 15).toString(16).padStart(4, '0')}${(i % 15).toString(16).padStart(4, '0')}${(i % 15).toString(16).padStart(4, '0')}`),
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

export const tagsStub = async () => ({
  results: [
    tag('genre:music', 'post_punk', 'Post-Punk'),
    tag('genre:music', 'gothic', 'Gothic'),
    mediaTag('brutalist', 'Brutalist'),
    mediaTag('monochrome', 'Monochrome'),
  ],
});

/** One FULL agent generation cycle (mirrors the golden scenarios). */
export async function runFullCycle(baseDir) {
  const seed = resolveSeed(CYCLE_ANCHOR);
  const format = classifySeedFormat(seed);

  const resolved = await resolveTextQuery(CYCLE_ANCHOR, { search: searchStub });

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

  const longTail = filterLongTail(manyCandidates);
  const cliches = cutMassCliches(longTail.kept, { alwaysCutAtLeastOne: false });
  const unique = annotateUniqueness(cliches.kept);
  const scaled = normalizeArtifactScores(unique.entries);
  const ranked = sortByNonObvious(scaled.entries);

  const plan = expansionPlan({ id: resolved.entity.id, domain: 'film' });
  const expansion = expandTastes(plan, {});

  const anchorFor = { id: resolved.entity.id, name: 'Hereditary', category: 'film' };
  const layerClients = { affinityFn: affinityStub, searchFn: async () => ({ results: [] }), tagsFn: tagsStub };
  const batch = await extractAllLayers(anchorFor, layerClients);
  const sound = batch.layers.sound;

  const connections = annotateConnections(
    ranked.entries.slice(0, 10).map((entry) => ({
      source: { name: 'Hereditary', domain: 'film', tags: [mediaTag('horror', 'Horror')] },
      target: entry,
      percent: Math.round((entry.affinity ?? 0.5) * 100),
    }))
  );
  const tonality = checkTonalCoherence(connections.entries);

  const graph = buildContextGraph({
    anchor: { id: 'anchor-1', name: CYCLE_ANCHOR, domain: 'film' },
    resolved,
    layers: batch.layers,
    connections: connections.entries,
  });
  const client = generateEdgeWeights(graph);

  const dossier = { anchor: { name: CYCLE_ANCHOR }, entity: resolved.entity, sound };
  const fetchFn = async () => ({
    ok: true, status: 200,
    json: async () => ({
      model: 'stub', usage: { prompt_tokens: 800, completion_tokens: 120 },
      choices: [{ message: { content: '"Hereditary" with "Gothic" markers.' } }],
    }),
  });
  const synthesis = await synthesizeDossier(dossier, { fetchFn, apiKey: 'perf-key' });
  const verdict = validateSynthesis(synthesis.text, dossier);

  const saved = await saveSession(
    { anchor: CYCLE_ANCHOR, ranked: ranked.entries.length, graph: client.stats },
    { baseDir }
  );
  const loaded = await loadSession(saved.id, { baseDir });

  return { format, resolved, session, ranked, expansion, connections, tonality, client, verdict, loaded, coverage: batch.coverage };
}

/**
 * WorldbuilderMode (task 82) — MODE 1: Character & Scene Worldbuilder,
 * the production execution of the task-81 worldbuilder run plan.
 *
 * THE MODE (docs/02_PRD_SCOPE.md 3.1): a cultural anchor in, a
 * print-ready Mise-en-Scene Dossier out. This module is the single
 * orchestration point that wires the deterministic engine chain over
 * injected Qloo clients:
 *
 *   1. resolve + classify the seed (tasks 45-46), resolve the entity
 *      through the probe ladder with the UUID gate (task 47);
 *   2. drive the AgentSession FSM + six-phase ladder (tasks 41-42) so
 *      the run leaves an auditable execution snapshot (task 44);
 *   3. expand the affinity vector across ALL FIVE domains (include the
 *      seed's own — the dossier spans film, music, books, dining and
 *      fashion) via the bounded parallel vector service (task 50);
 *   4. run the MATH CHAIN over the flattened candidates: adaptive
 *      threshold (task 67, the plan's schedule) -> long-tail Via
 *      Negativa (56) -> mass-cliche quantile cut (58) -> uniqueness
 *      annotation (57) -> score normalization (60) -> non-obvious
 *      sort (61); top N survive;
 *   5. extract the five dossier layers as ONE concurrent wave (tasks
 *      51-55, 75) with per-layer failure isolation;
 *   6. annotate connections (65), check tonal coherence (66), build
 *      the context graph with numeric client weights (68-69);
 *   7. NARRATIVE SYNTHESIS (tasks 62-64) — attempted unless disabled;
 *      an absent LLM key is an HONEST typed skip (code not_configured),
 *      and any synthesis failure NEVER destroys the deterministic
 *      dossier: it lands in the bundle as a typed failure;
 *   8. optionally persist a session record (task 70) when a baseDir
 *      is injected.
 *
 * INJECTION CONTRACT: `affinityFn` is REQUIRED (a worldbuilder
 * without the taste graph is impossible) and follows BOTH calling
 * conventions — the vector service calls it (ids, agentDomain, {take})
 * and the layer extractors call it (ids, insightsUrn) — one stub can
 * serve both by keying on the second argument. Every other client is
 * optional; the whole run executes with ZERO network.
 *
 * FAILURE MODEL: synchronous misuse -> TypeError; data/upstream ->
 * the typed errors of the underlying modules PROPAGATE UNCHANGED
 * (SeedResolutionError, AffinityVectorError, ...). Per-layer and
 * per-domain failures are ISOLATED (honest coverage + failures in
 * the bundle) — only the anchor itself failing aborts the run.
 *
 * DETERMINISM: no clocks, no RNG; identical input + clients ->
 * deep-equal bundle (pinned by server/test/worldbuilderMode.test.js).
 */

import { resolveSeed } from '../engine/SeedResolver.js';
import { classifySeedFormat } from '../engine/SeedClassifier.js';
import { AgentSession } from '../engine/AgentSession.js';
import {
  AgentEvent, AgentIntent, AgentState,
} from '../engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent } from '../engine/AgentPhases.js';
import { filterByAdaptiveThreshold } from '../engine/AdaptiveThreshold.js';
import { filterLongTail } from '../engine/LongTailFilter.js';
import { cutMassCliches } from '../engine/PopClicheFilter.js';
import { annotateUniqueness } from '../engine/UniquenessCoefficient.js';
import {
  normalizeArtifactScores, connectionScoreOf,
} from '../engine/ScoreNormalizer.js';
import { sortByNonObvious } from '../engine/NonObviousSorter.js';
import {
  expansionPlan, expandTastes, flattenExpansion,
} from '../engine/CrossDomainExpander.js';
import { annotateConnections } from '../engine/ConnectionNotes.js';
import { checkTonalCoherence } from '../engine/TonalityEngine.js';
import { buildContextGraph } from '../engine/ContextGraph.js';
import { generateEdgeWeights } from '../engine/GraphWeights.js';
import { validateSynthesis } from '../engine/OutputValidator.js';
import { deepFreeze } from '../engine/deepFreeze.js';
import { extractAllLayers } from '../services/dossierLayers.js';
import { resolveTextQuery } from '../services/seedEntityResolver.js';
import {
  expandAffinityVector, fetchAffinityVector,
} from '../services/affinityVectorService.js';
import { synthesizeDossier } from '../services/llmSynthesizer.js';
import { saveSession } from '../services/sessionCache.js';
import { dispatchMode, MODE_WORLDBUILDER } from '../engine/ModeDispatcher.js';
import {
  parseSceneContext, applyContextBoost, CONTEXT_DEFAULTS,
} from './SceneContext.js';

/** Documented defaults (exported tuning contract). */
export const WORLDBUILDER_DEFAULTS = Object.freeze({
  topN: 10,
  includeSeedDomain: true,
  synthesis: true,
  alwaysCutAtLeastOne: true,
});

/** Machine-readable skip/failure codes surfaced by the bundle. */
export const WORLDBUILDER_CODES = Object.freeze({
  SYNTHESIS_SKIPPED: 'synthesis_disabled',
  LAYER_FAILED: 'layer_failed',
  DOMAIN_FAILED: 'domain_failed',
});

const validateOptions = (options) => {
  if (typeof options.affinityFn !== 'function') {
    throw new TypeError(
      'runWorldbuilder: options.affinityFn is required — the taste graph ' +
        'is the substance of this mode (ids, domain|urn, {take}) => page'
    );
  }
  for (const key of ['search', 'searchFn', 'tagsFn', 'insightsFn', 'fetchFn']) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new TypeError(`runWorldbuilder: options.${key} must be a function when given`);
    }
  }
  if (options.topN !== undefined
    && (!Number.isInteger(options.topN) || options.topN < 1 || options.topN > 50)) {
    throw new TypeError('runWorldbuilder: options.topN must be an integer in 1..50');
  }
  if (options.thresholds !== undefined
    && (typeof options.thresholds !== 'object' || options.thresholds === null
      || Array.isArray(options.thresholds))) {
    throw new TypeError('runWorldbuilder: options.thresholds must be an object of schedule overrides');
  }
  // Task 84: scene context (era + geography) is validated SYNCHRONOUSLY
  // BEFORE any client work — typed SceneContextError for bad values,
  // TypeError for bad types (parseSceneContext contract).
  parseSceneContext(options.scene ?? null);
  if (options.contextBoost !== undefined
    && (typeof options.contextBoost !== 'number' || !Number.isFinite(options.contextBoost)
      || options.contextBoost < 0 || options.contextBoost > 0.5)) {
    throw new TypeError('runWorldbuilder: contextBoost must be a finite number in 0..0.5');
  }
};

const driveSession = (session, { requestId, entity, ranked, dossierReady }) => {
  session.dispatch({
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId },
  });
  session.dispatch({ type: AgentEvent.INPUT_VALID });
  session.dispatch({
    type: AgentEvent.INTENT_CLASSIFIED,
    payload: { intent: AgentIntent.RESOLVE_ENTITY },
  });
  session.dispatch({
    type: AgentEvent.DOMAIN_RESOLVED,
    payload: { domains: [entity.category] },
  });
  session.dispatch({
    type: AgentEvent.EXECUTION_SUCCEEDED,
    payload: { result: { entityId: entity.id, category: entity.category } },
  });

  session.advancePhase({ type: PhaseEvent.START });
  session.advancePhase({
    type: PhaseEvent.SEED_RESOLVED,
    payload: { seed: { id: entity.id, domain: entity.category } },
  });
  session.advancePhase({
    type: PhaseEvent.AFFINITIES_COLLECTED,
    payload: { affinities: ranked },
  });
  // The worldbuilder plan (task 81) does not REQUIRE the antithesis
  // leg — the linear ladder still passes through its phase; the skip
  // is explicit and auditable, never silent.
  session.advancePhase({
    type: PhaseEvent.ANTITHESIS_READY,
    payload: { antithesis: { skipped: true, reason: 'not_required_by_mode' } },
  });
  session.advancePhase({
    type: PhaseEvent.DOSSIER_READY,
    payload: { dossier: dossierReady },
  });
};

/**
 * Run Mode 1 over an injected client set.
 *
 * @param {string|object} input cultural anchor (resolveSeed ingress).
 * @param {object} options see the injection contract above.
 * @returns {Promise<object>} the frozen dossier bundle.
 */
export async function runWorldbuilder(input, options = {}) {
  validateOptions(options);

  const plan = dispatchMode(MODE_WORLDBUILDER); // the task-81 run plan
  const topN = options.topN ?? WORLDBUILDER_DEFAULTS.topN;

  // 1. Seed + entity resolution (typed errors propagate unchanged).
  const seed = resolveSeed(input);
  const classification = classifySeedFormat(seed);
  const resolved = await resolveTextQuery(seed.normalized, {
    search: options.search,
    domain: options.domain,
  });
  const entity = resolved.entity;

  // 2. The execution record starts with the request lifecycle.
  const session = new AgentSession();
  const requestId = options.requestId ?? `wb-${entity.id}`;
  const failures = [];

  // 3. Bounded parallel affinity expansion across all five domains
  //    (task 50 service; per-domain failures isolated, honest).
  const vector = await expandAffinityVector(
    { id: entity.id, domain: entity.category },
    {
      includeSeedDomain:
        options.includeSeedDomain ?? WORLDBUILDER_DEFAULTS.includeSeedDomain,
      fetchFn: options.affinityFn,
      take: options.take,
      maxPerDomain: options.maxPerDomain,
    }
  );
  for (const failure of vector.failures) {
    failures.push({
      code: WORLDBUILDER_CODES.DOMAIN_FAILED,
      domain: failure.domain ?? null,
      message: failure.error ?? null,
    });
  }

  // 4. The math chain (tasks 56-61 + 67 gate first). With a scene
  //    context (task 84), candidates get the deterministic era/geo
  //    bias BEFORE the gate — period- and place-fitting picks gain a
  //    small documented affinity boost; rows are never dropped.
  const scene = parseSceneContext(options.scene ?? null);
  const rawCandidates = flattenExpansion(vector.expansion);
  const candidates = scene === null
    ? rawCandidates
    : applyContextBoost(rawCandidates, scene, {
      boost: options.contextBoost ?? CONTEXT_DEFAULTS.boost,
    });
  const thresholdOptions = { ...(plan.thresholds ?? {}), ...(options.thresholds ?? {}) };
  const gated = filterByAdaptiveThreshold(candidates, thresholdOptions);
  const longTail = filterLongTail(gated.kept);
  const cliches = cutMassCliches(longTail.kept, {
    alwaysCutAtLeastOne:
      options.alwaysCutAtLeastOne ?? WORLDBUILDER_DEFAULTS.alwaysCutAtLeastOne,
  });
  const unique = annotateUniqueness(cliches.kept);
  const scaled = normalizeArtifactScores(unique.entries, {
    ...(options.scoreMode ? { mode: options.scoreMode } : {}),
  });
  const ranked = sortByNonObvious(scaled.entries).entries.slice(0, topN);

  // 5. The five dossier layers, one concurrent wave (tasks 51-55, 75).
  //    Whole-layer failures AND per-leg failures (each extractor
  //    isolates its legs internally and reports {leg, code, message})
  //    are aggregated into the bundle's failure ledger.
  const batch = await extractAllLayers(entity, {
    affinityFn: options.affinityFn,
    searchFn: options.searchFn,
    tagsFn: options.tagsFn,
    insightsFn: options.insightsFn,
  });
  for (const failure of batch.failures) {
    failures.push({
      code: WORLDBUILDER_CODES.LAYER_FAILED,
      layer: failure.layer,
      leg: 'layer',
      message: failure.message ?? null,
    });
  }
  for (const [layer, record] of Object.entries(batch.layers)) {
    for (const failure of record?.failures ?? []) {
      failures.push({
        code: WORLDBUILDER_CODES.LAYER_FAILED,
        layer,
        leg: failure.leg ?? null,
        message: failure.message ?? null,
      });
    }
  }

  // 6. Explanation + coherence + the client-ready graph (65-69).
  const connections = annotateConnections(
    ranked.map((entry) => ({
      source: {
        name: entity.name,
        domain: entity.category,
        tags: Array.isArray(entity.tags) ? entity.tags : [],
      },
      target: entry,
      percent: Math.round(connectionScoreOf(entry) * 100),
    }))
  );
  const tonality = checkTonalCoherence(connections.entries);
  const graph = buildContextGraph({
    anchor: { id: entity.id, name: entity.name, domain: entity.category },
    resolved,
    layers: batch.layers,
    connections: connections.entries,
  });
  const weights = generateEdgeWeights(graph);

  // 7. Narrative synthesis (62-64): honest typed skip or isolated
  //    typed failure — the deterministic dossier always survives.
  let synthesis = null;
  let validation = null;
  let synthesisFailure = null;
  const synthesisRequested =
    options.synthesis ?? WORLDBUILDER_DEFAULTS.synthesis;
  const dossierPayload = {
    anchor: { name: entity.name, category: entity.category },
    entity,
    top: ranked,
    layers: batch.layers,
    connections: connections.entries.slice(0, topN),
  };
  if (!synthesisRequested) {
    synthesisFailure = {
      code: WORLDBUILDER_CODES.SYNTHESIS_SKIPPED,
      message: 'narrative synthesis disabled by options.synthesis = false',
    };
  } else {
    try {
      synthesis = await synthesizeDossier(dossierPayload, {
        fetchFn: options.fetchFn,
        apiKey: options.apiKey,
        model: options.model,
        baseUrl: options.baseUrl,
      });
      validation = validateSynthesis(synthesis.text, dossierPayload);
    } catch (error) {
      synthesisFailure = {
        code: error?.code ?? 'upstream_error',
        message: error?.message ?? String(error),
      };
    }
  }
  if (synthesisFailure !== null) failures.push({ ...synthesisFailure, stage: 'synthesis' });

  // 8. Terminal lifecycle events + optional persistence (task 70).
  driveSession(session, {
    requestId,
    entity,
    ranked,
    dossierReady: { mode: plan.mode, top: ranked.length },
  });
  session.dispatch({
    type: AgentEvent.SYNTHESIS_READY,
    payload: {
      response: {
        text: synthesis?.text ?? null,
        skipped: synthesis === null,
      },
    },
  });
  if (session.state !== AgentState.DELIVERED || session.phase !== AgentPhase.COMPLETED) {
    throw new Error(
      `runWorldbuilder: session lifecycle invariant broken ` +
        `(state=${session.state}, phase=${session.phase})`
    );
  }

  let sessionId = null;
  if (options.baseDir !== undefined) {
    const saved = await saveSession(
      {
        requestId,
        anchor: seed.normalized,
        mode: plan.mode,
        scene,
        entity: { id: entity.id, name: entity.name, category: entity.category },
        top: ranked.map((entry) => ({ id: entry.id, name: entry.name })),
        coverage: batch.coverage,
        failures,
      },
      { baseDir: options.baseDir }
    );
    sessionId = saved.id;
  }

  return deepFreeze({
    mode: plan.mode,
    output: plan.output,
    requestId,
    scene,
    seed: {
      normalized: seed.normalized,
      format: classification.format,
      confidence: classification.confidence ?? null,
    },
    entity,
    resolution: {
      match: resolved.match,
      ambiguous: resolved.ambiguous,
      relevance: resolved.relevance,
    },
    expansion: {
      ok: vector.ok,
      failed: vector.failed,
      domains: vector.plan.domains,
      candidates: candidates.length,
    },
    chain: {
      threshold: gated.stats,
      longTail: Object.freeze({
        input: gated.stats.kept,
        kept: longTail.kept.length,
        cuts: longTail.removed.length,
      }),
      cliches: Object.freeze({
        input: longTail.kept.length,
        kept: cliches.kept.length,
        cuts: cliches.removed.length,
      }),
      ranked: ranked.length,
    },
    ranked,
    layers: batch.layers,
    coverage: batch.coverage,
    connections,
    tonality,
    graph,
    weights,
    synthesis: deepFreeze({
      attempted: synthesis !== null,
      text: synthesis?.text ?? null,
      model: synthesis?.model ?? null,
      usage: synthesis?.usage ?? null,
      failure: synthesisFailure,
    }),
    validation,
    session: deepFreeze({
      id: sessionId,
      state: session.state,
      phase: session.phase,
      execution: session.getExecutionSnapshot(),
    }),
    failures: deepFreeze(failures),
    stats: deepFreeze({
      candidates: candidates.length,
      thresholdKept: gated.stats.kept,
      thresholdRejected: gated.stats.rejected,
      ranked: ranked.length,
      layerFailures: batch.failures.length,
      domainFailures: vector.failed,
      synthesis: synthesis !== null ? 'ok' : (synthesisFailure?.code ?? null),
    }),
  });
}

// fetchAffinityVector is re-exported for callers that want a single
// domain slice of the same vector without running the full mode.
export { fetchAffinityVector };

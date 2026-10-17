/**
 * ExperientialMode (task 87) — MODE 2: Live Event & Festival
 * Activation (the PRD 3.2 case, built for the Live Nation / Billboard
 * brief): a headlining artist or festival concept in, a statistically
 * aligned CURATION LIST out — opening acts, brand sponsors and local
 * food/beverage vendors.
 *
 * WHAT MAKES IT ACTIVATION (the task-81 plan, enforced here):
 *   - AUDIENCE INSIGHTS ARE A FIRST-CLASS LEG — the headliner is
 *     blended into a Qloo audience-insights query (entityIds, and the
 *     scene LOCATION as the venue locality — the client's own
 *     documented `location` param, the task-84 integration). The leg
 *     degrades HONESTLY: a typed failure lands in the ledger and
 *     `audience.available=false`, and the curation continues on
 *     graph-evidence alone (documented degraded mode — every pick
 *     stays evidence-backed);
 *   - expansion targets the THREE activation domains only (music ->
 *     opening acts, fashion -> brand sponsors, dining -> vendors);
 *   - the three activation layers run (sound/material/gastronomy)
 *     with allSettled isolation — no literary/visual quota spend;
 *   - the same math chain (56-61 + the 67 gate) ranks candidates;
 *   - DUAL-EVIDENCE MARKING: a pick confirmed by BOTH the taste
 *     graph and the audience-insights leg is labeled `dual`, else
 *     `confirmed_affinity` — Billboard-grade attribution, honest.
 *
 * INJECTION: affinityFn REQUIRED (the taste graph is the substance);
 * insightsFn optional (defaults to the real audience-insights
 * client); everything else optional — the whole run executes with
 * ZERO network. Scene context (task 84) is accepted and biases the
 * chain deterministically; venue locality flows into the insights
 * query.
 *
 * FAILURE MODEL: TypeError for programmer misuse; typed service
 * errors propagate for the ANCHOR (SeedResolutionError); per-domain,
 * per-layer and insights failures are isolated into the ledger.
 *
 * DETERMINISM: no clocks, no RNG — identical input + clients ->
 * deep-equal bundle (pinned by server/test/experientialMode.test.js).
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
import { deepFreeze } from '../engine/deepFreeze.js';
import { dispatchMode, MODE_ACTIVATION } from '../engine/ModeDispatcher.js';
import { resolveTextQuery } from '../services/seedEntityResolver.js';
import {
  fetchAffinityVector,
} from '../services/affinityVectorService.js';
import { extractSoundProfile } from '../services/soundExtractor.js';
import { extractMaterialProfile } from '../services/materialCultureExtractor.js';
import { extractGastronomyContext } from '../services/gastronomyExtractor.js';
import { runParallelTasks } from '../services/parallelTasks.js';
import { getAudienceInsights } from '../services/audienceInsightsClient.js';
import { primaryInsightType } from '../services/domainMapper.js';
import { synthesizeDossier } from '../services/llmSynthesizer.js';
import { saveSession } from '../services/sessionCache.js';
import {
  parseSceneContext, applyContextBoost, CONTEXT_DEFAULTS,
} from './SceneContext.js';
import { buildAfterpartyEcosystem } from './AfterpartyEcosystem.js';
import { buildFoodCuration } from './FoodCuration.js';

/** Documented defaults (exported tuning contract). */
export const ACTIVATION_DEFAULTS = Object.freeze({
  topN: 8,
  includeSeedDomain: true,
  synthesis: true,
  alwaysCutAtLeastOne: true,
  insightsTake: 10,
});

/** Machine-readable skip/failure codes surfaced by the bundle. */
export const ACTIVATION_CODES = Object.freeze({
  SYNTHESIS_SKIPPED: 'synthesis_disabled',
  LAYER_FAILED: 'layer_failed',
  DOMAIN_FAILED: 'domain_failed',
  INSIGHTS_FAILED: 'audience_insights_failed',
});

/** Evidence labels (the Billboard-grade attribution contract). */
export const EVIDENCE_KINDS = Object.freeze({
  DUAL: 'dual',
  CONFIRMED_AFFINITY: 'confirmed_affinity',
  AUDIENCE_INSIGHT: 'audience_insight',
});

const validateOptions = (options) => {
  if (typeof options.affinityFn !== 'function') {
    throw new TypeError(
      'runExperiential: options.affinityFn is required — the taste graph ' +
        'is the substance of this mode (ids, domain|urn, {take}) => page'
    );
  }
  for (const key of ['search', 'searchFn', 'tagsFn', 'insightsFn', 'fetchFn']) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new TypeError(`runExperiential: options.${key} must be a function when given`);
    }
  }
  if (options.topN !== undefined
    && (!Number.isInteger(options.topN) || options.topN < 1 || options.topN > 50)) {
    throw new TypeError('runExperiential: options.topN must be an integer in 1..50');
  }
  if (options.thresholds !== undefined
    && (typeof options.thresholds !== 'object' || options.thresholds === null
      || Array.isArray(options.thresholds))) {
    throw new TypeError('runExperiential: options.thresholds must be an object of schedule overrides');
  }
  if (options.cutRate !== undefined
    && (typeof options.cutRate !== 'number' || !Number.isFinite(options.cutRate)
      || options.cutRate < 0 || options.cutRate > 1)) {
    throw new TypeError('runExperiential: cutRate must be a finite number in 0..1');
  }
  if (options.afterpartyLimit !== undefined
    && (!Number.isInteger(options.afterpartyLimit)
      || options.afterpartyLimit < 1 || options.afterpartyLimit > 50)) {
    throw new TypeError('runExperiential: afterpartyLimit must be an integer in 1..50');
  }
  if (options.foodZoneLimit !== undefined
    && (!Number.isInteger(options.foodZoneLimit)
      || options.foodZoneLimit < 1 || options.foodZoneLimit > 50)) {
    throw new TypeError('runExperiential: foodZoneLimit must be an integer in 1..50');
  }
  parseSceneContext(options.scene ?? null);
  if (options.contextBoost !== undefined
    && (typeof options.contextBoost !== 'number' || !Number.isFinite(options.contextBoost)
      || options.contextBoost < 0 || options.contextBoost > 0.5)) {
    throw new TypeError('runExperiential: contextBoost must be a finite number in 0..0.5');
  }
};

/** One curation item: evidence-backed, deterministically framed. */
const curationItem = (entry, evidence) => {
  const score = connectionScoreOf(entry);
  return Object.freeze({
    name: entry.name,
    domain: entry?.domain ?? null,
    affinityPercent: typeof score === 'number' ? Math.round(score * 100) : null,
    evidence,
    pitch: `statistically aligns with the headliner's audience${score !== null ? ` (${Math.round(score * 100)}% affinity)` : ''}`,
  });
};

const driveSession = (session, { requestId, entity, ranked, curationCounts }) => {
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
  session.advancePhase({
    type: PhaseEvent.ANTITHESIS_READY,
    payload: { antithesis: { skipped: true, reason: 'not_required_by_mode' } },
  });
  session.advancePhase({
    type: PhaseEvent.DOSSIER_READY,
    payload: { dossier: { mode: MODE_ACTIVATION, curation: curationCounts } },
  });
};

/**
 * Run Mode 2 over an injected client set.
 *
 * @param {string|object} input headliner / festival concept (resolveSeed ingress).
 * @param {object} options see the injection contract in the header.
 * @returns {Promise<object>} the frozen activation bundle.
 */
export async function runExperiential(input, options = {}) {
  validateOptions(options);

  const plan = dispatchMode(MODE_ACTIVATION); // the task-81 run plan
  const topN = options.topN ?? ACTIVATION_DEFAULTS.topN;

  // 1. Seed + entity (typed errors propagate unchanged).
  const seed = resolveSeed(input);
  const classification = classifySeedFormat(seed);
  const resolved = await resolveTextQuery(seed.normalized, {
    search: options.search,
    domain: options.domain,
  });
  const entity = resolved.entity;
  const scene = parseSceneContext(options.scene ?? null);
  const requestId = options.requestId ?? `ac-${entity.id}`;
  const session = new AgentSession();
  const failures = [];

  // 2. AUDIENCE INSIGHTS (the plan's required leg — honest
  //    degradation: typed failure -> ledger + available=false).
  const insightsFn = options.insightsFn ?? getAudienceInsights;
  let audience;
  try {
    const insights = await insightsFn({
      // The insights query REQUIRES a target type (live-verified
      // contract: the client rejects without it) — the headliner's
      // own domain supplies it, overridable per brief.
      targetDomain: options.targetDomain ?? primaryInsightType(entity.category),
      entityIds: [entity.id],
      take: options.insightsTake ?? ACTIVATION_DEFAULTS.insightsTake,
      ...(scene?.location ? { location: scene.location } : {}),
      ...(options.insights ? options.insights : {}),
    });
    const rows = Array.isArray(insights?.results) ? insights.results : [];
    audience = Object.freeze({
      available: true,
      count: typeof insights?.count === 'number' ? insights.count : rows.length,
      location: scene?.location ?? null,
      top: Object.freeze(rows.slice(0, topN).map((row) => Object.freeze({
        name: row?.name ?? null,
        affinityPercent: typeof row?.affinity === 'number'
          ? Math.round(row.affinity * 100) : null,
      }))),
      error: null,
    });
  } catch (error) {
    audience = Object.freeze({
      available: false, count: 0, location: scene?.location ?? null,
      top: Object.freeze([]),
      error: String(error?.code ?? error?.message ?? error).slice(0, 200),
    });
    failures.push({
      code: ACTIVATION_CODES.INSIGHTS_FAILED,
      message: audience.error,
    });
  }

  // 3. Expansion across the THREE activation domains only.
  const expPlan = expansionPlan(
    { id: entity.id, domain: entity.category },
    { domains: plan.domains, includeSeedDomain: true }
  );
  const vector = await fetchAffinityVector([entity.id], {
    domains: expPlan.domains,
    fetchFn: options.affinityFn,
    take: options.take,
  });
  for (const failure of vector.failures) {
    failures.push({
      code: ACTIVATION_CODES.DOMAIN_FAILED,
      domain: failure.domain ?? null,
      message: failure.error ?? null,
    });
  }
  const payloads = {};
  for (const record of vector.domains) {
    if (record.status === 'ok' && record.page !== null) payloads[record.domain] = record.page;
  }
  const expansion = expandTastes(expPlan, payloads, {
    ...(options.maxPerDomain !== undefined ? { maxPerDomain: options.maxPerDomain } : {}),
  });

  // 4. The math chain (same discipline as Mode 1).
  const rawCandidates = flattenExpansion(expansion);
  const candidates = scene === null
    ? rawCandidates
    : applyContextBoost(rawCandidates, scene, {
      boost: options.contextBoost ?? CONTEXT_DEFAULTS.boost,
    });
  const gated = filterByAdaptiveThreshold(candidates, {
    ...(plan.thresholds ?? {}), ...(options.thresholds ?? {}),
  });
  const longTail = filterLongTail(gated.kept);
  const cliches = cutMassCliches(longTail.kept, {
    alwaysCutAtLeastOne:
      options.alwaysCutAtLeastOne ?? ACTIVATION_DEFAULTS.alwaysCutAtLeastOne,
    // Activation briefs may demand the FULL ranked list (the engine
    // default 0.15 quantile cut is exposed as a tuning contract —
    // cutRate 0 keeps every gate-survivor for the curation).
    ...(options.cutRate !== undefined ? { cutRate: options.cutRate } : {}),
  });
  const unique = annotateUniqueness(cliches.kept);
  const scaled = normalizeArtifactScores(unique.entries, {
    ...(options.scoreMode ? { mode: options.scoreMode } : {}),
  });
  const ranked = sortByNonObvious(scaled.entries).entries.slice(0, topN * 3);

  // 5. The three activation layers (allSettled isolation).
  const layerClients = {
    affinityFn: options.affinityFn,
    searchFn: options.searchFn,
    tagsFn: options.tagsFn,
  };
  const layerResults = await runParallelTasks([
    { name: 'sound', run: () => extractSoundProfile(entity, layerClients) },
    { name: 'material', run: () => extractMaterialProfile(entity, layerClients) },
    { name: 'gastronomy', run: () => extractGastronomyContext(entity, layerClients) },
  ]);
  const layers = {};
  const coverage = {};
  for (const result of layerResults) {
    if (result.status === 'fulfilled') {
      layers[result.name] = result.value;
      coverage[result.name] = true;
    } else {
      layers[result.name] = null;
      coverage[result.name] = false;
      failures.push({
        code: ACTIVATION_CODES.LAYER_FAILED,
        layer: result.name,
        message: String(result.reason?.message ?? result.reason).slice(0, 300),
      });
    }
  }
  for (const [layer, record] of Object.entries(layers)) {
    for (const failure of record?.failures ?? []) {
      failures.push({
        code: ACTIVATION_CODES.LAYER_FAILED,
        layer,
        leg: failure.leg ?? null,
        message: failure.message ?? null,
      });
    }
  }

  // 6. THE CURATION: opening acts / sponsors / vendors with the
  //    dual-evidence marking against the audience leg.
  const insightNames = new Set(
    audience.top.map((row) => row?.name?.toLowerCase()).filter(Boolean)
  );
  const evidenceFor = (entry) => (
    insightNames.has(String(entry.name).toLowerCase())
      ? EVIDENCE_KINDS.DUAL
      : EVIDENCE_KINDS.CONFIRMED_AFFINITY
  );
  const byDomain = (domain) => ranked.filter((entry) => entry?.domain === domain);

  const openingActs = byDomain('music').slice(0, topN)
    .map((entry) => curationItem(entry, evidenceFor(entry)));
  const sponsors = byDomain('fashion').slice(0, topN)
    .map((entry) => curationItem(entry, evidenceFor(entry)));
  const vendorRows = [
    ...byDomain('dining'),
    ...(Array.isArray(layers.gastronomy?.venues) ? layers.gastronomy.venues : []),
  ];
  const seenVendors = new Set();
  const vendors = [];
  for (const entry of vendorRows) {
    if (vendors.length >= topN) break;
    if (!entry || typeof entry.name !== 'string') continue;
    if (seenVendors.has(entry.name)) continue;
    seenVendors.add(entry.name);
    vendors.push(curationItem({ ...entry, domain: entry.domain ?? 'dining' }, evidenceFor(entry)));
  }

  // 7. THE AFTERPARTY ECOSYSTEM (task 89): authentic bars and
  //    nightlife venues from the dossier's own evidence (honest null
  //    when disabled).
  const afterparty = options.afterparty === false
    ? null
    : buildAfterpartyEcosystem(
      { entity, ranked, layers, scene },
      options.afterpartyLimit !== undefined ? { limit: options.afterpartyLimit } : {}
    );

  // 7b. THE F&B ZONE MAP (task 92): the festival ground's
  //     gastronomic zones from the same evidence (honest null when
  //     disabled).
  const foodZones = options.foodZones === false
    ? null
    : buildFoodCuration(
      { entity, ranked, layers, audience, scene },
      options.foodZoneLimit !== undefined ? { limit: options.foodZoneLimit } : {}
    );

  // 8. Narrative synthesis (optional, honest skip / isolated failure).
  let synthesis = null;
  let validation = null;
  let synthesisFailure = null;
  const synthesisRequested = options.synthesis ?? ACTIVATION_DEFAULTS.synthesis;
  const dossierPayload = {
    anchor: { name: entity.name, category: entity.category },
    entity,
    audience,
    curation: { openingActs, sponsors, vendors },
  };
  if (!synthesisRequested) {
    synthesisFailure = {
      code: ACTIVATION_CODES.SYNTHESIS_SKIPPED,
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
      validation = null; // a curation list is validated by evidence, not prose
    } catch (error) {
      synthesisFailure = {
        code: error?.code ?? 'upstream_error',
        message: error?.message ?? String(error),
      };
    }
  }
  if (synthesisFailure !== null) failures.push({ ...synthesisFailure, stage: 'synthesis' });

  // 9. Terminal lifecycle + optional persistence.
  const curationCounts = Object.freeze({
    openingActs: openingActs.length,
    sponsors: sponsors.length,
    vendors: vendors.length,
  });
  driveSession(session, { requestId, entity, ranked, curationCounts });
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
      `runExperiential: session lifecycle invariant broken ` +
        `(state=${session.state}, phase=${session.phase})`
    );
  }

  let sessionId = null;
  if (options.baseDir !== undefined) {
    const saved = await saveSession(
      {
        requestId,
        anchor: seed.normalized,
        mode: MODE_ACTIVATION,
        scene,
        entity: { id: entity.id, name: entity.name, category: entity.category },
        curation: curationCounts,
        coverage,
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
    audience,
    expansion: {
      ok: vector.ok,
      failed: vector.failed,
      domains: vector.domains.map((record) => record.domain),
      candidates: candidates.length,
    },
    chain: deepFreeze({
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
    }),
    ranked,
    layers: deepFreeze(layers),
    coverage: deepFreeze(coverage),
    curation: Object.freeze({ openingActs, sponsors, vendors }),
    afterparty,
    foodZones,
    synthesis: deepFreeze({
      attempted: synthesis !== null,
      text: synthesis?.text ?? null,
      model: synthesis?.model ?? null,
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
      ranked: ranked.length,
      audienceAvailable: audience.available,
      openingActs: openingActs.length,
      sponsors: sponsors.length,
      vendors: vendors.length,
      dualEvidence: [...openingActs, ...sponsors, ...vendors]
        .filter((item) => item.evidence === EVIDENCE_KINDS.DUAL).length,
      synthesis: synthesis !== null ? 'ok' : (synthesisFailure?.code ?? null),
    }),
  });
}

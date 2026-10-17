/**
 * AntithesisMode (task 94) — MODE 3: The Taste Antithesis Engine, the
 * production execution of the task-81 antithesis run plan (PRD 3.3).
 *
 * THE MODE: a target entity in, a CULTURAL BLINDSPOT REPORT out —
 * the entities with the LOWEST measured correlation to the anchor in
 * the Qloo graph, for engineering dramatic conflict, designing
 * antagonistic characters and identifying sponsorship risks.
 *
 * THE INVERTED CHAIN (what separates Mode 3 from Modes 1-2): the
 * dispatcher plan carries `selection: lowest_correlation` and
 * `thresholds: null` — nothing here is ACCEPTED on affinity, so the
 * acceptance machinery is honestly NOT run:
 *   - the adaptive threshold schedule (task 67) GATES acceptance on
 *     affinity -> skipped (the plan says so explicitly);
 *   - the long-tail Via Negativa (56) and the mass-cliche quantile
 *     cut (58) both CUT weak-affinity rows -> skipped: the chain's
 *     rejects are this mode's EVIDENCE;
 *   - no score rescaling (60) or non-obvious sort (61): the raw
 *     connection score is the quantity being inverted, kept intact.
 * What DOES run: uniqueness annotation (57) — its `mainstream`
 * tier is the sponsorship-risk marker.
 *
 * SELECTION MATH (buildAntithesisBlock, exported and pure):
 *   1. MEASURABLE-ONLY discipline (task 48): a candidate without a
 *      finite connection score is UNMEASURED — the absence of
 *      evidence is never treated as divergence; such rows are
 *      excluded and honestly counted (`unmeasurable`);
 *   2. divergence = 1 - affinity; entries sort affinity ASCENDING
 *      (divergence DESC), then popularity DESCENDING (a mainstream
 *      blindspot pick is the strongest conflict/risk material),
 *      then name;
 *   3. per-domain matrix: the top `perDomain` weakest correlations
 *      for EVERY planned domain (an empty domain stays visible with
 *      count 0 — honest coverage);
 *   4. TIERS: `zero_affinity` when the graph explicitly returns 0
 *      (a proven non-correlation) vs `lowest_correlation` (the
 *      weakest MEASURED correlation); `sponsorshipRisk` marks
 *      mainstream-tier picks — mass-market names the anchor's
 *      taste does NOT justify (association reads inauthentic).
 *      The flag reuses the task-57 tier VERBATIM: its normalized
 *      coefficient (minProbability 1e-6, maxBits ~19.93) puts the
 *      mainstream band at popularity >= ~0.126 — deliberately
 *      generous: every blindspot pick with meaningful mass
 *      recognition lands in the review queue.
 *
 * LENSES (the PRD's three use cases): `perDomain` — the blindspot
 * matrix for antagonist design; `conflictDrivers` — the strongest
 * cross-domain divergences for dramatic conflict;
 * `sponsorshipRisks` — mainstream blindspot picks for risk review.
 *
 * NO LAYER SPEND: the report is built from the inverted vector
 * alone — no extraction legs run (the PRD process is vector
 * isolation; the <4.5s budget thanks us).
 *
 * INJECTION: affinityFn REQUIRED (both calling conventions); every
 * other client optional; the whole run executes with ZERO network.
 * FAILURE MODEL: TypeError for misuse; typed anchor errors
 * propagate unchanged; per-domain failures isolate into the ledger.
 * DETERMINISM: no clocks, no RNG — pinned by
 * server/test/antithesisMode.test.js.
 */

import { resolveSeed } from '../engine/SeedResolver.js';
import { classifySeedFormat } from '../engine/SeedClassifier.js';
import { AgentSession } from '../engine/AgentSession.js';
import {
  AgentEvent, AgentIntent, AgentState,
} from '../engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent } from '../engine/AgentPhases.js';
import { annotateUniqueness } from '../engine/UniquenessCoefficient.js';
import { connectionScoreOf } from '../engine/ScoreNormalizer.js';
import { deepFreeze } from '../engine/deepFreeze.js';
import { flattenExpansion } from '../engine/CrossDomainExpander.js';
import { validateSynthesis } from '../engine/OutputValidator.js';
import {
  dispatchMode, MODE_ANTITHESIS, SELECTION_STRATEGIES,
} from '../engine/ModeDispatcher.js';
import { expandAffinityVector } from '../services/affinityVectorService.js';
import { resolveTextQuery } from '../services/seedEntityResolver.js';
import { synthesizeDossier } from '../services/llmSynthesizer.js';
import { saveSession } from '../services/sessionCache.js';

/** Documented defaults (exported tuning contract). */
export const ANTITHESIS_DEFAULTS = Object.freeze({
  perDomain: 3,
  conflictLimit: 5,
  includeSeedDomain: true,
  synthesis: true,
});

/** Machine-readable skip/failure codes surfaced by the bundle. */
export const ANTITHESIS_CODES = Object.freeze({
  SYNTHESIS_SKIPPED: 'synthesis_disabled',
  DOMAIN_FAILED: 'domain_failed',
});

/** Divergence tiers (exported vocabulary). */
export const ANTITHESIS_TIERS = Object.freeze({
  ZERO_AFFINITY: 'zero_affinity',
  LOWEST_CORRELATION: 'lowest_correlation',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const validateOptions = (options) => {
  if (typeof options.affinityFn !== 'function') {
    throw new TypeError(
      'runAntithesis: options.affinityFn is required — the taste graph ' +
        'is the substance of this mode (ids, domain|urn, {take}) => page'
    );
  }
  for (const key of ['search', 'searchFn', 'tagsFn', 'insightsFn', 'fetchFn']) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new TypeError(`runAntithesis: options.${key} must be a function when given`);
    }
  }
  if (options.perDomain !== undefined
    && (!Number.isInteger(options.perDomain) || options.perDomain < 1 || options.perDomain > 20)) {
    throw new TypeError('runAntithesis: perDomain must be an integer in 1..20');
  }
  if (options.conflictLimit !== undefined
    && (!Number.isInteger(options.conflictLimit)
      || options.conflictLimit < 1 || options.conflictLimit > 50)) {
    throw new TypeError('runAntithesis: conflictLimit must be an integer in 1..50');
  }
};

/**
 * Build the cultural blindspot block from the flattened candidate
 * pool. Pure and exported: the inverted selection math is unit
 * testable without the full mode run.
 *
 * @param {object} pieces { anchor, candidates, domains, perDomain,
 *        conflictLimit }.
 * @returns {Readonly<object>} the frozen block.
 */
export function buildAntithesisBlock(pieces) {
  if (!pieces || typeof pieces !== 'object' || !pieces.anchor
    || typeof pieces.anchor.name !== 'string') {
    throw new TypeError('buildAntithesisBlock: pieces must carry a named anchor');
  }
  const domains = Array.isArray(pieces.domains) ? pieces.domains : [];
  const perDomain = pieces.perDomain ?? ANTITHESIS_DEFAULTS.perDomain;
  if (!Number.isInteger(perDomain) || perDomain < 1 || perDomain > 20) {
    throw new TypeError('buildAntithesisBlock: perDomain must be an integer in 1..20');
  }
  const conflictLimit = pieces.conflictLimit ?? ANTITHESIS_DEFAULTS.conflictLimit;
  if (!Number.isInteger(conflictLimit) || conflictLimit < 1 || conflictLimit > 50) {
    throw new TypeError('buildAntithesisBlock: conflictLimit must be an integer in 1..50');
  }

  const candidates = Array.isArray(pieces.candidates) ? pieces.candidates : [];

  // 1. MEASURABLE-ONLY: unmeasured rows are not divergence (they
  //    are counted honestly, never placed).
  const measurable = candidates.filter(
    (entry) => connectionScoreOf(entry) !== null
  );
  const unmeasurable = candidates.length - measurable.length;

  // 2. Inverted records over the task-57 uniqueness annotation (its
  //    `mainstream` tier is the sponsorship-risk marker).
  const annotated = annotateUniqueness(measurable);
  const records = annotated.entries.map((entry) => {
    const affinity = round12(connectionScoreOf(entry));
    const uniquenessTier = entry.uniqueness?.tier ?? null;
    return Object.freeze({
      id: entry.id ?? null,
      name: entry.name,
      domain: entry.domain ?? null,
      subtype: entry.subtype ?? null,
      affinity,
      affinityPercent: Math.round(affinity * 100),
      divergencePercent: Math.round((1 - affinity) * 100),
      popularity: finiteNumber(entry.popularity),
      uniquenessTier,
      tier: affinity === 0
        ? ANTITHESIS_TIERS.ZERO_AFFINITY
        : ANTITHESIS_TIERS.LOWEST_CORRELATION,
      sponsorshipRisk: uniquenessTier === 'mainstream',
      pitch: `the graph's weakest measured correlation in ${entry.domain ?? 'the pool'}` +
        ` (${Math.round((1 - affinity) * 100)}% divergence)`,
    });
  });

  // 3. Divergence DESC (affinity ASC), popularity DESC, name.
  records.sort((a, b) =>
    a.affinity - b.affinity
    || (b.popularity ?? -1) - (a.popularity ?? -1)
    || a.name.localeCompare(b.name)
  );

  // 4. The blindspot matrix: every planned domain, top perDomain
  //    weakest correlations (empty domains stay visible).
  const matrix = Object.freeze(domains.map((domain) => {
    const entries = Object.freeze(
      records.filter((record) => record.domain === domain).slice(0, perDomain)
    );
    return Object.freeze({ domain, count: entries.length, entries });
  }));
  const selected = matrix.reduce((sum, zone) => sum + zone.count, 0);

  const conflictDrivers = Object.freeze(records.slice(0, conflictLimit));
  const sponsorshipRisks = Object.freeze(
    matrix.flatMap((zone) => zone.entries)
      .filter((record) => record.sponsorshipRisk)
  );

  return Object.freeze({
    anchor: Object.freeze({
      name: pieces.anchor.name,
      domain: pieces.anchor.domain ?? null,
    }),
    strategy: SELECTION_STRATEGIES.LOWEST_CORRELATION,
    thresholds: null, // the plan's honest null: nothing accepted on affinity
    perDomain,
    matrix,
    conflictDrivers,
    sponsorshipRisks,
    summary: selected > 0
      ? `${selected} blindspot entr(ies) across ` +
        `${matrix.filter((zone) => zone.count > 0).length} domain(s) — ` +
        `the graph's measured opposition to ${pieces.anchor.name}.`
      : `No measurable blindspot evidence — nothing the graph can prove as opposition to ${pieces.anchor.name}.`,
    stats: Object.freeze({
      candidates: candidates.length,
      measurable: measurable.length,
      unmeasurable,
      selected,
      domainsCovered: matrix.filter((zone) => zone.count > 0).length,
      zeroAffinity: records.filter((record) => record.tier === ANTITHESIS_TIERS.ZERO_AFFINITY).length,
      mainstreamRisks: sponsorshipRisks.length,
    }),
  });
}

const driveSession = (session, { requestId, entity, block }) => {
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
    payload: { affinities: block.conflictDrivers },
  });
  // Mode 3 REQUIRES the antithesis leg (task-81 plan) — this phase
  // carries the REAL divergence payload, never a skip marker.
  session.advancePhase({
    type: PhaseEvent.ANTITHESIS_READY,
    payload: {
      antithesis: {
        skipped: false,
        strategy: block.strategy,
        selected: block.stats.selected,
        conflictDrivers: block.conflictDrivers.length,
      },
    },
  });
  session.advancePhase({
    type: PhaseEvent.DOSSIER_READY,
    payload: { dossier: { mode: MODE_ANTITHESIS, blindspot: block.stats.selected } },
  });
};

/**
 * Run Mode 3 over an injected client set.
 *
 * @param {string|object} input target entity (resolveSeed ingress).
 * @param {object} options see the injection contract in the header.
 * @returns {Promise<object>} the frozen blindspot-report bundle.
 */
export async function runAntithesis(input, options = {}) {
  validateOptions(options);

  const plan = dispatchMode(MODE_ANTITHESIS); // the task-81 run plan
  const perDomain = options.perDomain ?? ANTITHESIS_DEFAULTS.perDomain;
  const conflictLimit = options.conflictLimit ?? ANTITHESIS_DEFAULTS.conflictLimit;

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
  const requestId = options.requestId ?? `ta-${entity.id}`;
  const failures = [];

  // 3. Bounded parallel affinity expansion across all five domains
  //    (the same vector service; per-domain failures isolated).
  const vector = await expandAffinityVector(
    { id: entity.id, domain: entity.category },
    {
      includeSeedDomain:
        options.includeSeedDomain ?? ANTITHESIS_DEFAULTS.includeSeedDomain,
      fetchFn: options.affinityFn,
      take: options.take,
      maxPerDomain: options.maxPerDomain,
    }
  );
  for (const failure of vector.failures) {
    failures.push({
      code: ANTITHESIS_CODES.DOMAIN_FAILED,
      domain: failure.domain ?? null,
      message: failure.error ?? null,
    });
  }

  // 4. THE INVERTED SELECTION: no threshold gate, no long-tail cut,
  //    no cliche quantile — the full pool is the evidence.
  const candidates = flattenExpansion(vector.expansion);
  const block = buildAntithesisBlock({
    anchor: { name: entity.name, domain: entity.category },
    candidates,
    domains: plan.domains,
    perDomain,
    conflictLimit,
  });

  // 5. Narrative synthesis (62-64): honest typed skip or isolated
  //    typed failure — the deterministic report always survives.
  let synthesis = null;
  let validation = null;
  let synthesisFailure = null;
  const synthesisRequested =
    options.synthesis ?? ANTITHESIS_DEFAULTS.synthesis;
  const dossierPayload = {
    anchor: { name: entity.name, category: entity.category },
    entity,
    top: block.conflictDrivers,
  };
  if (!synthesisRequested) {
    synthesisFailure = {
      code: ANTITHESIS_CODES.SYNTHESIS_SKIPPED,
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

  // 6. Terminal lifecycle events + optional persistence (task 70).
  driveSession(session, { requestId, entity, block });
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
      `runAntithesis: session lifecycle invariant broken ` +
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
        entity: { id: entity.id, name: entity.name, category: entity.category },
        top: block.conflictDrivers.map((record) => ({ id: record.id, name: record.name })),
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
    selection: Object.freeze({
      strategy: plan.selection,
      thresholds: plan.thresholds, // honest null (task-81 plan)
      measurable: block.stats.measurable,
      unmeasurable: block.stats.unmeasurable,
    }),
    antithesis: block,
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
      measurable: block.stats.measurable,
      selected: block.stats.selected,
      domainsCovered: block.stats.domainsCovered,
      domainFailures: vector.failed,
      synthesis: synthesis !== null ? 'ok' : (synthesisFailure?.code ?? null),
    }),
  });
}

/**
 * Render the printable blindspot report (deterministic, zero
 * emojis).
 */
export function renderAntithesisReport(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.matrix)) {
    throw new TypeError('renderAntithesisReport: expected a buildAntithesisBlock() block');
  }
  const lines = [];
  lines.push(
    `CULTURAL BLINDSPOT REPORT — ${block.anchor.name}` +
      `${block.anchor.domain ? ` (${block.anchor.domain})` : ''}`
  );
  lines.push(block.summary);
  lines.push('strategy: lowest_correlation (no affinity threshold applies)');
  for (const zone of block.matrix) {
    lines.push(`   [${zone.domain}] ${zone.count} blindspot pick(s)`);
    for (const record of zone.entries) {
      lines.push(
        `      - ${record.name} — ${record.divergencePercent}% divergence` +
          ` (${record.tier.replace('_', ' ')}` +
          `${record.sponsorshipRisk ? ', sponsorship risk' : ''})`
      );
    }
  }
  if (block.conflictDrivers.length > 0) {
    lines.push(`CONFLICT DRIVERS: ${block.conflictDrivers.map((r) => r.name).join(', ')}`);
  }
  if (block.sponsorshipRisks.length > 0) {
    lines.push(`SPONSORSHIP RISKS: ${block.sponsorshipRisks.map((r) => r.name).join(', ')}`);
  }
  return lines.join('\n');
}

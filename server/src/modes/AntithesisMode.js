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
 * SELECTION MATH (buildAntithesisBlock, exported and pure): the
 * inversion itself is DELEGATED to the engine-level
 * TasteInverter (task 95) — the coefficient chain (a declared
 * signed `correlation` first, then the unsigned task-60 chain,
 * range-checked; corrupt values rejected, never salvaged), the
 * bounded divergence and the pool ordering live there, proven and
 * reusable; this module adds the report framing:
 *   1. MEASURABLE-ONLY discipline (task 48): a candidate without a
 *      measurable coefficient is UNMEASURED — the absence of
 *      evidence is never treated as divergence; such rows are
 *      excluded and honestly counted (`unmeasurable`);
 *   2. entries sort divergence DESCENDING, then popularity
 *      DESCENDING (a mainstream blindspot pick is the strongest
 *      conflict/risk material), then name;
 *   3. per-domain matrix: the top `perDomain` weakest correlations
 *      for EVERY planned domain (an empty domain stays visible with
 *      count 0 — honest coverage);
 *   4. TIERS: `negative_correlation` (a PROVEN signed c < 0 — the
 *      strongest antithesis evidence) > `zero_affinity` (the graph
 *      explicitly returns 0 — a proven non-correlation) >
 *      `lowest_correlation` (the weakest MEASURED correlation);
 *      `sponsorshipRisk` marks mainstream-tier picks — mass-market
 *      names the anchor's taste does NOT justify (association reads
 *      inauthentic). The flag reuses the task-57 tier VERBATIM: its
 *      normalized coefficient (minProbability 1e-6, maxBits ~19.93)
 *      puts the mainstream band at popularity >= ~0.126 —
 *      deliberately generous: every blindspot pick with meaningful
 *      mass recognition lands in the review queue. Records carry
 *      BOTH conventions honestly: unsigned rows report `affinity`,
 *      signed rows report `correlation` — never coerced into each
 *      other.
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
import {
  invertTasteVector, INVERTER_STRATEGIES, COEFFICIENT_KINDS,
} from '../engine/TasteInverter.js';
import {
  filterConsciousDissonance, ENCOUNTER_TIERS,
} from '../engine/DissonanceFilter.js';
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
  NEGATIVE_CORRELATION: 'negative_correlation',
  ZERO_AFFINITY: 'zero_affinity',
  LOWEST_CORRELATION: 'lowest_correlation',
});

/**
 * A divergence at/above this percent counts as MEASURED OPPOSITION.
 * Below it, the entries are merely the LEAST-AFFINE of strongly-affine
 * matches (Qloo insights returns only high-affinity entities, sorted
 * descending — there is no ascending/low-affinity option), so claiming
 * 'the graph's measured opposition' would OVERCLAIM. The summary
 * stays honest either way.
 */
const MEANINGFUL_OPPOSITION_DIV = 30;

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
  if (options.keepMinimal !== undefined && typeof options.keepMinimal !== 'boolean') {
    throw new TypeError('runAntithesis: keepMinimal must be a boolean');
  }
  if (options.minEncounterTier !== undefined && !ENCOUNTER_TIERS.includes(options.minEncounterTier)) {
    throw new TypeError(
      `runAntithesis: minEncounterTier must be one of ${ENCOUNTER_TIERS.join(' | ')}`
    );
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
  if (pieces.keepMinimal !== undefined && typeof pieces.keepMinimal !== 'boolean') {
    throw new TypeError('buildAntithesisBlock: keepMinimal must be a boolean');
  }
  if (pieces.minEncounterTier !== undefined && !ENCOUNTER_TIERS.includes(pieces.minEncounterTier)) {
    throw new TypeError(
      `buildAntithesisBlock: minEncounterTier must be one of ${ENCOUNTER_TIERS.join(' | ')}`
    );
  }

  const candidates = Array.isArray(pieces.candidates) ? pieces.candidates : [];

  // 1+2. THE INVERSION (task 95): the engine-level TasteInverter
  //      runs the coefficient chain (declared signed `correlation`
  //      first, then the unsigned task-60 chain, range-checked;
  //      corrupt values are rejected, never salvaged), computes the
  //      bounded divergence and orders the pool. Uniqueness (57)
  //      annotates the SAME rows for the sponsorship-risk marker.
  const annotated = annotateUniqueness(candidates);
  const inverted = invertTasteVector(annotated.entries, {
    strategy: INVERTER_STRATEGIES.LOWEST,
    take: Math.min(1000, Math.max(1, annotated.entries.length)),
  });
  // 3. NOISE FILTRATION (task 96): accidental low-correlation rows
  //    (unproven encounter / obscure tail) are cut into the ledger;
  //    the matrix and the lanes are built from CONSCIOUS-dissonance
  //    records only.
  const filtered = filterConsciousDissonance(inverted.records, {
    ...(pieces.keepMinimal !== undefined ? { keepMinimal: pieces.keepMinimal } : {}),
    ...(pieces.minEncounterTier !== undefined
      ? { minEncounterTier: pieces.minEncounterTier } : {}),
  });
  const byKey = new Map(
    annotated.entries.map((entry) => [entry.id ?? entry.name, entry])
  );
  const records = filtered.kept.map((record) => {
    const entry = byKey.get(record.id ?? record.name);
    const uniquenessTier = entry?.uniqueness?.tier ?? null;
    return Object.freeze({
      id: record.id,
      name: record.name,
      domain: record.domain,
      subtype: record.subtype,
      // Unsigned rows keep the historical affinity shape; signed
      // rows report the correlation VERBATIM (no coercion between
      // the two conventions).
      affinity: record.coefficientKind === COEFFICIENT_KINDS.UNSIGNED
        ? record.coefficient : null,
      correlation: record.coefficientKind === COEFFICIENT_KINDS.SIGNED
        ? record.coefficient : null,
      affinityPercent: record.coefficientKind === COEFFICIENT_KINDS.UNSIGNED
        ? Math.round(record.coefficient * 100) : null,
      divergencePercent: record.divergencePercent,
      negativeCorrelation: record.negativeCorrelation,
      popularity: record.popularity,
      dissonanceClass: record.dissonanceClass,
      encounter: record.encounter,
      uniquenessTier,
      tier: record.negativeCorrelation === true
        ? ANTITHESIS_TIERS.NEGATIVE_CORRELATION
        : (record.zeroAffinity === true
          ? ANTITHESIS_TIERS.ZERO_AFFINITY
          : ANTITHESIS_TIERS.LOWEST_CORRELATION),
      sponsorshipRisk: uniquenessTier === 'mainstream',
      pitch: `the graph's weakest measured correlation in ${record.domain ?? 'the pool'}` +
        ` (${record.divergencePercent}% divergence)`,
    });
  });

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

  // 5. THE PROTAGONIST FINGERPRINT (task 97): the hero's OWN
  //    strongest taste per domain — the highest measured affinity
  //    in that domain (lowest divergence). Computed over the SAME
  //    measurable pool in one pass, so the antagonist profile can
  //    contrast the hero's world against the blindspot without a
  //    second run.
  const fingerprint = Object.freeze(domains.map((domain) => {
    let hero = null;
    for (const record of inverted.records) {
      if (record.domain !== domain) continue;
      // records are divergence-DESC, so a later (lower-divergence,
      // higher-affinity) row wins; tiebreak on name for stability.
      if (hero === null
        || record.divergence < hero.divergence
        || (record.divergence === hero.divergence
          && record.name.localeCompare(hero.name) < 0)) {
        hero = record;
      }
    }
    return Object.freeze({
      domain,
      present: hero !== null,
      name: hero?.name ?? null,
      id: hero?.id ?? null,
      affinity: hero?.coefficientKind === COEFFICIENT_KINDS.UNSIGNED
        ? hero.coefficient : null,
      affinityPercent: hero?.coefficientKind === COEFFICIENT_KINDS.UNSIGNED
        ? Math.round(hero.coefficient * 100) : null,
      divergencePercent: hero?.divergencePercent ?? null,
    });
  }));

  return Object.freeze({
    anchor: Object.freeze({
      name: pieces.anchor.name,
      domain: pieces.anchor.domain ?? null,
    }),
    strategy: SELECTION_STRATEGIES.LOWEST_CORRELATION,
    thresholds: null, // the plan's honest null: nothing accepted on affinity
    coefficientDomain: inverted.coefficientDomain,
    protagonist: Object.freeze({
      name: pieces.anchor.name,
      domain: pieces.anchor.domain ?? null,
      fingerprint,
    }),
    dissonance: Object.freeze({
      minEncounterTier: filtered.minEncounterTier,
      keepMinimal: filtered.keepMinimal,
      classes: filtered.stats.classes,
      reasons: filtered.stats.reasons,
      cut: filtered.cut,
    }),
    perDomain,
    matrix,
    conflictDrivers,
    sponsorshipRisks,
    summary: (() => {
      const domains = matrix.filter((zone) => zone.count > 0).length;
      if (selected === 0) {
        return `No measurable blindspot evidence — nothing the graph can prove as opposition to ${pieces.anchor.name}.`;
      }
      const maxDivergence = records.reduce(
        (max, record) => Math.max(max, record.divergencePercent ?? 0), 0);
      // Qloo insights returns ONLY high-affinity entities (0..1, sorted
      // descending; no ascending option), so the weakest-correlation
      // entries are often still strongly affine. Claim "measured
      // opposition" only when the divergence actually PROVES it.
      return maxDivergence >= MEANINGFUL_OPPOSITION_DIV
        ? `${selected} blindspot entr(ies) across ${domains} domain(s) — ` +
          `the graph's measured opposition to ${pieces.anchor.name}.`
        : `${selected} entr(ies) across ${domains} domain(s) — the WEAKEST-` +
          `correlation verified matches to ${pieces.anchor.name} ` +
          `(max divergence ${maxDivergence}%): these are the least-affine of ` +
          `the strongly-affine pool, NOT measured cultural opposition — ` +
          `no strong blindspot is provable in this verified data.`;
    })(),
    stats: Object.freeze({
      candidates: candidates.length,
      measurable: inverted.stats.measurable,
      unmeasurable: inverted.stats.unmeasurable,
      noiseCut: filtered.stats.cut,
      selected,
      domainsCovered: matrix.filter((zone) => zone.count > 0).length,
      zeroAffinity: inverted.stats.zeros,
      negatives: inverted.stats.negatives,
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
    // Task 193: verify the anchor is a signal Qloo accepts (swap to a
    // usable alternative when it is not — never 500 on a stub record).
    signalProbe: options.affinityFn,
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
    ...(options.keepMinimal !== undefined ? { keepMinimal: options.keepMinimal } : {}),
    ...(options.minEncounterTier !== undefined
      ? { minEncounterTier: options.minEncounterTier } : {}),
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
      noiseCut: block.stats.noiseCut,
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
  if (block.dissonance && block.dissonance.cut.length > 0) {
    lines.push(
      `NOISE CUT (${block.dissonance.cut.length}): ` +
        block.dissonance.cut
          .map((c) => `${c.name} [${c.reason.replace(/_/g, ' ')}]`)
          .join(', ')
    );
  }
  return lines.join('\n');
}

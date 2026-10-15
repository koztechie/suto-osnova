/**
 * Agent execution PHASES (task 42) — the six discrete phases of the
 * dossier pipeline, the mise-en-scène core of the SUTO OSNOVA agent:
 *
 *   IDLE -> SEED_RESOLUTION -> AFFINITY_EXPANSION ->
 *   ANTITHESIS_GENERATION -> DOSSIER_SYNTHESIS -> COMPLETED
 *
 * Semantics
 * ---------
 * IDLE                  nothing in flight; a pipeline starts with `start`.
 * SEED_RESOLUTION       resolve the user's seed (entity or taste vector)
 *                       to a canonical Qloo entity — tool qloo_resolve_entity.
 * AFFINITY_EXPANSION    expand the resolved seed across the five agent
 *                       domains (film/music/books/dining/fashion) via the
 *                       cross-domain affinity gateway — tool
 *                       qloo_get_cross_domain_affinities.
 * ANTITHESIS_GENERATION build the taste CONTRAST profile of the seed —
 *                       tool qloo_taste_antithesis.
 * DOSSIER_SYNTHESIS     assemble the final cultural dossier narrative
 *                       locally (no upstream call).
 * COMPLETED             terminal: the dossier is ready for delivery.
 *
 * Relation to AgentStateMachine (task 41): that machine governs the
 * REQUEST lifecycle (intake, intent classification, single tool calls);
 * this ladder governs WHAT a dossier request builds — a multi-tool
 * pipeline that advances only when each stage's tool result arrives as
 * an event. The executor (future task) drives both; the tools used here
 * are a strict subset of task 41's canonical qloo_* intent map, pinned
 * by a cross-module consistency test.
 *
 * DETERMINISM (same discipline as task 41, pinned by
 * server/test/agentPhases.test.js):
 * P1. pure reducer: advance(pipeline, event) does no I/O, no clocks, no
 *     RNG; result depends only on (phase, context, event);
 * P2. total function over known events: every (phase, event) is a
 *     defined step or throws InvalidPhaseError — no silent drops;
 * P3. the ladder is LINEAR: every forward step advances exactly one
 *     position in PHASE_ORDER; the only backward step is fail -> IDLE;
 * P4. immutability: advance returns a NEW frozen pipeline; context
 *     accumulators are replaced, never mutated; trace is a bounded FIFO
 *     of deterministic {from, event, to} records.
 */

export const AgentPhase = Object.freeze({
  IDLE: 'IDLE',
  SEED_RESOLUTION: 'SEED_RESOLUTION',
  AFFINITY_EXPANSION: 'AFFINITY_EXPANSION',
  ANTITHESIS_GENERATION: 'ANTITHESIS_GENERATION',
  DOSSIER_SYNTHESIS: 'DOSSIER_SYNTHESIS',
  COMPLETED: 'COMPLETED',
});

/** Canonical forward order of the six phases. */
export const PHASE_ORDER = Object.freeze([
  AgentPhase.IDLE,
  AgentPhase.SEED_RESOLUTION,
  AgentPhase.AFFINITY_EXPANSION,
  AgentPhase.ANTITHESIS_GENERATION,
  AgentPhase.DOSSIER_SYNTHESIS,
  AgentPhase.COMPLETED,
]);

export const PhaseEvent = Object.freeze({
  START: 'start',
  SEED_RESOLVED: 'seed.resolved',
  AFFINITIES_COLLECTED: 'affinities.collected',
  ANTITHESIS_READY: 'antithesis.ready',
  DOSSIER_READY: 'dossier.ready',
  FAIL: 'fail',
});

/** Phase -> upstream tool (null = local phase, no Qloo call). */
export const PHASE_TOOL = Object.freeze({
  [AgentPhase.IDLE]: null,
  [AgentPhase.SEED_RESOLUTION]: 'qloo_resolve_entity',
  [AgentPhase.AFFINITY_EXPANSION]: 'qloo_get_cross_domain_affinities',
  [AgentPhase.ANTITHESIS_GENERATION]: 'qloo_taste_antithesis',
  [AgentPhase.DOSSIER_SYNTHESIS]: null,
  [AgentPhase.COMPLETED]: null,
});

export const ACTIVE_PHASES = Object.freeze(
  new Set([
    AgentPhase.SEED_RESOLUTION,
    AgentPhase.AFFINITY_EXPANSION,
    AgentPhase.ANTITHESIS_GENERATION,
    AgentPhase.DOSSIER_SYNTHESIS,
  ])
);

/** Bounded deterministic trace (mirrors task 41's TRACE_LIMIT). */
export const TRACE_LIMIT = 100;

export class InvalidPhaseError extends Error {
  /**
   * @param {string} message  what was rejected.
   * @param {object} details  { phase, event, reason }.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidPhaseError';
    this.phase = details.phase ?? null;
    this.event = details.event ?? null;
    this.reason = details.reason ?? 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Ladder: LADDER[phase][event.type] = next phase. Missing pair throws.
// ---------------------------------------------------------------------------

const LADDER = Object.freeze({
  [AgentPhase.IDLE]: {
    [PhaseEvent.START]: AgentPhase.SEED_RESOLUTION,
  },
  [AgentPhase.SEED_RESOLUTION]: {
    [PhaseEvent.SEED_RESOLVED]: AgentPhase.AFFINITY_EXPANSION,
    [PhaseEvent.FAIL]: AgentPhase.IDLE,
  },
  [AgentPhase.AFFINITY_EXPANSION]: {
    [PhaseEvent.AFFINITIES_COLLECTED]: AgentPhase.ANTITHESIS_GENERATION,
    [PhaseEvent.FAIL]: AgentPhase.IDLE,
  },
  [AgentPhase.ANTITHESIS_GENERATION]: {
    [PhaseEvent.ANTITHESIS_READY]: AgentPhase.DOSSIER_SYNTHESIS,
    [PhaseEvent.FAIL]: AgentPhase.IDLE,
  },
  [AgentPhase.DOSSIER_SYNTHESIS]: {
    [PhaseEvent.DOSSIER_READY]: AgentPhase.COMPLETED,
    [PhaseEvent.FAIL]: AgentPhase.IDLE,
  },
  [AgentPhase.COMPLETED]: {},
});

export const PHASE_TRANSITIONS = LADDER;

const INITIAL_CONTEXT = Object.freeze({
  seed: null,
  affinities: Object.freeze([]),
  antithesis: null,
  dossier: null,
  failure: null,
});

/**
 * Context accumulator per forward step — pure (context, payload) ->
 * patch. `fail` records the failure and keeps partial work for
 * diagnostics.
 */
const PATCHES = Object.freeze({
  [PhaseEvent.START]: () => ({}),
  [PhaseEvent.SEED_RESOLVED]: (_c, payload) => ({
    seed: payload?.seed ?? null,
  }),
  [PhaseEvent.AFFINITIES_COLLECTED]: (_c, payload) => ({
    affinities: Object.freeze([...(payload?.affinities ?? [])]),
  }),
  [PhaseEvent.ANTITHESIS_READY]: (_c, payload) => ({
    antithesis: payload?.antithesis ?? null,
  }),
  [PhaseEvent.DOSSIER_READY]: (_c, payload) => ({
    dossier: payload?.dossier ?? null,
  }),
  [PhaseEvent.FAIL]: (_c, payload) => ({
    failure: {
      code: String(payload?.code ?? 'UPSTREAM_ERROR'),
      message: String(payload?.message ?? '').slice(0, 500),
    },
  }),
});

function freezePipeline(phase, context, trace) {
  return Object.freeze({
    phase,
    context: Object.freeze(context),
    trace: Object.freeze(trace.map(Object.freeze)),
  });
}

/** Fresh pipeline in IDLE with empty accumulators and trace. */
export function createPipeline() {
  return freezePipeline(AgentPhase.IDLE, { ...INITIAL_CONTEXT }, []);
}

/**
 * Structural check: is (phase, event-type) a DEFINED pair? Payload-free.
 */
export function canAdvance(phase, eventType) {
  return Boolean(LADDER[phase]?.[eventType]);
}

export function isTerminalPhase(phase) {
  return phase === AgentPhase.COMPLETED;
}

/** Upstream tool a phase calls (null for local phases). */
export function phaseTool(phase) {
  return PHASE_TOOL[phase] ?? null;
}

/**
 * Deterministic step (P1-P4). Returns a NEW frozen pipeline; throws
 * InvalidPhaseError for unknown events / undefined pairs, TypeError for
 * malformed arguments.
 */
export function advance(pipeline, event) {
  if (!pipeline || typeof pipeline.phase !== 'string') {
    throw new TypeError('advance: pipeline must be a phase-pipeline object');
  }
  if (!event || typeof event.type !== 'string') {
    throw new TypeError('advance: event must be { type: string, payload? }');
  }

  const target = LADDER[pipeline.phase]?.[event.type];
  if (target === undefined) {
    throw new InvalidPhaseError(
      `No phase step for (${pipeline.phase}, ${event.type})`,
      { phase: pipeline.phase, event: event.type, reason: 'undefined_pair' }
    );
  }

  const patch = PATCHES[event.type] ?? (() => ({}));
  const context = { ...pipeline.context, ...patch(pipeline.context, event.payload) };
  const record = { from: pipeline.phase, event: event.type, to: target };
  const trace = [...pipeline.trace, record].slice(-TRACE_LIMIT);

  return freezePipeline(target, context, trace);
}

export default {
  AgentPhase,
  PHASE_ORDER,
  PhaseEvent,
  PHASE_TOOL,
  ACTIVE_PHASES,
  TRACE_LIMIT,
  InvalidPhaseError,
  PHASE_TRANSITIONS,
  createPipeline,
  canAdvance,
  isTerminalPhase,
  phaseTool,
  advance,
};

/**
 * Agent finite state machine core (task 41) — the deterministic heart of
 * the SUTO OSNOVA agent engine, layered ABOVE the gateway/MCP toolbox.
 *
 * DESIGN
 * ======
 *
 *      IDLE --REQUEST_RECEIVED--> INTAKE --INPUT_VALID--> INTENT
 *                (SANITIZE_INPUT)        |  INPUT_REJECTED--> FAILED
 *                                        |
 *              INTENT_CLASSIFIED(domain intent)   INTENT_CLASSIFIED(direct)
 *                        v                                   v
 *                    DOMAIN -----------------------------> EXECUTE
 *             DOMAIN_RESOLVED  |  DOMAIN_UNRESOLVED         ^  |
 *                              v        |                   |  | EXECUTION_SUCCEEDED
 *                       DISAMBIGUATION  |                   |  v
 *                CLARIFICATION_PROVIDED--+              SYNTHESIZE
 *                        (back to DOMAIN)                   | SYNTHESIS_READY
 *                                                           v
 *   EXECUTE --EXECUTION_FAILED(retryable, attempts<MAX)--> EXECUTE (CALL_TOOL)
 *   EXECUTE --EXECUTION_FAILED|EXECUTION_REJECTED-------> FAILED
 *   any non-terminal state --CANCEL--> CANCELLED
 *   DELIVERED | FAILED | CANCELLED --RESET--> IDLE
 *
 * DETERMINISM INVARIANTS (pinned by server/test/agentStateMachine.test.js)
 * -----------------------------------------------------------------------
 * D1. PURE REDUCER: `transition(machine, event)` performs no I/O, no
 *     clocks, no RNG. The result is a pure function of
 *     (machine.state, machine.context, event) — the same event script
 *     always yields the same machine.
 * D2. TOTAL FUNCTION over known events: every (state, event) pair is
 *     either a defined transition or throws `InvalidTransitionError` —
 *     no silent drops, no implicit self-loops.
 * D3. GUARDS are pure predicates over (context, event); branches are
 *     evaluated in order, first match wins; a guard-rejected pair throws
 *     (it is a rejected *payload*, not an unknown pair).
 * D4. EFFECTS ARE DECLARATIONS: the machine emits effect descriptors
 *     (SANITIZE_INPUT, CLASSIFY_INTENT, CALL_TOOL, EMIT_RESPONSE, ABORT,
 *     CLEAR_CONTEXT) and WAITS; an executor performs the I/O and feeds
 *     results back as events. The engine core never calls out.
 * D5. IMMUTABILITY: every transition returns a NEW frozen machine;
 *     context patches are shallow-merged over a copied context, never
 *     mutated in place.
 *
 * Intent -> canonical MCP tool mapping uses the live-verified qloo_*
 * namespace (task 33); domain-bearing intents resolve their sphere(s)
 * through domainMapper (task 24) before execution.
 */

// ---------------------------------------------------------------------------
// Vocabulary (frozen enums)
// ---------------------------------------------------------------------------

export const AgentState = Object.freeze({
  IDLE: 'idle',
  INTAKE: 'intake',
  INTENT: 'intent',
  DOMAIN: 'domain',
  DISAMBIGUATION: 'disambiguation',
  EXECUTE: 'execute',
  SYNTHESIZE: 'synthesize',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const AgentEvent = Object.freeze({
  REQUEST_RECEIVED: 'request.received',
  INPUT_VALID: 'input.valid',
  INPUT_REJECTED: 'input.rejected',
  INTENT_CLASSIFIED: 'intent.classified',
  DOMAIN_RESOLVED: 'domain.resolved',
  DOMAIN_UNRESOLVED: 'domain.unresolved',
  CLARIFICATION_PROVIDED: 'clarification.provided',
  EXECUTION_SUCCEEDED: 'execution.succeeded',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_REJECTED: 'execution.rejected',
  SYNTHESIS_READY: 'synthesis.ready',
  CANCEL: 'cancel',
  RESET: 'reset',
});

export const AgentEffect = Object.freeze({
  SANITIZE_INPUT: 'effect.sanitize_input',
  CLASSIFY_INTENT: 'effect.classify_intent',
  CALL_TOOL: 'effect.call_tool',
  EMIT_RESPONSE: 'effect.emit_response',
  ABORT: 'effect.abort',
  CLEAR_CONTEXT: 'effect.clear_context',
});

export const AgentIntent = Object.freeze({
  SEARCH: 'search',
  TASTE_TAGS: 'taste_tags',
  CROSS_DOMAIN: 'cross_domain',
  AUDIENCE_INSIGHTS: 'audience_insights',
  RESOLVE_ENTITY: 'resolve_entity',
  CROSS_CORRELATE: 'cross_correlate',
  TASTE_ANTITHESIS: 'taste_antithesis',
  CAPABILITIES: 'capabilities',
  GROUP_BY_DOMAIN: 'group_by_domain',
  PRIVACY_SCAN: 'privacy_scan',
});

/** Intent -> canonical MCP tool (qloo_* namespace, task 33). */
export const INTENT_TOOL = Object.freeze({
  [AgentIntent.SEARCH]: 'qloo_search_entities',
  [AgentIntent.TASTE_TAGS]: 'qloo_find_tags',
  [AgentIntent.CROSS_DOMAIN]: 'qloo_get_cross_domain_affinities',
  [AgentIntent.AUDIENCE_INSIGHTS]: 'qloo_get_audience_insights',
  [AgentIntent.RESOLVE_ENTITY]: 'qloo_resolve_entity',
  [AgentIntent.CROSS_CORRELATE]: 'qloo_cross_correlate',
  [AgentIntent.TASTE_ANTITHESIS]: 'qloo_taste_antithesis',
  [AgentIntent.CAPABILITIES]: 'qloo_capabilities',
  [AgentIntent.GROUP_BY_DOMAIN]: 'qloo_group_entities_by_domain',
  [AgentIntent.PRIVACY_SCAN]: 'qloo_detect_personal_data',
});

/** Intents whose execution REQUIRES domain(s) resolved via domainMapper. */
export const DOMAIN_INTENTS = Object.freeze(
  new Set([
    AgentIntent.SEARCH,
    AgentIntent.TASTE_TAGS,
    AgentIntent.CROSS_DOMAIN,
    AgentIntent.AUDIENCE_INSIGHTS,
    AgentIntent.RESOLVE_ENTITY,
    AgentIntent.CROSS_CORRELATE,
    AgentIntent.TASTE_ANTITHESIS,
  ])
);

export const FailureCode = Object.freeze({
  PII_DETECTED: 'PII_DETECTED',
  MALFORMED_INPUT: 'MALFORMED_INPUT',
  UNKNOWN_INTENT: 'UNKNOWN_INTENT',
  TOOL_REJECTED: 'TOOL_REJECTED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  ATTEMPTS_EXHAUSTED: 'ATTEMPTS_EXHAUSTED',
});

/** Maximum tool invocations per user request (retries included). */
export const MAX_ATTEMPTS = 3;
/** Bounded trace: the machine keeps the last N transition records. */
export const TRACE_LIMIT = 100;

export const TERMINAL_STATES = Object.freeze(
  new Set([AgentState.DELIVERED, AgentState.FAILED, AgentState.CANCELLED])
);

export class InvalidTransitionError extends Error {
  /**
   * @param {string} message  what was rejected.
   * @param {object} details  { state, event, reason }.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.state = details.state ?? null;
    this.event = details.event ?? null;
    this.reason = details.reason ?? 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Guards (pure predicates over context + event)
// ---------------------------------------------------------------------------

const guardNeedsDomain = (_context, event) =>
  DOMAIN_INTENTS.has(event.payload?.intent);

const guardCanRetry = (context, event) =>
  event.payload?.retryable === true && context.attempts < MAX_ATTEMPTS;

// ---------------------------------------------------------------------------
// Transition table: TABLE[state][event.type] = ordered branches.
// Each branch: { when?, to, assign?, effects? } — first `when`-true wins;
// a branch without `when` is the default. Missing pair = InvalidTransition.
// ---------------------------------------------------------------------------

const assignFailureFrom = (fallbackCode) => (context, event) => ({
  failure: {
    code: event.payload?.code ?? fallbackCode,
    message: String(event.payload?.message ?? '').slice(0, 500),
  },
});

const callToolEffect = (context) => [
  {
    type: AgentEffect.CALL_TOOL,
    tool: context.tool,
    intent: context.intent,
    domains: context.domains,
    attempt: context.attempts,
  },
];

const TABLE = Object.freeze({
  [AgentState.IDLE]: {
    [AgentEvent.REQUEST_RECEIVED]: [
      {
        to: AgentState.INTAKE,
        assign: (_c, event) => ({
          requestId: String(event.payload?.requestId ?? ''),
        }),
        effects: (_c, event) => [
          {
            type: AgentEffect.SANITIZE_INPUT,
            requestId: String(event.payload?.requestId ?? ''),
          },
        ],
      },
    ],
  },

  [AgentState.INTAKE]: {
    [AgentEvent.INPUT_VALID]: [
      {
        to: AgentState.INTENT,
        effects: (_c, event) => [
          { type: AgentEffect.CLASSIFY_INTENT, requestId: _c.requestId },
        ],
      },
    ],
    [AgentEvent.INPUT_REJECTED]: [
      { to: AgentState.FAILED, assign: assignFailureFrom(FailureCode.MALFORMED_INPUT) },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.INTENT]: {
    [AgentEvent.INTENT_CLASSIFIED]: [
      {
        when: guardNeedsDomain,
        to: AgentState.DOMAIN,
        assign: (_c, event) => ({
          intent: event.payload?.intent ?? null,
          tool: INTENT_TOOL[event.payload?.intent] ?? null,
        }),
      },
      {
        // Domain-less intents (capabilities, grouping, privacy scan)
        // execute directly.
        to: AgentState.EXECUTE,
        assign: (_c, event) => ({
          intent: event.payload?.intent ?? null,
          tool: INTENT_TOOL[event.payload?.intent] ?? null,
          attempts: 1,
        }),
        effects: (context) => callToolEffect(context),
      },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.DOMAIN]: {
    [AgentEvent.DOMAIN_RESOLVED]: [
      {
        to: AgentState.EXECUTE,
        assign: (_c, event) => ({
          domains: event.payload?.domains ?? null,
          attempts: 1,
        }),
        effects: (context) => callToolEffect(context),
      },
    ],
    [AgentEvent.DOMAIN_UNRESOLVED]: [
      {
        to: AgentState.DISAMBIGUATION,
        assign: (_c, event) => ({
          candidates: event.payload?.candidates ?? [],
        }),
      },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.DISAMBIGUATION]: {
    [AgentEvent.CLARIFICATION_PROVIDED]: [
      { to: AgentState.DOMAIN, assign: () => ({ candidates: [] }) },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.EXECUTE]: {
    [AgentEvent.EXECUTION_SUCCEEDED]: [
      {
        to: AgentState.SYNTHESIZE,
        assign: (_c, event) => ({ result: event.payload?.result ?? null }),
      },
    ],
    [AgentEvent.EXECUTION_FAILED]: [
      {
        // Bounded, deterministic retry: same payload -> same decision.
        when: guardCanRetry,
        to: AgentState.EXECUTE,
        assign: (context) => ({ attempts: context.attempts + 1 }),
        effects: (context) => callToolEffect(context),
      },
      {
        to: AgentState.FAILED,
        assign: (_c, event) => ({
          failure: {
            code: event.payload?.retryable
              ? FailureCode.ATTEMPTS_EXHAUSTED
              : (event.payload?.code ?? FailureCode.UPSTREAM_ERROR),
            message: String(event.payload?.message ?? '').slice(0, 500),
          },
        }),
      },
    ],
    [AgentEvent.EXECUTION_REJECTED]: [
      { to: AgentState.FAILED, assign: assignFailureFrom(FailureCode.TOOL_REJECTED) },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.SYNTHESIZE]: {
    [AgentEvent.SYNTHESIS_READY]: [
      {
        to: AgentState.DELIVERED,
        assign: (_c, event) => ({ response: event.payload?.response ?? null }),
        effects: (_c, event) => [
          {
            type: AgentEffect.EMIT_RESPONSE,
            response: event.payload?.response ?? null,
          },
        ],
      },
    ],
    [AgentEvent.CANCEL]: [
      { to: AgentState.CANCELLED, effects: () => [{ type: AgentEffect.ABORT }] },
    ],
  },

  [AgentState.DELIVERED]: {
    [AgentEvent.RESET]: [{ to: AgentState.IDLE, assign: () => ({ ...INITIAL_CONTEXT }) }],
  },
  [AgentState.FAILED]: {
    [AgentEvent.RESET]: [{ to: AgentState.IDLE, assign: () => ({ ...INITIAL_CONTEXT }) }],
  },
  [AgentState.CANCELLED]: {
    [AgentEvent.RESET]: [{ to: AgentState.IDLE, assign: () => ({ ...INITIAL_CONTEXT }) }],
  },
});

export const TRANSITIONS = TABLE;

// ---------------------------------------------------------------------------
// Machine API
// ---------------------------------------------------------------------------

const INITIAL_CONTEXT = Object.freeze({
  requestId: null,
  intent: null,
  tool: null,
  domains: null,
  candidates: null,
  attempts: 0,
  result: null,
  response: null,
  failure: null,
});

function freezeMachine(state, context, trace) {
  return Object.freeze({
    state,
    context: Object.freeze(context),
    trace: Object.freeze(trace.map(Object.freeze)),
  });
}

/** Fresh machine in IDLE with an empty context and trace. */
export function createMachine() {
  return freezeMachine(AgentState.IDLE, { ...INITIAL_CONTEXT }, []);
}

/**
 * Structural check: is (state, event-type) a DEFINED pair? Guards are not
 * evaluated (they need a payload) — use `transition` for the full verdict.
 */
export function canTransition(state, eventType) {
  return Boolean(TABLE[state]?.[eventType]);
}

/**
 * Deterministic step (D1-D5). Returns a NEW frozen machine; throws
 * InvalidTransitionError for unknown events, undefined pairs and
 * guard-rejected payloads, TypeError for malformed arguments.
 */
export function transition(machine, event) {
  if (!machine || typeof machine.state !== 'string') {
    throw new TypeError('transition: machine must be a state-machine object');
  }
  if (!event || typeof event.type !== 'string') {
    throw new TypeError('transition: event must be { type: string, payload? }');
  }

  const branches = TABLE[machine.state]?.[event.type];
  if (!branches) {
    throw new InvalidTransitionError(
      `No transition for (${machine.state}, ${event.type})`,
      { state: machine.state, event: event.type, reason: 'undefined_pair' }
    );
  }

  const branch = branches.find((b) => !b.when || b.when(machine.context, event));
  if (!branch) {
    throw new InvalidTransitionError(
      `Guard rejected transition (${machine.state}, ${event.type})`,
      { state: machine.state, event: event.type, reason: 'guard' }
    );
  }

  const context = {
    ...machine.context,
    ...(branch.assign ? branch.assign(machine.context, event) : {}),
  };
  const effects = Object.freeze(
    (branch.effects ? branch.effects(context, event) : []).map(Object.freeze)
  );
  const record = { from: machine.state, event: event.type, to: branch.to };
  const trace = [...machine.trace, record].slice(-TRACE_LIMIT);

  const next = freezeMachine(branch.to, context, trace);
  // Effects ride alongside the machine for the executor; frozen too.
  return Object.freeze({ ...next, effects });
}

export default {
  AgentState,
  AgentEvent,
  AgentEffect,
  AgentIntent,
  INTENT_TOOL,
  DOMAIN_INTENTS,
  FailureCode,
  MAX_ATTEMPTS,
  TRACE_LIMIT,
  TERMINAL_STATES,
  InvalidTransitionError,
  TRANSITIONS,
  createMachine,
  canTransition,
  transition,
};

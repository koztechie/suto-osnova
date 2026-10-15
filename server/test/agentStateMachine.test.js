/**
 * AgentStateMachine tests (task 41) — pins the determinism invariants
 * D1-D5 from the module header: total transition matrix, guard semantics,
 * bounded retries, immutability, bounded trace, error taxonomy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from '../src/engine/AgentStateMachine.js';

/** Synthetic machine at an arbitrary state (structural acceptance). */
const machineAt = (state, contextPatch = {}) => ({
  state,
  context: {
    requestId: 'r-1',
    intent: 'search',
    tool: 'qloo_search_entities',
    domains: ['urn:entity:film'],
    candidates: [],
    attempts: 1,
    result: null,
    response: null,
    failure: null,
    ...contextPatch,
  },
  trace: [],
});

/** Event rich enough to satisfy every guard in the table. */
const richEvent = (type) => ({
  type,
  payload: {
    requestId: 'r-1',
    intent: 'search',
    domains: ['urn:entity:film'],
    candidates: ['urn:entity:film', 'urn:entity:book'],
    result: { entities: [] },
    response: { text: 'ok' },
    retryable: true,
    code: FailureCode.TOOL_REJECTED,
    message: 'boom',
  },
});

test('initial machine is IDLE with empty context and frozen vocabulary', () => {
  const m = createMachine();
  assert.equal(m.state, AgentState.IDLE);
  assert.equal(m.context.attempts, 0);
  assert.equal(m.context.intent, null);
  assert.deepEqual(m.trace, []);
  assert.ok(Object.isFrozen(m));
  assert.ok(Object.isFrozen(m.context));
  assert.ok(Object.isFrozen(m.trace));
  for (const enumObject of [AgentState, AgentEvent, AgentEffect, AgentIntent, INTENT_TOOL, FailureCode]) {
    assert.ok(Object.isFrozen(enumObject), 'enums stay frozen');
  }
  assert.ok(Object.isFrozen(TRANSITIONS), 'table stays frozen');
});

test('golden path: domain intent (search) full lifecycle', () => {
  let m = createMachine();
  const states = [m.state];
  const effects = [];

  m = transition(m, { type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-1' } });
  effects.push(...m.effects);
  states.push(m.state);

  m = transition(m, { type: AgentEvent.INPUT_VALID });
  effects.push(...m.effects);
  states.push(m.state);

  m = transition(m, { type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.SEARCH } });
  effects.push(...m.effects);
  states.push(m.state);
  assert.equal(m.context.tool, 'qloo_search_entities');

  m = transition(m, { type: AgentEvent.DOMAIN_RESOLVED, payload: { domains: ['urn:entity:film'] } });
  effects.push(...m.effects);
  states.push(m.state);
  assert.equal(m.context.attempts, 1, 'first execution attempt numbered 1');

  m = transition(m, { type: AgentEvent.EXECUTION_SUCCEEDED, payload: { result: { entities: ['e1'] } } });
  states.push(m.state);

  m = transition(m, { type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'ok' } } });
  effects.push(...m.effects);
  states.push(m.state);

  assert.deepEqual(states, [
    AgentState.IDLE,
    AgentState.INTAKE,
    AgentState.INTENT,
    AgentState.DOMAIN,
    AgentState.EXECUTE,
    AgentState.SYNTHESIZE,
    AgentState.DELIVERED,
  ]);
  assert.deepEqual(
    effects.map((e) => e.type),
    [
      AgentEffect.SANITIZE_INPUT,
      AgentEffect.CLASSIFY_INTENT,
      AgentEffect.CALL_TOOL,
      AgentEffect.EMIT_RESPONSE,
    ]
  );
  const call = effects.find((e) => e.type === AgentEffect.CALL_TOOL);
  assert.equal(call.tool, 'qloo_search_entities');
  assert.equal(call.attempt, 1);
  assert.equal(m.context.response.text, 'ok');
});

test('golden path: domain-less intent (capabilities) skips DOMAIN', () => {
  let m = createMachine();
  m = transition(m, { type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-2' } });
  m = transition(m, { type: AgentEvent.INPUT_VALID });
  m = transition(m, {
    type: AgentEvent.INTENT_CLASSIFIED,
    payload: { intent: AgentIntent.CAPABILITIES },
  });

  assert.equal(m.state, AgentState.EXECUTE);
  assert.equal(m.context.tool, 'qloo_capabilities');
  assert.equal(m.effects[0].type, AgentEffect.CALL_TOOL);
  assert.equal(m.effects[0].attempt, 1);
});

test('D1 determinism: identical event scripts yield identical machines', () => {
  const script = [
    { type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-9' } },
    { type: AgentEvent.INPUT_VALID },
    { type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: AgentIntent.SEARCH } },
    { type: AgentEvent.DOMAIN_RESOLVED, payload: { domains: ['urn:entity:film'] } },
    { type: AgentEvent.EXECUTION_FAILED, payload: { retryable: true } },
    { type: AgentEvent.EXECUTION_SUCCEEDED, payload: { result: { ok: true } } },
    { type: AgentEvent.SYNTHESIS_READY, payload: { response: { text: 'done' } } },
    { type: AgentEvent.RESET },
  ];
  const run = () => {
    let m = createMachine();
    for (const event of script) m = transition(m, event);
    return { state: m.state, context: m.context, trace: m.trace };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.equal(a.state, AgentState.IDLE, 'RESET returns to IDLE');
  assert.deepEqual(a.context, {
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
  assert.equal(a.context.attempts, 0, 'context fully reset');
  assert.equal(a.context.intent, null);
});

test('D2 total matrix: every (state, event) pair is defined or throws', () => {
  // Expected targets for every DEFINED pair (guards satisfied by payload).
  const expected = {
    'idle|request.received': AgentState.INTAKE,
    'intake|input.valid': AgentState.INTENT,
    'intake|input.rejected': AgentState.FAILED,
    'intake|cancel': AgentState.CANCELLED,
    'intent|intent.classified': AgentState.DOMAIN, // guard: intent=search needs domain
    'intent|cancel': AgentState.CANCELLED,
    'domain|domain.resolved': AgentState.EXECUTE,
    'domain|domain.unresolved': AgentState.DISAMBIGUATION,
    'domain|cancel': AgentState.CANCELLED,
    'disambiguation|clarification.provided': AgentState.DOMAIN,
    'disambiguation|cancel': AgentState.CANCELLED,
    'execute|execution.succeeded': AgentState.SYNTHESIZE,
    'execute|execution.failed': AgentState.EXECUTE, // retryable, attempts 1 < MAX
    'execute|execution.rejected': AgentState.FAILED,
    'execute|cancel': AgentState.CANCELLED,
    'synthesize|synthesis.ready': AgentState.DELIVERED,
    'synthesize|cancel': AgentState.CANCELLED,
    'delivered|reset': AgentState.IDLE,
    'failed|reset': AgentState.IDLE,
    'cancelled|reset': AgentState.IDLE,
  };

  let defined = 0;
  let rejected = 0;
  for (const state of Object.values(AgentState)) {
    for (const eventType of Object.values(AgentEvent)) {
      const key = `${state}|${eventType}`;
      const m = machineAt(state);
      if (expected[key]) {
        assert.equal(canTransition(state, eventType), true, `canTransition ${key}`);
        const next = transition(m, richEvent(eventType));
        assert.equal(next.state, expected[key], `target ${key}`);
        defined += 1;
      } else {
        assert.equal(canTransition(state, eventType), false, `canTransition false ${key}`);
        assert.throws(
          () => transition(m, richEvent(eventType)),
          (err) =>
            err instanceof InvalidTransitionError &&
            err.reason === 'undefined_pair' &&
            err.state === state &&
            err.event === eventType,
          `throws ${key}`
        );
        rejected += 1;
      }
    }
  }
  // 10 states x 13 events = 130 pairs; coverage must be exhaustive.
  assert.equal(defined + rejected, 130);
  assert.equal(defined, Object.keys(expected).length);
});

test('D3 guard: non-retryable failure goes straight to FAILED with its code', () => {
  let m = machineAt(AgentState.EXECUTE, { attempts: 1 });
  m = transition(m, {
    type: AgentEvent.EXECUTION_FAILED,
    payload: { retryable: false, code: FailureCode.TOOL_REJECTED, message: '401' },
  });
  assert.equal(m.state, AgentState.FAILED);
  assert.equal(m.context.failure.code, FailureCode.TOOL_REJECTED);
  assert.equal(m.context.failure.message, '401');
});

test('bounded retries: retryable failures loop until MAX_ATTEMPTS then ATTEMPTS_EXHAUSTED', () => {
  let m = machineAt(AgentState.EXECUTE, { attempts: 1 });
  const attempts = [m.context.attempts];

  // attempts 1 -> 2: retry granted.
  m = transition(m, { type: AgentEvent.EXECUTION_FAILED, payload: { retryable: true } });
  assert.equal(m.state, AgentState.EXECUTE);
  attempts.push(m.context.attempts);
  assert.equal(m.effects[0].type, AgentEffect.CALL_TOOL);
  assert.equal(m.effects[0].attempt, 2);

  // attempts 2 -> 3: retry granted.
  m = transition(m, { type: AgentEvent.EXECUTION_FAILED, payload: { retryable: true } });
  assert.equal(m.state, AgentState.EXECUTE);
  attempts.push(m.context.attempts);

  // attempts === MAX: no more retries.
  m = transition(m, { type: AgentEvent.EXECUTION_FAILED, payload: { retryable: true } });
  assert.equal(m.state, AgentState.FAILED);
  assert.equal(m.context.failure.code, FailureCode.ATTEMPTS_EXHAUSTED);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(MAX_ATTEMPTS, 3);
});

test('failed retry guard falls to the default branch (ATTEMPTS_EXHAUSTED)', () => {
  // Guard `retryable && attempts < MAX` is false at the attempt ceiling:
  // the default branch records ATTEMPTS_EXHAUSTED instead of looping.
  let m = machineAt(AgentState.EXECUTE, { attempts: MAX_ATTEMPTS });
  m = transition(m, { type: AgentEvent.EXECUTION_FAILED, payload: { retryable: true } });
  assert.equal(m.state, AgentState.FAILED, 'default branch taken when guard fails');
});

test('D5 immutability: previous machines are untouched, results frozen', () => {
  const before = createMachine();
  const snapshot = JSON.stringify(before);
  const next = transition(before, {
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId: 'r-imm' },
  });

  assert.equal(JSON.stringify(before), snapshot, 'input machine unchanged');
  assert.notEqual(next, before);
  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.context));
  assert.ok(Object.isFrozen(next.trace));
  assert.ok(Object.isFrozen(next.effects));
  assert.ok(Object.isFrozen(next.effects[0]));
  assert.equal(next.context.requestId, 'r-imm');
  assert.equal(before.context.requestId, null, 'context not shared');
});

test('CANCEL is accepted from every state with an in-flight request, RESET from every terminal', () => {
  for (const state of Object.values(AgentState)) {
    if (TERMINAL_STATES.has(state) || state === AgentState.IDLE) continue;
    const m = transition(machineAt(state), { type: AgentEvent.CANCEL });
    assert.equal(m.state, AgentState.CANCELLED, `cancel from ${state}`);
    assert.equal(m.effects[0].type, AgentEffect.ABORT);
  }
  for (const state of TERMINAL_STATES) {
    const m = transition(machineAt(state), { type: AgentEvent.RESET });
    assert.equal(m.state, AgentState.IDLE, `reset from ${state}`);
    assert.equal(m.context.attempts, 0);
    assert.equal(m.context.failure, null);
  }
});

test('terminal states reject foreign events; IDLE rejects CANCEL/RESET', () => {
  for (const state of TERMINAL_STATES) {
    for (const eventType of [
      AgentEvent.REQUEST_RECEIVED,
      AgentEvent.CANCEL,
      AgentEvent.EXECUTION_SUCCEEDED,
    ]) {
      assert.throws(
        () => transition(machineAt(state), { type: eventType }),
        InvalidTransitionError,
        `${state} stays terminal for ${eventType}`
      );
    }
  }
  assert.throws(() => transition(createMachine(), { type: AgentEvent.CANCEL }), InvalidTransitionError);
  assert.throws(() => transition(createMachine(), { type: AgentEvent.RESET }), InvalidTransitionError);
});

test('failure taxonomy: INPUT_REJECTED carries PII code into FAILED', () => {
  let m = transition(createMachine(), {
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId: 'r-pii' },
  });
  m = transition(m, {
    type: AgentEvent.INPUT_REJECTED,
    payload: { code: FailureCode.PII_DETECTED, message: 'masked 1 phone-like token' },
  });
  assert.equal(m.state, AgentState.FAILED);
  assert.equal(m.context.failure.code, FailureCode.PII_DETECTED);
});

test('disambiguation loop: unresolved -> candidates -> clarified -> resolved', () => {
  let m = machineAt(AgentState.DOMAIN);
  m = transition(m, {
    type: AgentEvent.DOMAIN_UNRESOLVED,
    payload: { candidates: ['urn:entity:film', 'urn:entity:tv_show'] },
  });
  assert.equal(m.state, AgentState.DISAMBIGUATION);
  assert.equal(m.context.candidates.length, 2);
  m = transition(m, { type: AgentEvent.CLARIFICATION_PROVIDED });
  assert.equal(m.state, AgentState.DOMAIN);
  assert.deepEqual(m.context.candidates, []);
});

test('trace: bounded FIFO of transition records', () => {
  // Valid full cycle: request -> intake -> cancel -> cancelled -> reset -> idle.
  let m = createMachine();
  const cycles = TRACE_LIMIT / 3 + 20;
  for (let i = 0; i < cycles; i += 1) {
    m = transition(m, { type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: `r-${i}` } });
    m = transition(m, { type: AgentEvent.CANCEL });
    m = transition(m, { type: AgentEvent.RESET });
  }
  assert.equal(m.trace.length, TRACE_LIMIT);
  const last = m.trace[m.trace.length - 1];
  assert.deepEqual(last, {
    from: AgentState.CANCELLED,
    event: AgentEvent.RESET,
    to: AgentState.IDLE,
  });
  for (const record of m.trace) {
    assert.deepEqual(Object.keys(record).sort(), ['event', 'from', 'to']);
  }
});

test('argument validation: TypeError for malformed, typed error for unknown', () => {
  assert.throws(() => transition(null, { type: AgentEvent.CANCEL }), TypeError);
  assert.throws(() => transition(createMachine(), {}), TypeError);
  assert.throws(() => transition(createMachine(), null), TypeError);
  assert.throws(
    () => transition(createMachine(), { type: 'not.a.real.event' }),
    (err) => err instanceof InvalidTransitionError && err.reason === 'undefined_pair'
  );
});

test('intent->tool map: every intent resolves to a canonical qloo_* tool', () => {
  for (const intent of Object.values(AgentIntent)) {
    const tool = INTENT_TOOL[intent];
    assert.match(tool, /^qloo_[a-z_]+$/, `tool for ${intent}`);
  }
  // Domain resolution is required exactly for the data-bearing intents.
  assert.ok(DOMAIN_INTENTS.has(AgentIntent.SEARCH));
  assert.ok(DOMAIN_INTENTS.has(AgentIntent.CROSS_CORRELATE));
  assert.ok(!DOMAIN_INTENTS.has(AgentIntent.CAPABILITIES));
  assert.ok(!DOMAIN_INTENTS.has(AgentIntent.PRIVACY_SCAN));
  assert.ok(!DOMAIN_INTENTS.has(AgentIntent.GROUP_BY_DOMAIN));
});

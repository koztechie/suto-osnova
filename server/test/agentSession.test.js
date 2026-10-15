/**
 * AgentSession tests (task 43) — proves the #private-field protection
 * model H1-H5 from the module header: no reference leakage, controlled
 * mutation path, deep-frozen egress, caller isolation on ingest, and
 * determinism carried through the facade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentSession } from '../src/engine/AgentSession.js';
import { deepFreeze } from '../src/engine/deepFreeze.js';
import { AgentState, AgentEvent, InvalidTransitionError } from '../src/engine/AgentStateMachine.js';
import { AgentPhase, PhaseEvent, InvalidPhaseError } from '../src/engine/AgentPhases.js';

/** Deterministic walk through the request machine to DELIVERED. */
function driveToDelivered(session) {
  session.dispatch({
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId: 'r-1' },
  });
  session.dispatch({ type: AgentEvent.INPUT_VALID });
  session.dispatch({
    type: AgentEvent.INTENT_CLASSIFIED,
    payload: { intent: 'capabilities' },
  });
  session.dispatch({
    type: AgentEvent.EXECUTION_SUCCEEDED,
    payload: { result: { ok: true } },
  });
  session.dispatch({
    type: AgentEvent.SYNTHESIS_READY,
    payload: { response: { text: 'dossier text' } },
  });
}

/** Deterministic walk through the dossier pipeline to COMPLETED. */
function driveToCompleted(session) {
  session.advancePhase({ type: PhaseEvent.START });
  session.advancePhase({
    type: PhaseEvent.SEED_RESOLVED,
    payload: { seed: { id: 'e-42', domain: 'urn:entity:film' } },
  });
  session.advancePhase({
    type: PhaseEvent.AFFINITIES_COLLECTED,
    payload: { affinities: [{ domain: 'urn:entity:music', affinity: 0.88 }] },
  });
  session.advancePhase({
    type: PhaseEvent.ANTITHESIS_READY,
    payload: { antithesis: { contrast: 0.01 } },
  });
  session.advancePhase({
    type: PhaseEvent.DOSSIER_READY,
    payload: { dossier: { title: 'the dossier' } },
  });
}

test('H1: internals are unreachable — no property, key, spread or symbol leaks', () => {
  const session = new AgentSession();

  // Direct / computed / bracket access to the private names.
  assert.equal(session.machine, undefined);
  assert.equal(session.pipeline, undefined);
  assert.equal(session['#machine'], undefined);
  assert.equal(session['#pipeline'], undefined);

  // Enumerations see only the public API surface.
  const ownKeys = Reflect.ownKeys(session);
  assert.deepEqual(ownKeys, []);
  assert.deepEqual(Object.keys(session), []);
  assert.deepEqual(Object.getOwnPropertyNames(session), []);
  assert.deepEqual(Object.getOwnPropertySymbols(session), []);
  assert.deepEqual({ ...session }, {}, 'spread leaks nothing');

  // A second session shares no state with the first.
  const other = new AgentSession();
  session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'a' } });
  assert.equal(session.state, AgentState.INTAKE);
  assert.equal(other.state, AgentState.IDLE);
});

test('H2: mutation only via dispatch/advancePhase; direct writes are rejected', () => {
  const session = new AgentSession();

  // Setter-less accessors: writes throw in strict (ESM) mode.
  assert.throws(() => {
    session.state = AgentState.EXECUTE;
  }, TypeError);
  assert.throws(() => {
    session.context = {};
  }, TypeError);
  assert.throws(() => {
    session.phase = AgentPhase.COMPLETED;
  }, TypeError);
  assert.throws(() => {
    session.trace = [];
  }, TypeError);
  assert.equal(session.state, AgentState.IDLE, 'state untouched by rejected writes');

  // A failed transition throws BEFORE the internal reference is replaced.
  driveToDelivered(session);
  const before = session.snapshot();
  assert.throws(
    () => session.dispatch({ type: AgentEvent.EXECUTION_SUCCEEDED }),
    InvalidTransitionError
  );
  assert.deepEqual(session.snapshot(), before, 'failed dispatch cannot corrupt state');
});

test('H3: every exposed view is deep-frozen (nested structures included)', () => {
  const session = new AgentSession();
  driveToDelivered(session);

  // Nested response object reached via context.
  assert.throws(() => {
    session.context.response.text = 'tampered';
  }, TypeError);
  assert.throws(() => {
    session.context.failure = { code: 'X' };
  }, TypeError);
  assert.throws(() => {
    session.trace.push({ from: 'x', event: 'y', to: 'z' });
  }, TypeError);

  const snap = session.snapshot();
  assert.ok(Object.isFrozen(snap));
  assert.ok(Object.isFrozen(snap.context));
  assert.ok(Object.isFrozen(snap.context.response));
  assert.ok(Object.isFrozen(snap.trace));
  assert.deepEqual(snap.context.response, { text: 'dossier text' });
  assert.equal(JSON.parse(JSON.stringify(snap)).context.response.text, 'dossier text', 'snapshot serializes');
});

test('H2+H4: dispatch drives both cores deterministically and isolates payloads', () => {
  const run = () => {
    const session = new AgentSession();
    driveToDelivered(session);
    driveToCompleted(session);
    return session.snapshot();
  };
  assert.deepEqual(run(), run(), 'H5 determinism through the facade');

  // H4: mutating the payload object AFTER dispatch changes nothing.
  const session = new AgentSession();
  const payload = { response: { text: 'original' } };
  session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-9' } });
  session.dispatch({ type: AgentEvent.INPUT_VALID });
  session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: 'capabilities' } });
  session.dispatch({ type: AgentEvent.EXECUTION_SUCCEEDED, payload: { result: { v: 1 } } });
  session.dispatch({ type: AgentEvent.SYNTHESIS_READY, payload });
  payload.response.text = 'tampered after the fact';
  payload.response.extra = 'injected';

  assert.deepEqual(session.context.response, { text: 'original' }, 'session immune to post-hoc mutation');
  assert.equal(session.context.result.v, 1);
  assert.equal(session.state, AgentState.DELIVERED);
});

test('H2: dispatch returns the frozen effects; failed steps throw typed errors', () => {
  const session = new AgentSession();
  const effects = session.dispatch({
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId: 'r-eff' },
  });
  assert.equal(effects.length, 1);
  assert.ok(Object.isFrozen(effects));
  assert.ok(Object.isFrozen(effects[0]));
  assert.equal(effects[0].type, 'effect.sanitize_input');

  // Unknown event on the machine core.
  assert.throws(() => session.dispatch({ type: 'bogus.event' }), InvalidTransitionError);
  // Unknown event on the phase core.
  assert.throws(() => session.advancePhase({ type: 'bogus.phase' }), InvalidPhaseError);
  // Malformed events.
  assert.throws(() => session.dispatch(null), TypeError);
  assert.throws(() => session.advancePhase({}), TypeError);
});

test('H4: uncloneable payloads are rejected BEFORE any state change', () => {
  const session = new AgentSession();
  const before = session.snapshot();
  assert.throws(
    () =>
      session.dispatch({
        type: AgentEvent.REQUEST_RECEIVED,
        payload: { requestId: 'r-1', hook: () => {} },
      }),
    (err) => err instanceof TypeError && /structured-cloneable/.test(err.message)
  );
  assert.deepEqual(session.snapshot(), before, 'state untouched by rejected ingest');
});

test('pipeline phaseContext views are also deep-frozen and isolated', () => {
  const session = new AgentSession();
  driveToCompleted(session);

  assert.equal(session.phase, AgentPhase.COMPLETED);
  assert.throws(() => {
    session.phaseContext.affinities.push({ domain: 'injected' });
  }, TypeError);
  assert.equal(session.phaseContext.affinities.length, 1);
  assert.deepEqual(session.phaseContext.seed, { id: 'e-42', domain: 'urn:entity:film' });
  assert.deepEqual(session.phaseContext.dossier, { title: 'the dossier' });
  assert.ok(Object.isFrozen(session.phaseTrace));

  const snap = session.snapshot();
  assert.equal(snap.phase, AgentPhase.COMPLETED);
  assert.equal(snap.state, AgentState.IDLE, 'cores evolve independently');
  assert.ok(Object.isFrozen(snap.phaseContext.affinities));
});

test('deepFreeze utility: recursive, cycle-safe, idempotent, primitive-safe', () => {
  const nested = { a: { b: { c: 1 } }, list: [{ d: 2 }] };
  const frozen = deepFreeze(nested);
  assert.equal(frozen, nested, 'returns the same reference');
  assert.ok(Object.isFrozen(nested.a.b));
  assert.ok(Object.isFrozen(nested.list[0]));
  assert.throws(() => {
    nested.a.b.c = 99;
  }, TypeError);

  // Idempotent on repeat and on already-frozen input.
  assert.equal(deepFreeze(frozen), frozen);

  // Cycles do not hang.
  const cyclic = { self: null };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => deepFreeze(cyclic));
  assert.ok(Object.isFrozen(cyclic));

  // Primitives pass through.
  assert.equal(deepFreeze(7), 7);
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze('x'), 'x');
});

// ---------------------------------------------------------------------------
// Task 44 — getExecutionSnapshot(): immutable current-step records.
// ---------------------------------------------------------------------------

test('getExecutionSnapshot: initial shape, fully deep-frozen', () => {
  const session = new AgentSession();
  const snap = session.getExecutionSnapshot();

  assert.equal(snap.step, 0);
  assert.equal(snap.lastEvent, null);
  assert.deepEqual(snap.lastEffects, []);
  assert.equal(snap.state, AgentState.IDLE);
  assert.equal(snap.phase, AgentPhase.IDLE);
  assert.deepEqual(snap.context.requestId, null);
  assert.deepEqual(snap.trace, []);
  assert.deepEqual(snap.phaseTrace, []);

  assert.ok(Object.isFrozen(snap));
  assert.ok(Object.isFrozen(snap.lastEffects));
  assert.ok(Object.isFrozen(snap.context));
  assert.ok(Object.isFrozen(snap.trace));
  assert.ok(Object.isFrozen(snap.phaseContext));
  assert.throws(() => {
    snap.context.attempts = 99;
  }, TypeError);
  assert.throws(() => {
    snap.trace.push('x');
  }, TypeError);
});

test('getExecutionSnapshot: step accounting and pure-read semantics', () => {
  const session = new AgentSession();

  // Taking a snapshot never advances the step.
  const before = session.getExecutionSnapshot();
  const again = session.getExecutionSnapshot();
  assert.deepEqual(before, again, 'pure read, identical records');
  assert.equal(again.step, 0);

  session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-1' } });
  assert.equal(session.getExecutionSnapshot().step, 1);

  session.dispatch({ type: AgentEvent.INPUT_VALID });
  session.dispatch({ type: AgentEvent.INTENT_CLASSIFIED, payload: { intent: 'capabilities' } });
  assert.equal(session.getExecutionSnapshot().step, 3);

  session.advancePhase({ type: PhaseEvent.START });
  assert.equal(session.getExecutionSnapshot().step, 4);

  // A FAILED transition throws before bookkeeping: step unchanged.
  const stepBefore = session.getExecutionSnapshot().step;
  assert.throws(() => session.dispatch({ type: AgentEvent.REQUEST_RECEIVED }), InvalidTransitionError);
  assert.equal(session.getExecutionSnapshot().step, stepBefore, 'failed dispatch does not count');
});

test('getExecutionSnapshot: lastEvent/lastEffects reflect the last successful mutation', () => {
  const session = new AgentSession();

  const effects = session.dispatch({
    type: AgentEvent.REQUEST_RECEIVED,
    payload: { requestId: 'r-snap' },
  });
  let snap = session.getExecutionSnapshot();
  assert.deepEqual(snap.lastEvent, { core: 'machine', type: AgentEvent.REQUEST_RECEIVED });
  assert.deepEqual(snap.lastEffects, effects, 'records a frozen copy of the returned effects');

  session.advancePhase({ type: PhaseEvent.START });
  snap = session.getExecutionSnapshot();
  assert.deepEqual(snap.lastEvent, { core: 'phase', type: PhaseEvent.START });
  assert.deepEqual(snap.lastEffects, [], 'phase steps emit no machine effects');
  assert.equal(snap.phase, AgentPhase.SEED_RESOLUTION);
  assert.equal(snap.state, AgentState.INTAKE, 'cores tracked independently in one record');
});

test('getExecutionSnapshot: point-in-time isolation from later mutations', () => {
  const session = new AgentSession();
  driveToDelivered(session);
  driveToCompleted(session);

  const frozenSnapshot = session.getExecutionSnapshot();
  const serialized = JSON.stringify(frozenSnapshot);

  // Further mutations of the machine core (the pipeline is COMPLETED —
  // terminal by design, no further phase steps exist).
  session.dispatch({ type: AgentEvent.RESET });
  session.dispatch({ type: AgentEvent.REQUEST_RECEIVED, payload: { requestId: 'r-after' } });

  // ...must not reach into the earlier snapshot.
  assert.equal(JSON.stringify(frozenSnapshot), serialized, 'old snapshot immutable in content');
  assert.equal(frozenSnapshot.state, AgentState.DELIVERED, 'keeps the state it was taken at');
  assert.equal(frozenSnapshot.phase, AgentPhase.COMPLETED);
  assert.equal(frozenSnapshot.step, 10);

  const now = session.getExecutionSnapshot();
  assert.equal(now.state, AgentState.INTAKE);
  assert.equal(now.phase, AgentPhase.COMPLETED, 'pipeline phase unchanged by machine steps');
  assert.equal(now.step, 12, 'current snapshot reflects the new steps');
  assert.notEqual(now.step, frozenSnapshot.step);
});

test('getExecutionSnapshot: deterministic across sessions (H5)', () => {
  const run = () => {
    const session = new AgentSession();
    driveToDelivered(session);
    driveToCompleted(session);
    return session.getExecutionSnapshot();
  };
  assert.deepEqual(run(), run(), 'identical scripts -> identical step records');
});

test('getExecutionSnapshot: nested payload objects are frozen in the record', () => {
  const session = new AgentSession();
  driveToDelivered(session);
  const snap = session.getExecutionSnapshot();

  assert.ok(Object.isFrozen(snap.context.response), 'nested response frozen');
  assert.ok(Object.isFrozen(snap.lastEffects), 'effects collection frozen');
  assert.ok(Object.isFrozen(snap.lastEvent));
  assert.throws(() => {
    snap.lastEvent.core = 'hijacked';
  }, TypeError);
  assert.throws(() => {
    snap.phaseContext.affinities.push('x');
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(snap)).context.response.text, 'dossier text', 'serializable');
});

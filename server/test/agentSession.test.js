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

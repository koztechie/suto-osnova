/**
 * AgentSession (task 43) — the agent-side facade that PROTECTS internal
 * state with native `#private` fields, so no external code can perform
 * uncontrolled mutations.
 *
 * Protection model (pinned by server/test/agentSession.test.js):
 *
 * H1. NO REFERENCE LEAKAGE: the request machine (task 41) and the
 *     dossier pipeline (task 42) live in `#private` fields — they are
 *     unreachable via property access, `Object.keys`, spread, symbols
 *     or prototypes. `session.machine` / `session['#machine']` are
 *     undefined by construction.
 * H2. CONTROLLED MUTATION PATH: the ONLY way state changes is
 *     `dispatch(event)` / `advancePhase(event)`, and both delegate to
 *     the deterministic pure cores (`transition`, `advance`). The
 *     facade adds no logic of its own — determinism D1-D5/P1-P4 carries
 *     through unchanged; a failed transition throws BEFORE the internal
 *     reference is replaced, so errors cannot corrupt state.
 * H3. READ-ONLY EGRESS: every exposed view (`state`, `context`, `trace`,
 *     `phase`, `phaseContext`, `phaseTrace`, `snapshot()`) is
 *     deep-frozen — nested structures cannot be mutated by callers.
 * H4. CALLER ISOLATION ON INGEST: event payloads are `structuredClone`d
 *     before entering the cores, so mutating a payload object AFTER
 *     dispatching it cannot alter session state retroactively (and the
 *     cores never hold references to caller-owned objects).
 * H5. THE FACADE STAYS DETERMINISTIC: no clocks, no RNG — two sessions
 *     fed the same event scripts produce identical snapshots.
 *
 * EXECUTION SNAPSHOTS (task 44): `getExecutionSnapshot()` records the
 * CURRENT step of analysis — a point-in-time, deeply Object.freeze'd
 * record of (step counter, both cores' positions and contexts, the
 * bounded traces, the last event and its effects). Snapshots are built
 * from COPIES, so a snapshot taken at step N can never diverge from
 * what the session looked like then; taking one is a pure read (it
 * never advances the step counter). Same scripts -> identical
 * snapshots (H5 carries through).
 */

import { transition, createMachine } from './AgentStateMachine.js';
import { advance, createPipeline } from './AgentPhases.js';
import { deepFreeze } from './deepFreeze.js';

export class AgentSession {
  #machine;
  #pipeline;
  #step = 0;
  #lastEvent = null;
  #lastEffects = [];

  constructor() {
    this.#machine = createMachine();
    this.#pipeline = createPipeline();
  }

  // --- read-only views (H3) ----------------------------------------------

  get state() {
    return this.#machine.state;
  }

  get context() {
    return deepFreeze(this.#machine.context);
  }

  get trace() {
    return this.#machine.trace;
  }

  get phase() {
    return this.#pipeline.phase;
  }

  get phaseContext() {
    return deepFreeze(this.#pipeline.context);
  }

  get phaseTrace() {
    return this.#pipeline.trace;
  }

  /** Deep-frozen aggregate view of the whole session (audit/serialization). */
  snapshot() {
    return deepFreeze({
      state: this.#machine.state,
      context: this.#machine.context,
      trace: this.#machine.trace,
      phase: this.#pipeline.phase,
      phaseContext: this.#pipeline.context,
      phaseTrace: this.#pipeline.trace,
    });
  }

  // --- controlled mutation path (H2) -------------------------------------

  /**
   * Advance the REQUEST machine (task 41). Returns the frozen effects
   * the executor must perform ([] when the step emits none). A failed
   * transition throws BEFORE any step bookkeeping changes.
   */
  dispatch(event) {
    const isolated = this.#isolatedEvent(event);
    const next = transition(this.#machine, isolated);
    this.#machine = next;
    this.#step += 1;
    this.#lastEvent = Object.freeze({ core: 'machine', type: isolated.type });
    this.#lastEffects = next.effects ?? [];
    return this.#lastEffects;
  }

  /**
   * Advance the DOSSIER pipeline (task 42). Returns the new phase.
   */
  advancePhase(event) {
    const isolated = this.#isolatedEvent(event);
    this.#pipeline = advance(this.#pipeline, isolated);
    this.#step += 1;
    this.#lastEvent = Object.freeze({ core: 'phase', type: isolated.type });
    this.#lastEffects = [];
    return this.#pipeline.phase;
  }

  // --- execution snapshots (task 44) --------------------------------------

  /**
   * Immutable point-in-time record of the CURRENT analysis step:
   * `{ step, lastEvent, lastEffects, state, context, trace, phase,
   *   phaseContext, phaseTrace }` — every level Object.freeze'd via
   * deepFreeze, built from copies so later mutations can never reach
   * into an earlier snapshot. Pure read: taking one does not advance
   * the step.
   */
  getExecutionSnapshot() {
    return deepFreeze({
      step: this.#step,
      lastEvent: this.#lastEvent ? { ...this.#lastEvent } : null,
      lastEffects: [...this.#lastEffects],
      state: this.#machine.state,
      context: { ...this.#machine.context },
      trace: [...this.#machine.trace],
      phase: this.#pipeline.phase,
      phaseContext: { ...this.#pipeline.context },
      phaseTrace: [...this.#pipeline.trace],
    });
  }

  // --- internals ----------------------------------------------------------

  /**
   * H4: clone the payload so caller-owned objects never back session
   * state. Malformed events pass through untouched — the cores raise
   * their own TypeError; uncloneable payloads (functions, symbols) are
   * rejected with a clear TypeError BEFORE any state change.
   */
  #isolatedEvent(event) {
    if (!event || typeof event.type !== 'string') {
      return event;
    }
    if (event.payload === undefined) {
      return { type: event.type };
    }
    try {
      return { type: event.type, payload: structuredClone(event.payload) };
    } catch {
      throw new TypeError(
        'AgentSession: event.payload must be structured-cloneable plain data'
      );
    }
  }
}

export default AgentSession;

/**
 * AgentPhases tests (task 42) — pins the six mandated phases, the linear
 * ladder (P1-P4), terminal semantics, and the cross-module tool
 * consistency with the task-41 intent map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from '../src/engine/AgentPhases.js';

import { INTENT_TOOL } from '../src/engine/AgentStateMachine.js';

const ev = (type, payload = {}) => ({ type, payload });

test('exactly the six mandated phases, in canonical order', () => {
  assert.deepEqual(Object.values(AgentPhase), [
    'IDLE',
    'SEED_RESOLUTION',
    'AFFINITY_EXPANSION',
    'ANTITHESIS_GENERATION',
    'DOSSIER_SYNTHESIS',
    'COMPLETED',
  ]);
  assert.equal(Object.keys(AgentPhase).length, 6, 'exactly six phases');
  assert.equal(PHASE_ORDER[0], AgentPhase.IDLE);
  assert.equal(PHASE_ORDER[5], AgentPhase.COMPLETED);
  assert.equal(PHASE_ORDER.length, 6);
  assert.ok(Object.isFrozen(AgentPhase));
  assert.ok(Object.isFrozen(PHASE_ORDER));
  assert.ok(Object.isFrozen(PHASE_TRANSITIONS));
  assert.ok(isTerminalPhase(AgentPhase.COMPLETED));
  assert.ok(!isTerminalPhase(AgentPhase.IDLE));
  assert.ok(!isTerminalPhase(AgentPhase.DOSSIER_SYNTHESIS));
});

test('createPipeline starts in IDLE with empty accumulators, frozen', () => {
  const p = createPipeline();
  assert.equal(p.phase, AgentPhase.IDLE);
  assert.deepEqual(p.context.seed, null);
  assert.deepEqual(p.context.affinities, []);
  assert.equal(p.context.dossier, null);
  assert.deepEqual(p.trace, []);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.context));
  assert.ok(Object.isFrozen(p.trace));
});

test('golden path: full dossier run accumulates stage results', () => {
  let p = createPipeline();
  const phases = [p.phase];

  p = advance(p, ev(PhaseEvent.START));
  phases.push(p.phase);
  assert.equal(phaseTool(p.phase), 'qloo_resolve_entity');

  p = advance(p, ev(PhaseEvent.SEED_RESOLVED, { seed: { id: 'e-1', domain: 'urn:entity:film' } }));
  phases.push(p.phase);
  assert.equal(phaseTool(p.phase), 'qloo_get_cross_domain_affinities');

  p = advance(
    p,
    ev(PhaseEvent.AFFINITIES_COLLECTED, {
      affinities: [
        { domain: 'urn:entity:music', affinity: 0.91 },
        { domain: 'urn:entity:place', affinity: 0.74 },
      ],
    })
  );
  phases.push(p.phase);
  assert.equal(phaseTool(p.phase), 'qloo_taste_antithesis');
  assert.equal(p.context.affinities.length, 2);
  assert.ok(Object.isFrozen(p.context.affinities), 'accumulators frozen');

  p = advance(p, ev(PhaseEvent.ANTITHESIS_READY, { antithesis: { contrast: 0.01 } }));
  phases.push(p.phase);
  assert.equal(phaseTool(p.phase), null, 'synthesis is local');
  assert.deepEqual(p.context.seed, { id: 'e-1', domain: 'urn:entity:film' });
  assert.deepEqual(p.context.antithesis, { contrast: 0.01 });

  p = advance(p, ev(PhaseEvent.DOSSIER_READY, { dossier: { title: 'dossier#1' } }));
  phases.push(p.phase);

  assert.deepEqual(phases, [...PHASE_ORDER]);
  assert.equal(p.phase, AgentPhase.COMPLETED);
  assert.deepEqual(p.context.dossier, { title: 'dossier#1' });
  assert.equal(p.context.failure, null);
});

test('P2 total matrix: every (phase, event) pair is defined or throws', () => {
  const defined = {
    'IDLE|start': AgentPhase.SEED_RESOLUTION,
    'SEED_RESOLUTION|seed.resolved': AgentPhase.AFFINITY_EXPANSION,
    'SEED_RESOLUTION|fail': AgentPhase.IDLE,
    'AFFINITY_EXPANSION|affinities.collected': AgentPhase.ANTITHESIS_GENERATION,
    'AFFINITY_EXPANSION|fail': AgentPhase.IDLE,
    'ANTITHESIS_GENERATION|antithesis.ready': AgentPhase.DOSSIER_SYNTHESIS,
    'ANTITHESIS_GENERATION|fail': AgentPhase.IDLE,
    'DOSSIER_SYNTHESIS|dossier.ready': AgentPhase.COMPLETED,
    'DOSSIER_SYNTHESIS|fail': AgentPhase.IDLE,
  };

  const eventTypes = Object.values(PhaseEvent);
  let definedCount = 0;
  let rejected = 0;

  for (const phase of Object.values(AgentPhase)) {
    for (const type of eventTypes) {
      const key = `${phase}|${type}`;
      const pipeline = { phase, context: { ...createPipeline().context }, trace: [] };
      assert.equal(canAdvance(phase, type), Boolean(defined[key]), `canAdvance ${key}`);
      if (defined[key]) {
        const next = advance(pipeline, ev(type, { seed: {}, affinities: [], antithesis: {}, dossier: {} }));
        assert.equal(next.phase, defined[key], `target ${key}`);
        definedCount += 1;
      } else {
        assert.throws(
          () => advance(pipeline, ev(type)),
          (err) =>
            err instanceof InvalidPhaseError &&
            err.reason === 'undefined_pair' &&
            err.phase === phase &&
            err.event === type,
          `throws ${key}`
        );
        rejected += 1;
      }
    }
  }
  // 6 phases x 6 events = 36 pairs, exhaustively classified.
  assert.equal(definedCount + rejected, 36);
  assert.equal(definedCount, 9);
  assert.equal(rejected, 27);
});

test('P3 linearity: every forward step advances exactly one position', () => {
  for (const [phase, steps] of Object.entries(PHASE_TRANSITIONS)) {
    for (const [type, target] of Object.entries(steps)) {
      if (target === AgentPhase.IDLE && type === PhaseEvent.FAIL) continue; // the only backward step
      assert.equal(
        PHASE_ORDER.indexOf(target),
        PHASE_ORDER.indexOf(phase) + 1,
        `${phase} --${type}--> ${target} must be strictly +1`
      );
    }
  }
});

test('P1 determinism: identical event scripts yield identical pipelines', () => {
  const script = [
    ev(PhaseEvent.START),
    ev(PhaseEvent.SEED_RESOLVED, { seed: { id: 'x' } }),
    ev(PhaseEvent.AFFINITIES_COLLECTED, { affinities: [{ domain: 'a' }] }),
    ev(PhaseEvent.ANTITHESIS_READY, { antithesis: { contrast: 0.2 } }),
    ev(PhaseEvent.DOSSIER_READY, { dossier: { text: 'ok' } }),
  ];
  const run = () => {
    let p = createPipeline();
    for (const e of script) p = advance(p, e);
    return { phase: p.phase, context: p.context, trace: p.trace };
  };
  assert.deepEqual(run(), run());
});

test('fail path: every active phase falls back to IDLE keeping diagnostics', () => {
  const contexts = {
    SEED_RESOLUTION: {},
    AFFINITY_EXPANSION: { seed: { id: 'e-9' } },
    ANTITHESIS_GENERATION: { seed: { id: 'e-9' }, affinities: [{ domain: 'a' }] },
    DOSSIER_SYNTHESIS: { antithesis: { contrast: 0.5 } },
  };
  for (const phase of ACTIVE_PHASES) {
    const p = advance(
      { phase, context: { ...createPipeline().context, ...contexts[phase] }, trace: [] },
      ev(PhaseEvent.FAIL, { code: 'UPSTREAM_ERROR', message: 'qloo 500' })
    );
    assert.equal(p.phase, AgentPhase.IDLE, `fail from ${phase}`);
    assert.equal(p.context.failure.code, 'UPSTREAM_ERROR');
    assert.equal(p.context.failure.message, 'qloo 500');
    assert.deepEqual(p.context.seed ?? null, contexts[phase].seed ?? null, 'partial work kept');
  }
  // IDLE and COMPLETED reject fail: nothing to abort / nothing to undo.
  for (const phase of [AgentPhase.IDLE, AgentPhase.COMPLETED]) {
    assert.throws(
      () => advance({ phase, context: createPipeline().context, trace: [] }, ev(PhaseEvent.FAIL)),
      InvalidPhaseError
    );
  }
});

test('terminal COMPLETED accepts no further events; START only from IDLE', () => {
  for (const type of Object.values(PhaseEvent)) {
    assert.throws(
      () => advance({ phase: AgentPhase.COMPLETED, context: createPipeline().context, trace: [] }, ev(type)),
      (err) => err instanceof InvalidPhaseError && err.phase === AgentPhase.COMPLETED,
      `COMPLETED rejects ${type}`
    );
  }
  for (const phase of Object.values(AgentPhase)) {
    if (phase === AgentPhase.IDLE) continue;
    assert.throws(
      () => advance({ phase, context: createPipeline().context, trace: [] }, ev(PhaseEvent.START)),
      InvalidPhaseError,
      `START rejected from ${phase}`
    );
  }
});

test('P4 immutability: previous pipeline untouched, results frozen', () => {
  const before = createPipeline();
  const snapshot = JSON.stringify(before);
  const next = advance(before, ev(PhaseEvent.START));
  assert.equal(JSON.stringify(before), snapshot, 'input unchanged');
  assert.notEqual(next, before);
  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.context));
  assert.ok(Object.isFrozen(next.trace));
  assert.equal(before.phase, AgentPhase.IDLE);
});

test('trace: bounded FIFO of deterministic records', () => {
  let p = createPipeline();
  const cycle = [
    ev(PhaseEvent.START),
    ev(PhaseEvent.FAIL, { code: 'X' }),
  ];
  const rounds = TRACE_LIMIT / 2 + 10;
  for (let i = 0; i < rounds; i += 1) {
    for (const e of cycle) p = advance(p, e);
  }
  assert.equal(p.trace.length, TRACE_LIMIT);
  const last = p.trace[p.trace.length - 1];
  assert.deepEqual(last, {
    from: AgentPhase.SEED_RESOLUTION,
    event: PhaseEvent.FAIL,
    to: AgentPhase.IDLE,
  });
});

test('cross-module consistency: phase tools are canonical task-41 qloo_* tools', () => {
  const canonical = new Set(Object.values(INTENT_TOOL));
  for (const [phase, tool] of Object.entries(PHASE_TOOL)) {
    if (tool === null) continue;
    assert.match(tool, /^qloo_[a-z_]+$/, `tool for ${phase}`);
    assert.ok(canonical.has(tool), `${tool} must exist in the task-41 intent map`);
  }
  assert.equal(phaseTool('no_such_phase'), null);
});

test('argument validation: TypeError for malformed, typed error for unknown', () => {
  assert.throws(() => advance(null, ev(PhaseEvent.START)), TypeError);
  assert.throws(() => advance(createPipeline(), {}), TypeError);
  assert.throws(() => advance(createPipeline(), null), TypeError);
  assert.throws(
    () => advance(createPipeline(), { type: 'not.a.phase.event' }),
    (err) => err instanceof InvalidPhaseError && err.reason === 'undefined_pair'
  );
});

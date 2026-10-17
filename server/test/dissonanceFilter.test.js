/**
 * DissonanceFilter gate (task 96) — filtering of antipodes:
 *   - the encounter axis (task-57 popularity tiers -> broad/obscure/
 *     unmeasured) and the evidence axis (proven/zero/weak);
 *   - the full decision matrix (proven kept regardless; zero needs
 *     broad encounter; weak needs broad + keepMinimal);
 *   - the three machine-readable noise reasons;
 *   - options: minEncounterTier strictness, keepMinimal;
 *   - the AntithesisMode integration (matrix from CONSCIOUS records
 *     only; the cut ledger rides the block; the render NOISE CUT
 *     line);
 *   - determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'dissonance-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  filterConsciousDissonance, classifyDissonance, encounterOf,
  DISSONANCE_CLASSES, DISSONANCE_REASONS, ENCOUNTER_TIERS,
} = await import('../src/engine/DissonanceFilter.js');
const { invertTasteVector } = await import('../src/engine/TasteInverter.js');
const {
  buildAntithesisBlock, renderAntithesisReport, runAntithesis,
} = await import('../src/modes/AntithesisMode.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

test('encounter axis: popularity tiers map to broad/obscure/unmeasured', () => {
  assert.equal(encounterOf({ popularity: 0.9 }).level, 'broad', 'mainstream is broad');
  assert.equal(encounterOf({ popularity: 0.05 }).level, 'obscure',
    'midstream (task-57 U in [0.15,0.35)) is below the mainstream bar');
  assert.equal(encounterOf({ popularity: 0.01 }).level, 'obscure');
  assert.equal(encounterOf({ popularity: null }).level, 'unmeasured');
  assert.equal(encounterOf({}).level, 'unmeasured', 'absent popularity is unproven');
  assert.equal(encounterOf({ popularity: 0.9 }).tier, 'mainstream');
  // Loosening the bar widens the net.
  assert.equal(encounterOf({ popularity: 0.05 }, { minEncounterTier: 'midstream' }).level,
    'broad');
});

test('the decision matrix: every evidence x encounter cell', () => {
  const cases = [
    // [record, expectedClass, expectedReason]
    [{ negativeCorrelation: true, popularity: 0.9 }, DISSONANCE_CLASSES.PROVEN, null],
    [{ negativeCorrelation: true, popularity: 0.01 }, DISSONANCE_CLASSES.PROVEN, null,
      'the API assertion stands even on an obscure entity'],
    [{ negativeCorrelation: true, popularity: null }, DISSONANCE_CLASSES.PROVEN, null],
    [{ zeroAffinity: true, popularity: 0.9 }, DISSONANCE_CLASSES.MEASURED, null],
    [{ zeroAffinity: true, popularity: 0.01 }, null, DISSONANCE_REASONS.OBSCURE_UNPROVEN],
    [{ zeroAffinity: true, popularity: null }, null, DISSONANCE_REASONS.UNMEASURED_ENCOUNTER],
    [{ zeroAffinity: false, popularity: 0.9 }, DISSONANCE_CLASSES.MINIMAL, null],
    [{ zeroAffinity: false, popularity: 0.01 }, null, DISSONANCE_REASONS.OBSCURE_UNPROVEN],
    [{ zeroAffinity: false, popularity: null }, null, DISSONANCE_REASONS.UNMEASURED_ENCOUNTER],
  ];
  for (const [record, klass, reason] of cases) {
    const verdict = classifyDissonance(record);
    assert.equal(verdict.dissonanceClass, klass ?? null,
      `${JSON.stringify(record)} class`);
    assert.equal(verdict.reason, reason ?? null, `${JSON.stringify(record)} reason`);
  }
});

test('options: keepMinimal and the minEncounterTier strictness', () => {
  const weakBroad = { zeroAffinity: false, popularity: 0.9 };
  const strict = classifyDissonance(weakBroad, { keepMinimal: false });
  assert.equal(strict.dissonanceClass, null);
  assert.equal(strict.reason, DISSONANCE_REASONS.WEAK_CORRELATION,
    'strict briefs cut the weak-correlation class');

  // A midstream popularity is cut by the default mainstream bar but
  // kept when the bar is loosened to midstream.
  const midstream = { zeroAffinity: true, popularity: 0.1 };
  assert.equal(classifyDissonance(midstream).dissonanceClass, null,
    'default minEncounterTier = mainstream cuts midstream');
  assert.equal(classifyDissonance(midstream).reason, DISSONANCE_REASONS.OBSCURE_UNPROVEN);
  assert.equal(classifyDissonance(midstream, { minEncounterTier: 'midstream' }).dissonanceClass,
    DISSONANCE_CLASSES.MEASURED, 'loosening to midstream keeps it');

  assert.deepEqual([...ENCOUNTER_TIERS], ['microtail', 'long_tail', 'midstream', 'mainstream']);
  for (const bad of [{ minEncounterTier: 'bogus' }, { keepMinimal: 'yes' }]) {
    assert.throws(() => classifyDissonance({}, bad), TypeError, JSON.stringify(bad));
    assert.throws(() => filterConsciousDissonance([], bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => classifyDissonance(null), TypeError);
  assert.throws(() => filterConsciousDissonance(null), TypeError);
});

test('the filter: keeps conscious records, ledgers the noise', () => {
  const inverted = invertTasteVector([
    { id: '1', name: 'Proven Opposed', correlation: -0.5, popularity: 0.8 },
    { id: '2', name: 'Measured Zero', affinity: 0, popularity: 0.9 },
    { id: '3', name: 'Minimal Known', affinity: 0.05, popularity: 0.7 },
    { id: '4', name: 'Obscure Zero', affinity: 0, popularity: 0.001 },
    { id: '5', name: 'No Popularity', affinity: 0.02 },
  ]);
  const result = filterConsciousDissonance(inverted.records);

  // Input (divergence) order is preserved: Measured Zero (1.0),
  // Minimal Known (0.95), Proven Opposed (0.75 signed).
  assert.deepEqual(result.kept.map((r) => r.name),
    ['Measured Zero', 'Minimal Known', 'Proven Opposed']);
  assert.deepEqual(result.kept.map((r) => r.dissonanceClass),
    [DISSONANCE_CLASSES.MEASURED, DISSONANCE_CLASSES.MINIMAL, DISSONANCE_CLASSES.PROVEN]);
  assert.equal(result.kept[2].encounter, 'broad');

  assert.deepEqual(result.cut.map((c) => [c.name, c.reason]), [
    ['Obscure Zero', DISSONANCE_REASONS.OBSCURE_UNPROVEN],
    ['No Popularity', DISSONANCE_REASONS.UNMEASURED_ENCOUNTER],
  ], 'every cut is ledgered with its reason — nothing dropped silently');

  assert.deepEqual({ ...result.stats }, {
    input: 5, kept: 3, cut: 2,
    classes: { proven_dissonance: 1, measured_dissonance: 1, minimal_correlation: 1 },
    reasons: { unmeasured_encounter: 1, obscure_unproven: 1, weak_correlation: 0 },
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.kept[0]));
  assert.ok(Object.isFrozen(result.cut[0]));
});

test('determinism and zero-emoji purity', () => {
  const pool = invertTasteVector([
    { id: '1', name: 'A', correlation: -0.5, popularity: 0.8 },
    { id: '2', name: 'B', affinity: 0, popularity: 0.9 },
  ]).records;
  const a = filterConsciousDissonance(pool);
  const b = filterConsciousDissonance(pool);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test('mode integration: the matrix runs on CONSCIOUS records, cut ledgers', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: [
      { id: 'm1', name: 'Proven Opposed', domain: 'music', correlation: -0.5, popularity: 0.8 },
      { id: 'm2', name: 'Measured Zero', domain: 'music', affinity: 0, popularity: 0.9 },
      { id: 'm3', name: 'Minimal Known', domain: 'music', affinity: 0.05, popularity: 0.7 },
      { id: 'm4', name: 'Obscure Zero', domain: 'music', affinity: 0, popularity: 0.001 },
      { id: 'm5', name: 'No Popularity', domain: 'music', affinity: 0.02 },
    ],
    domains: ['music'],
    perDomain: 10,
    conflictLimit: 10,
  });

  assert.deepEqual(block.matrix[0].entries.map((e) => e.name),
    ['Measured Zero', 'Minimal Known', 'Proven Opposed'],
    'the noise rows never reach the matrix; divergence order is kept');
  assert.deepEqual(block.dissonance.cut.map((c) => c.name),
    ['Obscure Zero', 'No Popularity']);
  assert.equal(block.stats.noiseCut, 2);
  assert.equal(block.stats.selected, 3);
  assert.equal(block.dissonance.minEncounterTier, 'mainstream');
  assert.equal(block.dissonance.keepMinimal, true);
  assert.equal(block.matrix[0].entries[0].dissonanceClass, DISSONANCE_CLASSES.MEASURED);
  assert.equal(block.matrix[0].entries[0].encounter, 'broad');
  assert.equal(block.matrix[0].entries[2].dissonanceClass, DISSONANCE_CLASSES.PROVEN);

  // keepMinimal: false concentrates on proven + measured only.
  const strict = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: [
      { id: 'm1', name: 'Proven Opposed', domain: 'music', correlation: -0.5, popularity: 0.8 },
      { id: 'm3', name: 'Minimal Known', domain: 'music', affinity: 0.05, popularity: 0.7 },
    ],
    domains: ['music'],
    perDomain: 10,
    conflictLimit: 10,
    keepMinimal: false,
  });
  assert.deepEqual(strict.matrix[0].entries.map((e) => e.name), ['Proven Opposed']);
  assert.equal(strict.stats.noiseCut, 1);
  assert.equal(strict.dissonance.reasons[DISSONANCE_REASONS.WEAK_CORRELATION], 1);

  const document = renderAntithesisReport(block);
  assert.match(document, /^NOISE CUT \(2\): Obscure Zero \[obscure unproven\], No Popularity \[unmeasured encounter\]$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  for (const bad of [{ keepMinimal: 'x' }, { minEncounterTier: 'bogus' }]) {
    assert.throws(() => buildAntithesisBlock({
      anchor: { name: 'X' }, candidates: [], domains: [], ...bad,
    }), TypeError, JSON.stringify(bad));
  }
});

test('real run: filter options honored, bundle stays terminal', async () => {
  const options = () => ({
    affinityFn: affinityStub,
    search: searchStub,
    tagsFn: tagsStub,
    synthesis: false,
  });

  const bundle = await runAntithesis('Static Ash Live', options());
  assert.ok(bundle.antithesis.dissonance !== null, 'the filter rides the block');
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.ok(bundle.stats.noiseCut >= 0);
  assert.ok(bundle.stats.selected <= bundle.stats.measurable,
    'selected is capped by perDomain, so it never exceeds the measurable pool');
  assert.ok(bundle.stats.noiseCut <= bundle.stats.measurable,
    'the noise cut is a subset of the measurable pool');

  const strict = await runAntithesis('Static Ash Live', {
    ...options(), keepMinimal: false, minEncounterTier: 'mainstream',
  });
  assert.ok(strict.antithesis.dissonance.keepMinimal === false);

  await assert.rejects(
    () => runAntithesis('Static Ash Live', { ...options(), keepMinimal: 'x' }),
    TypeError
  );
  await assert.rejects(
    () => runAntithesis('Static Ash Live', { ...options(), minEncounterTier: 'bogus' }),
    TypeError
  );
});

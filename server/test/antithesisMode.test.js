/**
 * AntithesisMode gate (task 94) — MODE 3: The Taste Antithesis
 * Engine:
 *   - the INVERTED selection math (buildAntithesisBlock, exported
 *     and pure): divergence ordering, zero_affinity tiering, the
 *     measurable-only discipline, the per-domain blindspot matrix,
 *     conflict drivers, sponsorship risks;
 *   - the real runAntithesis over injected clients (plan honored:
 *     thresholds null, lowest_correlation strategy, five-domain
 *     matrix, session lifecycle);
 *   - honest emptiness (nothing measurable -> stated, not faked);
 *   - the render contract, determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'antithesis-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildAntithesisBlock, runAntithesis, renderAntithesisReport,
  ANTITHESIS_TIERS,
} = await import('../src/modes/AntithesisMode.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const row = (id, name, domain, extra = {}) => ({ id, name, domain, ...extra });

const candidates = () => [
  row('m1', 'Static Ash Live', 'music', { affinity: 0.98, popularity: 0.9 }),
  row('m2', 'Zzz Corrupt', 'music', { affinity: 0.02, popularity: 0.99 }),
  row('m3', 'Rust Choir', 'music', { affinity: 0.4, popularity: 0.2 }),
  row('f1', 'Null Correlate', 'film', { affinity: 0, popularity: 0.5 }),
  row('f2', 'Faint Signal', 'film', { affinity: 0.15, popularity: 0.5 }),
  row('b1', 'No Score Book', 'books', { popularity: 0.3 }), // no affinity field
  row('d1', 'Tie A', 'dining', { affinity: 0.25, popularity: 0.1 }),
  row('d2', 'Tie B', 'dining', { affinity: 0.25, popularity: 0.1 }),
];

test('inverted selection: divergence ordering, tiers, measurable-only', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: candidates(),
    domains: ['music', 'film', 'books', 'dining', 'fashion'],
    perDomain: 2,
    conflictLimit: 4,
  });

  // The inverted order: WEAKEST correlation first, popularity then
  // name as tiebreaks; the high-affinity anchor-adjacent row (0.98)
  // sinks to the bottom. The dining pair (popularity 0.1 = midstream)
  // is NOISE-CUT by the task-96 default mainstream encounter bar.
  const flat = block.matrix.flatMap((z) => z.entries.map((e) => e.name));
  assert.deepEqual(flat, [
    'Zzz Corrupt', 'Rust Choir',            // music: 0.02 then 0.4
    'Null Correlate', 'Faint Signal',       // film: 0 then 0.15
  ], 'per-domain inversion, popularity/name tiebreaks, cap perDomain=2');
  assert.ok(!flat.includes('Static Ash Live'), 'the anchor-adjacent row is not blindspot');
  assert.ok(!flat.includes('No Score Book'), 'unmeasurable rows are never placed');
  assert.deepEqual(block.dissonance.cut.map((c) => c.name), ['Tie A', 'Tie B'],
    'the midstream-popularity pair is ledgered as noise, not silently dropped');

  const music = block.matrix.find((z) => z.domain === 'music');
  assert.equal(music.entries[0].tier, ANTITHESIS_TIERS.LOWEST_CORRELATION);
  assert.equal(music.entries[0].divergencePercent, 98);
  assert.equal(music.entries[0].affinityPercent, 2);

  const film = block.matrix.find((z) => z.domain === 'film');
  assert.equal(film.entries[0].tier, ANTITHESIS_TIERS.ZERO_AFFINITY,
    'an explicit 0 correlation is its own tier');

  // Empty domain stays visible with count 0 (books, dining after the
  // noise cut, fashion), unmeasurable counted honestly.
  assert.deepEqual(block.matrix.map((z) => [z.domain, t_count(z)]),
    [['music', 2], ['film', 2], ['books', 0], ['dining', 0], ['fashion', 0]]);
  assert.equal(block.stats.candidates, 8);
  assert.equal(block.stats.measurable, 7);
  assert.equal(block.stats.unmeasurable, 1);
  assert.equal(block.stats.zeroAffinity, 1);
  assert.equal(block.stats.domainsCovered, 2);
  assert.equal(block.stats.noiseCut, 2);
  assert.equal(block.strategy, 'lowest_correlation');
  assert.equal(block.thresholds, null, 'the plan honest null: nothing accepted on affinity');
});

const t_count = (zone) => zone.count;

test('conflict drivers and sponsorship risks', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: candidates(),
    domains: ['music', 'film', 'books', 'dining', 'fashion'],
    perDomain: 2,
    conflictLimit: 3,
  });

  assert.deepEqual(block.conflictDrivers.map((e) => e.name),
    ['Null Correlate', 'Zzz Corrupt', 'Faint Signal'],
    'strongest divergences across domains, popularity tiebreak on equal affinity');

  // The mainstream band of the task-57 normalized coefficient
  // (minProbability 1e-6, maxBits ~19.93) sits at popularity >=
  // ~0.126 — the deliberately generous review flag: 0.99 / 0.5 /
  // 0.5 / 0.2 land, 0.1 stays midstream.
  const risk = block.sponsorshipRisks.map((e) => e.name);
  assert.deepEqual(risk,
    ['Zzz Corrupt', 'Rust Choir', 'Null Correlate', 'Faint Signal'],
    'matrix order: music picks, then film picks');
  assert.equal(block.stats.mainstreamRisks, 4);
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.matrix[0].entries[0]));
});

test('honest emptiness: nothing measurable -> stated, not faked', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: [row('b1', 'No Score', 'books', { popularity: 0.3 })],
    domains: ['music', 'film'],
  });
  assert.equal(block.stats.measurable, 0);
  assert.deepEqual(block.conflictDrivers, []);
  assert.match(block.summary, /No measurable blindspot evidence/);
  assert.match(renderAntithesisReport(block), /No measurable blindspot evidence/);
});

test('bounds: perDomain / conflictLimit / ingress contract', () => {
  for (const bad of [{ perDomain: 0 }, { perDomain: 21 }, { conflictLimit: 0 },
    { conflictLimit: 51 }]) {
    assert.throws(() => buildAntithesisBlock({
      anchor: { name: 'X' }, candidates: [], domains: [], ...bad,
    }), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => buildAntithesisBlock({ candidates: [], domains: [] }), TypeError);
  assert.throws(() => buildAntithesisBlock(null), TypeError);
  assert.throws(() => renderAntithesisReport({}), TypeError);
});

test('real run: plan honored, matrix over five domains, session terminal', async () => {
  const options = () => ({
    affinityFn: affinityStub,
    search: searchStub,
    tagsFn: tagsStub,
    synthesis: false,
  });

  const bundle = await runAntithesis('Static Ash Live', options());
  assert.equal(bundle.mode, 'antithesis');
  assert.equal(bundle.output, 'cultural_blindspot_report');
  assert.equal(bundle.selection.strategy, 'lowest_correlation');
  assert.equal(bundle.selection.thresholds, null,
    'the run plan honest null rides the bundle');
  assert.equal(bundle.antithesis.matrix.length, 5, 'all five blindspot domains');
  assert.ok(bundle.stats.measurable > 0);
  assert.equal(
    bundle.stats.measurable + bundle.selection.unmeasurable, bundle.stats.candidates,
    'every candidate is measurable or honestly counted'
  );
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.deepEqual(bundle.synthesis.failure.code, 'synthesis_disabled');
  assert.ok(bundle.session.execution !== null, 'auditable execution snapshot');

  const off = await runAntithesis('Static Ash Live', { ...options(), perDomain: 1 });
  for (const zone of off.antithesis.matrix) {
    assert.ok(zone.count <= 1, 'perDomain honored');
  }
});

test('render contract, determinism, zero emojis', () => {
  const block = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: candidates(),
    domains: ['music', 'film', 'books', 'dining', 'fashion'],
    perDomain: 2,
    conflictLimit: 3,
  });
  const document = renderAntithesisReport(block);
  assert.match(document, /^CULTURAL BLINDSPOT REPORT — Static Ash Live \(music\)$/m);
  assert.match(document, /^ {3}\[music\] 2 blindspot pick\(s\)$/m);
  assert.match(document, /^ {6}- Zzz Corrupt — 98% divergence \(lowest correlation, sponsorship risk\)$/m);
  assert.match(document, /^ {6}- Null Correlate — 100% divergence \(zero affinity, sponsorship risk\)$/m);
  assert.match(document, /^CONFLICT DRIVERS: Null Correlate, Zzz Corrupt, Faint Signal$/m);
  assert.match(document,
    /^SPONSORSHIP RISKS: Zzz Corrupt, Rust Choir, Null Correlate, Faint Signal$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  const a = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: candidates(), domains: ['music', 'film'], perDomain: 2, conflictLimit: 3,
  });
  const b = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'music' },
    candidates: candidates(), domains: ['music', 'film'], perDomain: 2, conflictLimit: 3,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderAntithesisReport(a), renderAntithesisReport(b));
});

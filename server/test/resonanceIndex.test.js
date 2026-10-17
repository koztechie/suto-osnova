/**
 * ResonanceIndex gate (task 93) — the EVENT RESONANCE INDEX
 * (0-100%):
 *   - the seven signals with PINNED SCORE MATH over the exported
 *     RESONANCE_WEIGHTS;
 *   - the renormalized-weighting discipline (a failed leg is
 *     renormalized OUT, never scored as zero; evidenceCoverage
 *     reports the weighting actually backed by evidence; nothing
 *     measurable -> an honestly null score);
 *   - weight overrides and the TypeError matrix;
 *   - the real runExperiential integration (bundle.resonance, the
 *     disable flag);
 *   - rendering, determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'resonance-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  computeResonance, renderResonance, RESONANCE_WEIGHTS, RESONANCE_REASONS,
} = await import('../src/modes/ResonanceIndex.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { affinityStub, searchStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const pieces = () => ({
  audience: { available: true, count: 8, top: [] },
  curation: {
    openingActs: [
      { name: 'A', affinityPercent: 90, evidence: 'dual' },
      { name: 'B', affinityPercent: 70, evidence: 'confirmed_affinity' },
    ],
    sponsors: [{ name: 'C', affinityPercent: 80, evidence: 'dual' }],
    vendors: [{ name: 'D', affinityPercent: null, evidence: 'confirmed_affinity' }],
  },
  chain: { candidates: 40, ranked: 24 },
  expansion: { ok: 3, failed: 0 },
  coverage: { sound: true, material: true, gastronomy: false },
  ranked: [
    { uniqueness: { coefficient: 0.8 } },
    { uniqueness: { coefficient: 0.4 } },
    { uniqueness: { coefficient: null } },
  ],
});

test('pinned score math: seven signals over the exported weights', () => {
  assert.deepEqual(Object.keys(RESONANCE_WEIGHTS),
    ['audience', 'dual_evidence', 'affinity', 'chain_survival',
      'domain_coverage', 'layer_coverage', 'uniqueness']);
  assert.equal(Math.round(Object.values(RESONANCE_WEIGHTS)
    .reduce((sum, w) => sum + w, 0) * 1e12) / 1e12, 1, 'weights sum to 1.0');

  const block = computeResonance(pieces());

  const values = Object.fromEntries(block.components.map((c) => [c.key, c.value]));
  assert.equal(values.audience, 1, 'delivered rows -> full signal');
  assert.equal(values.dual_evidence, 0.5, '2 dual of 4 picks');
  assert.equal(values.affinity, 0.8, 'mean(0.9, 0.7, 0.8) — nulls excluded');
  assert.equal(values.chain_survival, 0.6, '24 of 40 candidates');
  assert.equal(values.domain_coverage, 1, '3 of 3 domains');
  assert.ok(Math.abs(values.layer_coverage - 2 / 3) < 1e-10, '2 of 3 legs');
  assert.equal(values.uniqueness, 0.6, 'mean(0.8, 0.4) — null unmeasured');

  const expected = 0.25 * 1 + 0.2 * 0.5 + 0.2 * 0.8 + 0.1 * 0.6
    + 0.1 * 1 + 0.1 * (2 / 3) + 0.05 * 0.6;
  assert.equal(block.score, Math.round(100 * expected), '77% on the full math');
  assert.equal(block.score, 77);
  assert.equal(block.evidenceCoverage, 1);
  assert.deepEqual([...block.missing], []);
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.components[0]));
});

test('renormalized weighting: a failed leg is out, never a zero', () => {
  const broken = pieces();
  broken.audience = { available: false, count: 0, top: [], error: 'upstream' };

  const block = computeResonance(broken);
  assert.deepEqual(block.missing.map((m) => [m.key, m.reason]),
    [['audience', RESONANCE_REASONS.AUDIENCE_UNAVAILABLE]]);
  assert.equal(block.evidenceCoverage, 0.75, 'the 0.25 weight is renormalized out');

  const withoutAudience = 0.2 * 0.5 + 0.2 * 0.8 + 0.1 * 0.6
    + 0.1 * 1 + 0.1 * (2 / 3) + 0.05 * 0.6;
  assert.equal(block.score, Math.round(100 * withoutAudience / 0.75), '69% on 75% coverage');

  const emptyPage = pieces();
  emptyPage.audience = { available: true, count: 0, top: [] };
  assert.equal(computeResonance(emptyPage).components
    .find((c) => c.key === 'audience').value, 0.5,
  'a delivered-but-empty insights page is a documented half signal');
});

test('honest null: nothing measurable -> uncomputed index', () => {
  const block = computeResonance({});
  assert.equal(block.score, null);
  assert.equal(block.evidenceCoverage, 0);
  assert.deepEqual([...block.missing].map((m) => m.key),
    Object.keys(RESONANCE_WEIGHTS));
  assert.match(block.summary, /stays uncomputed/);
  assert.match(renderResonance(block), /not computable \(no measurable signal\)/);

  const noPicks = pieces();
  noPicks.curation = { openingActs: [], sponsors: [], vendors: [] };
  const pickless = computeResonance(noPicks);
  assert.ok(pickless.missing.some((m) => m.reason === RESONANCE_REASONS.NO_PICKS));
  assert.ok(pickless.missing.some((m) => m.reason === RESONANCE_REASONS.NO_MEASURABLE_AFFINITY));
  assert.ok(pickless.score !== null, 'the remaining five signals still measure');
});

test('weight overrides and the TypeError matrix', () => {
  const single = computeResonance(pieces(), {
    weights: {
      audience: 1, dual_evidence: 0, affinity: 0,
      chain_survival: 0, domain_coverage: 0, layer_coverage: 0, uniqueness: 0,
    },
  });
  assert.equal(single.score, 100, 'the audience signal alone is a full signal here');

  const dualOnly = computeResonance(pieces(), {
    weights: {
      audience: 0, dual_evidence: 1, affinity: 0,
      chain_survival: 0, domain_coverage: 0, layer_coverage: 0, uniqueness: 0,
    },
  });
  assert.equal(dualOnly.score, 50, 'dual share alone: 0.5 -> 50%');

  for (const bad of [{ weights: { bogus: 1 } }, { weights: { audience: -1 } },
    { weights: { audience: Number.NaN } },
    { weights: {
      audience: 0, dual_evidence: 0, affinity: 0,
      chain_survival: 0, domain_coverage: 0, layer_coverage: 0, uniqueness: 0,
    } }]) {
    assert.throws(() => computeResonance(pieces(), bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => computeResonance(null), TypeError);
  assert.throws(() => renderResonance({}), TypeError);
});

test('real run: the index rides the activation bundle, flag honored', async () => {
  const options = () => ({
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    insightsFn: async () => ({
      count: 1,
      results: [{ name: 'Neon Ritual', affinity: 0.8 }],
    }),
    synthesis: false,
  });

  const bundle = await runExperiential('Static Ash Live', options());
  assert.ok(bundle.resonance !== null, 'the index is on by default');
  assert.equal(typeof bundle.resonance.score, 'number');
  assert.ok(bundle.resonance.score >= 0 && bundle.resonance.score <= 100);
  assert.equal(bundle.resonance.components.length + bundle.resonance.missing.length, 7,
    'every signal is either measured or honestly missing');
  assert.equal(bundle.resonance.evidenceCoverage,
    bundle.resonance.components.length === 7 ? 1 : bundle.resonance.evidenceCoverage);
  assert.match(bundle.resonance.summary, /Event Resonance Index \d+%/);

  const off = await runExperiential('Static Ash Live', { ...options(), resonance: false });
  assert.equal(off.resonance, null);
});

test('rendering and determinism', () => {
  const block = computeResonance(pieces());
  const document = renderResonance(block);
  assert.match(document, /^EVENT RESONANCE INDEX: 77%$/m);
  assert.match(document, /^ {3}evidence coverage: 100% of the weighting$/m);
  assert.match(document, /^ {3}- audience \(25% weight\): 1\.00 \[8 audience row\(s\)\]$/m);
  assert.match(document, /^ {3}- dual_evidence \(20% weight\): 0\.50 \[2 of 4 picks dual\]$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  const partial = renderResonance(computeResonance({ audience: { available: false } }));
  assert.match(partial, /missing \(renormalized out\): audience/);

  const a = computeResonance(pieces());
  const b = computeResonance(pieces());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderResonance(a), renderResonance(b));
});

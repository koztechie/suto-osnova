/**
 * OpeningActs gate (task 90) — the opening-acts selection algorithm:
 *   - the three-signal composite (graph / audience containment /
 *     rarity-weighted tag kinship) with absent-signal renormalization
 *     and pinned score math;
 *   - the auditable gates (below_min_audience_overlap,
 *     max_popularity, no_evidence);
 *   - ordering, maxActs capping, weight overrides;
 *   - the adapters (activation bundle + audience report -> pieces);
 *   - determinism, deep-freeze, TypeError matrix, zero emojis N/A
 *     (no rendering surface).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'opening-acts-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  selectOpeningActs, audienceOverlap,
  piecesFromActivation, fingerprintMapFromReport,
  OPENING_ACTS_DEFAULTS, OPENING_ACTS_REASONS,
} = await import('../src/modes/OpeningActs.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const T = (name) => ({ name });

const pieces = () => ({
  headliner: {
    name: 'Static Ash',
    audienceTop: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    tags: [T('gothic'), T('industrial')],
  },
  candidates: [
    { name: 'Near Twin', graphAffinity: 0.9, audienceTop: ['Alpha', 'Beta', 'Gamma'], tags: [T('gothic'), T('industrial')] },
    { name: 'Partial Pal', graphAffinity: 0.7, audienceTop: ['Gamma', 'Epsilon'], tags: [] },
    { name: 'Wrong Crowd', graphAffinity: 0.95, audienceTop: ['X', 'Y'], tags: [] },
    { name: 'No Data Act', graphAffinity: 0.6 },
    { name: 'Mega Star', graphAffinity: 0.8, popularity: 0.99, audienceTop: ['Alpha', 'Beta'], tags: [T('gothic')] },
    { name: 'Zero Evidence', tags: [] },
  ],
});

test('composite score: pinned math, renormalization, ordering', () => {
  const selection = selectOpeningActs(pieces(), { maxPopularity: 0.9 });

  assert.deepEqual(selection.acts.map((a) => a.name),
    ['Near Twin', 'Partial Pal', 'No Data Act']);

  const twin = selection.acts[0];
  assert.equal(twin.score, Math.round((0.45 * 0.9 + 0.4 + 0.15) * 1e12) / 1e12,
    'all three signals');
  assert.deepEqual({ ...twin.components }, { graph: 0.9, audience: 1, tags: 1 });
  assert.deepEqual({ ...twin.overlap }, { ratio: 1, shared: 3, size: 3 });

  const pal = selection.acts[1];
  assert.equal(pal.components.tags, null, 'no tags -> no kinship signal');
  assert.equal(pal.score, Math.round(((0.45 * 0.7 + 0.4 * 0.5) / 0.85) * 1e12) / 1e12,
    'weights renormalize over the two available signals');

  const solo = selection.acts[2];
  assert.equal(solo.score, 0.6, 'graph-only candidate keeps its full value');
  assert.deepEqual({ ...solo.components }, { graph: 0.6, audience: null, tags: null });

  assert.deepEqual(selection.rejected.map((r) => [r.name, r.reason]), [
    ['Wrong Crowd', OPENING_ACTS_REASONS.BELOW_MIN_OVERLAP],
    ['Mega Star', OPENING_ACTS_REASONS.MAX_POPULARITY],
    ['Zero Evidence', OPENING_ACTS_REASONS.NO_EVIDENCE],
  ]);
  assert.equal(selection.stats.candidates, 6);
  assert.equal(selection.stats.selected, 3);
  assert.equal(selection.stats.rejected, 3);
  assert.equal(selection.stats.withAudienceData, 4);
  assert.ok(Object.isFrozen(selection));
  assert.ok(Object.isFrozen(selection.acts[0]));
});

test('gates: relaxing the overlap floor admits the low-overlap act', () => {
  const selection = selectOpeningActs(pieces(), {
    maxPopularity: 0.9, minAudienceOverlap: 0,
  });
  const wrong = selection.acts.find((a) => a.name === 'Wrong Crowd');
  assert.ok(wrong, 'zero overlap passes when the floor is 0');
  assert.equal(wrong.components.audience, 0);
  assert.equal(wrong.score, Math.round(((0.45 * 0.95 + 0.4 * 0) / 0.85) * 1e12) / 1e12);
});

test('maxActs and weight overrides', () => {
  const capped = selectOpeningActs(pieces(), { maxActs: 1, maxPopularity: 0.9 });
  assert.deepEqual(capped.acts.map((a) => a.name), ['Near Twin']);

  const graphOnly = selectOpeningActs(pieces(), {
    maxPopularity: 0.9,
    weights: { graph: 1, audience: 0, tags: 0 },
  });
  assert.deepEqual(graphOnly.acts.map((a) => a.score), [0.9, 0.7, 0.6],
    'graph weight dominates in order');
});

test('audienceOverlap: containment semantics, case-insensitive, honest null', () => {
  assert.deepEqual({ ...audienceOverlap(['A', 'B'], ['a', 'C']) },
    { ratio: 0.5, shared: 1, size: 2 });
  assert.equal(audienceOverlap([], ['A']), null);
  assert.equal(audienceOverlap(['A'], []), null);
  assert.equal(audienceOverlap(undefined, ['A']), null);
});

test('adapters: activation bundle + audience report -> pieces', async () => {
  const bundle = await runExperiential('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    insightsFn: async () => ({ count: 0, results: [] }),
    synthesis: false,
  });
  const adapted = piecesFromActivation(bundle, {
    headlinerAudienceTop: ['Neighbor 0', 'Neighbor 1'],
    fingerprints: { 'Neighbor 2': ['Neighbor 0'] },
  });
  assert.equal(adapted.headliner.name, bundle.entity.name);
  assert.deepEqual([...adapted.headliner.audienceTop], ['Neighbor 0', 'Neighbor 1']);
  assert.equal(adapted.candidates.length,
    bundle.ranked.filter((e) => e.domain === 'music').length);
  const neighbor = adapted.candidates.find((c) => c.name === 'Neighbor 2');
  assert.deepEqual([...neighbor.audienceTop], ['Neighbor 0'],
    'fingerprints map by candidate name');

  // End to end: the algorithm runs over the adapted real bundle.
  const selection = selectOpeningActs(adapted, { minAudienceOverlap: 0 });
  assert.ok(selection.acts.length > 0);

  const map = fingerprintMapFromReport({
    perAct: [{ name: 'A', top: [{ name: 'X' }, { name: null }] }],
    blended: { top: [{ name: 'B' }] },
  });
  assert.deepEqual({ ...map.fingerprints }, { A: ['X'] });
  assert.deepEqual([...map.blendedTop], ['B']);
});

test('the TypeError matrix and determinism', () => {
  assert.throws(() => selectOpeningActs(null), TypeError);
  assert.throws(() => selectOpeningActs({ headliner: { name: '' } }), TypeError);
  assert.throws(() => selectOpeningActs({ headliner: { name: 'X' } }), TypeError,
    'candidates array required');
  assert.throws(() => selectOpeningActs({
    headliner: { name: 'X' }, candidates: [{ graphAffinity: 0.5 }],
  }), TypeError, 'candidate name required');
  for (const bad of [{ maxActs: 0 }, { maxActs: 26 }, { minAudienceOverlap: 2 },
    { maxPopularity: -1 }, { weights: { graph: -1 } }, { weights: { bogus: 1 } }]) {
    assert.throws(() => selectOpeningActs(pieces(), bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => selectOpeningActs(pieces(), {
    weights: { graph: 0, audience: 0, tags: 0 },
  }), TypeError, 'all-zero weights');

  const a = selectOpeningActs(pieces(), { maxPopularity: 0.9 });
  const b = selectOpeningActs(pieces(), { maxPopularity: 0.9 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

  assert.throws(() => piecesFromActivation(null), TypeError);
  assert.throws(() => piecesFromActivation({ entity: { name: 'X' } }, { fingerprints: [] }), TypeError);
  assert.throws(() => fingerprintMapFromReport({}), TypeError);
});

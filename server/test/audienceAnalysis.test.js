/**
 * AudienceAnalysis gate (task 88) — audience analysis of an artist or
 * festival lineup through the Qloo audience endpoints:
 *   - the lineup run: per-act fingerprints + the BLEND query (all ids
 *     in one call), explainability pass-through, convergence
 *     (audience magnets), divergence (pairwise overlap, most distinct
 *     first), the target-type default (music -> urn:entity:artist);
 *   - single-artist ergonomics via the resolution path;
 *   - honest isolation: a failing act, a failing blend, an
 *     unresolvable act — the lineup survives;
 *   - bounds + the TypeError vs typed-error split;
 *   - location pass-through, rendering, determinism, zero network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'audience-analysis-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  analyzeAudience, renderAudienceAnalysis,
  AudienceAnalysisError, AUDIENCE_CODES, AUDIENCE_DEFAULTS,
} = await import('../src/modes/AudienceAnalysis.js');
const { searchStub } = await import('../test-support/fullCycleRunner.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ACT_A = { id: UUID('a0000000'), name: 'Neon Ritual', category: 'music' };
const ACT_B = { id: UUID('b0000000'), name: 'Velvet Drone', category: 'music' };
const ACT_C = { id: UUID('c0000000'), name: 'Static Ash', category: 'music' };

const makeInsights = (calls) => async (params) => {
  calls.push(params);
  const ids = params.entityIds;
  if (ids.length === 3) {
    return {
      count: 2,
      results: [
        { name: 'Shared Headliner Sound', affinity: 0.9 },
        { name: 'Only In Blended', affinity: 0.5 },
      ],
      explainability: { aggregate: { signal: 'entity' } },
    };
  }
  const [id] = ids;
  if (id === ACT_A.id) {
    return {
      count: 2,
      results: [
        { name: 'Shared Headliner Sound', affinity: 0.85 },
        { name: 'A-only Crowd', affinity: 0.6 },
      ],
    };
  }
  if (id === ACT_B.id) {
    return {
      count: 2,
      results: [
        { name: 'Shared Headliner Sound', affinity: 0.8 },
        { name: 'B-only Crowd', affinity: 0.55 },
      ],
    };
  }
  return { count: 1, results: [{ name: 'C-only Crowd', affinity: 0.7 }] };
};

test('lineup: per-act fingerprints, blend, magnets, divergence', async () => {
  const calls = [];
  const report = await analyzeAudience([ACT_A, ACT_B, ACT_C], {
    insightsFn: makeInsights(calls),
  });

  assert.equal(report.targetDomain, 'urn:entity:artist', 'music -> artist URN');
  assert.equal(calls.length, 4, 'three per-act queries + one blend');
  const blendCall = calls.find((c) => c.entityIds.length === 3);
  assert.deepEqual([...blendCall.entityIds].sort(),
    [ACT_A.id, ACT_B.id, ACT_C.id].sort(), 'the blend carries EVERY act id');
  assert.equal(blendCall.take, AUDIENCE_DEFAULTS.take);

  assert.equal(report.stats.acts, 3);
  assert.equal(report.stats.availableActs, 3);
  assert.equal(report.blended.available, true);
  assert.equal(report.blended.count, 2);
  assert.deepEqual({ ...report.blended.explainability }, { aggregate: { signal: 'entity' } });

  // Convergence: the shared magnet with its supporters and best %.
  assert.equal(report.convergence.length, 1);
  assert.equal(report.convergence[0].name, 'Shared Headliner Sound');
  assert.deepEqual([...report.convergence[0].acts], ['Neon Ritual', 'Velvet Drone']);
  assert.equal(report.convergence[0].bestAffinityPercent, 85);

  // Divergence: zero-overlap pairs first, then the 0.5 pair.
  assert.deepEqual(report.divergence.map((p) => p.overlapRatio), [0, 0, 0.5]);
  assert.deepEqual(
    report.divergence.map((p) => `${p.a}|${p.b}`),
    ['Neon Ritual|Static Ash', 'Velvet Drone|Static Ash', 'Neon Ritual|Velvet Drone']
  );

  assert.deepEqual([...report.failures], []);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.blended));
});

test('single artist: string act resolves through the probe ladder', async () => {
  const calls = [];
  const report = await analyzeAudience('Static Ash Live', {
    insightsFn: makeInsights(calls),
    search: searchStub,
  });
  assert.equal(report.lineup[0].name, 'Midsommar', 'deterministic resolution');
  assert.equal(report.stats.acts, 1);
  assert.equal(calls.length, 2, 'one per-act + one single-id blend');
  assert.deepEqual([...report.divergence], [], 'no pairs for one act');
  assert.deepEqual([...report.convergence], [], 'no magnets for one act');
});

test('id-carrying acts skip resolution entirely (spy-pinned)', async () => {
  let searchCalls = 0;
  await analyzeAudience([ACT_A, ACT_B], {
    insightsFn: makeInsights([]),
    search: async () => { searchCalls += 1; return searchStub(); },
  });
  assert.equal(searchCalls, 0, 'no resolution for id-carrying acts');
});

test('isolation: a failing act degrades, the lineup survives', async () => {
  const failing = async (params) => {
    if (params.entityIds.length === 1 && params.entityIds[0] === ACT_B.id) {
      const error = new Error('act down');
      error.code = 'UPSTREAM_ERROR';
      throw error;
    }
    return makeInsights([])(params);
  };
  const report = await analyzeAudience([ACT_A, ACT_B, ACT_C], { insightsFn: failing });

  const b = report.perAct.find((act) => act.name === 'Velvet Drone');
  assert.equal(b.available, false);
  assert.equal(b.error, 'UPSTREAM_ERROR');
  assert.equal(report.stats.availableActs, 2);
  const ledger = report.failures.filter((f) => f.code === AUDIENCE_CODES.ACT_QUERY_FAILED);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].act, 'Velvet Drone');
  assert.deepEqual([...report.convergence], [], 'magnets need 2 available acts');
  assert.equal(report.blended.available, true, 'the blend query succeeded');
});

test('isolation: a failing blend is ledgered, per-act data stands', async () => {
  const noBlend = async (params) => {
    if (params.entityIds.length > 1) throw new Error('blend down');
    return makeInsights([])(params);
  };
  const report = await analyzeAudience([ACT_A, ACT_B], { insightsFn: noBlend });
  assert.equal(report.blended.available, false);
  assert.equal(report.stats.blendedAvailable, false);
  const ledger = report.failures.filter((f) => f.code === AUDIENCE_CODES.BLENDED_QUERY_FAILED);
  assert.equal(ledger.length, 1);
  assert.equal(report.stats.availableActs, 2, 'per-act fingerprints survived');
});

test('isolation: an unresolvable act lands in the ledger, the rest analyze', async () => {
  const report = await analyzeAudience([ACT_A, 'Totally Unknown Act'], {
    insightsFn: makeInsights([]),
    search: async () => ({ results: [] }),
  });
  const ledger = report.failures.filter((f) => f.code === AUDIENCE_CODES.ACT_UNRESOLVED);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].act, 'Totally Unknown Act');
  assert.equal(report.stats.acts, 2);
  assert.equal(report.stats.resolvedActs, 1);
  assert.equal(report.lineup[1].id, null);

  await assert.rejects(
    () => analyzeAudience('Unknown', {
      insightsFn: makeInsights([]), search: async () => ({ results: [] }),
    }),
    AudienceAnalysisError, 'all-act failure is a typed error'
  );
});

test('bounds: the typed-error vs TypeError split', async () => {
  const acts11 = Array.from({ length: 11 }, (_, i) => `Act ${i}`);
  try {
    await analyzeAudience(acts11, { insightsFn: makeInsights([]) });
    assert.fail('must reject');
  } catch (error) {
    assert.ok(error instanceof AudienceAnalysisError);
    assert.equal(error.code, 'lineup_too_large');
  }
  await assert.rejects(() => analyzeAudience([], { insightsFn: makeInsights([]) }), TypeError);
  await assert.rejects(() => analyzeAudience([42], { insightsFn: makeInsights([]) }), TypeError);
  await assert.rejects(() => analyzeAudience(ACT_A, { insightsFn: 'nope' }), TypeError);
  await assert.rejects(() => analyzeAudience(ACT_A, { take: 0 }), TypeError);
  await assert.rejects(() => analyzeAudience(ACT_A, { maxActs: 0 }), TypeError);
});

test('location pass-through and rendering', async () => {
  const calls = [];
  const report = await analyzeAudience([ACT_A, ACT_B], {
    insightsFn: makeInsights(calls),
    scene: { location: 'Berlin' },
  });
  assert.equal(report.location, 'Berlin');
  for (const call of calls) {
    assert.equal(call.location, 'Berlin', 'every query carries the venue locality');
  }

  const document = renderAudienceAnalysis(report);
  assert.match(document, /^AUDIENCE ANALYSIS$/m);
  assert.match(document, /^Lineup: Neon Ritual \+ Velvet Drone$/m);
  assert.match(document, /^Target: urn:entity:artist @ Berlin$/m);
  assert.match(document, /^BLENDED AUDIENCE: 2 affinity entit\(ies\)$/m);
  assert.match(document, /^ACT Neon Ritual: 2 affinity entit\(ies\)$/m);
  assert.match(document, /AUDIENCE MAGNETS \(shared by 2\+ acts\):/);
  assert.match(document, /Shared Headliner Sound \[Neon Ritual, Velvet Drone\]/);
  assert.match(document, /^DIVERGENCE: most distinct pair /m);
  assert.match(document, /^LEDGER: 0 failure\(s\)$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');
});

test('determinism and zero network', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network attempted');
  };
  try {
    const a = await analyzeAudience([ACT_A, ACT_B], { insightsFn: makeInsights([]) });
    const b = await analyzeAudience([ACT_A, ACT_B], { insightsFn: makeInsights([]) });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    assert.deepEqual(calls, [], 'every insights call was injected');
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }
  assert.throws(() => renderAudienceAnalysis({}), TypeError);
});

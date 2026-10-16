/**
 * ExperientialMode gate (task 87) — Mode 2: Live Event & Festival
 * Activation over injected stubs (zero network):
 *   - the happy curation run: three-domain expansion (music/fashion/
 *     dining only), audience insights leg with the venue locality,
 *     dual-evidence marking, the three curation lists, DELIVERED
 *     session;
 *   - honest insights degradation (typed failure -> ledger +
 *     available=false, curation continues on graph evidence);
 *   - the real audience-insights CLIENT integration path via an
 *     instrumented global fetch (request reaches /v2/audiences);
 *   - scene-context bias inside the activation chain;
 *   - synthesis skip, determinism, TypeError contracts, zero network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'experiential-mode-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  runExperiential, ACTIVATION_CODES, EVIDENCE_KINDS, ACTIVATION_DEFAULTS,
} = await import('../src/modes/ExperientialMode.js');
const { searchStub } = await import('../test-support/fullCycleRunner.js');
const { MODE_ACTIVATION } = await import('../src/engine/ModeDispatcher.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (name) => ({ id: `urn:tag:t:${name}`, name, type: 'urn:tag:t' });
const row = (name, domain, affinity, extra = {}) => ({
  id: UUID(`${name.length}${domain.length}${Math.round(affinity * 100)}0000`.slice(0, 8).padEnd(8, '0')),
  name,
  subtype: domain === 'music' ? 'urn:entity:artist'
    : domain === 'fashion' ? 'urn:entity:brand' : 'urn:entity:place',
  affinity,
  popularity: 0.4,
  tags: [tag(domain)],
  ...extra,
});

const MUSIC = [
  row('Neon Ritual', 'music', 0.92),
  row('Static Ash', 'music', 0.85),
  row('Velvet Drone', 'music', 0.78),
];
const FASHION = [
  row('Iron Atelier', 'fashion', 0.88),
  row('Ash Couture', 'fashion', 0.74),
];
const DINING = [
  row('Midnight Diner', 'dining', 0.81),
  row('Local Roastery', 'dining', 0.69),
];

const affinityFn = async (ids, domain) => {
  if (domain === 'music') return { results: MUSIC };
  if (domain === 'fashion') return { results: FASHION };
  if (domain === 'dining') return { results: DINING };
  return { results: [] };
};

const insightsStub = async (params) => ({
  count: 2,
  results: [
    { name: 'Neon Ritual', affinity: 0.8 },
    { name: 'Local Roastery', affinity: 0.6 },
  ],
  _params: params,
});

const baseOptions = (overrides = {}) => ({
  affinityFn,
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: async () => ({ results: [] }),
  insightsFn: insightsStub,
  synthesis: false,
  // The curation assertions pin the FULL gate-survivor list; the
  // engine's banality quantile stays covered by its own unit suite.
  cutRate: 0,
  ...overrides,
});

test('happy run: three-domain curation with the insights leg and dual evidence', async () => {
  const captured = [];
  const bundle = await runExperiential('Static Ash Live', {
    ...baseOptions(),
    insightsFn: async (params) => { captured.push(params); return insightsStub(params); },
    scene: { location: 'Berlin' },
  });

  assert.equal(bundle.mode, MODE_ACTIVATION);
  assert.equal(bundle.output, 'activation_curation');
  assert.equal(bundle.entity.name, 'Midsommar', 'deterministic resolution for this seed');

  // The insights leg received the headliner id, the target type AND
  // the venue locality.
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].entityIds, [bundle.entity.id]);
  assert.equal(captured[0].targetDomain, 'urn:entity:movie');
  assert.equal(captured[0].location, 'Berlin');
  assert.equal(captured[0].take, ACTIVATION_DEFAULTS.insightsTake);
  assert.equal(bundle.audience.available, true);
  assert.equal(bundle.audience.count, 2);
  assert.equal(bundle.audience.location, 'Berlin');

  // Expansion targets ONLY the activation domains.
  assert.deepEqual([...bundle.expansion.domains], ['music', 'dining', 'fashion']);

  // The three curation lists.
  assert.deepEqual([...bundle.curation.openingActs.map((i) => i.name)].sort(),
    ['Neon Ritual', 'Static Ash', 'Velvet Drone']);
  assert.deepEqual([...bundle.curation.sponsors.map((i) => i.name)].sort(),
    ['Ash Couture', 'Iron Atelier']);
  assert.deepEqual([...bundle.curation.vendors.map((i) => i.name)].sort(),
    ['Local Roastery', 'Midnight Diner']);

  // Dual-evidence marking against the insights top list.
  const neon = bundle.curation.openingActs.find((i) => i.name === 'Neon Ritual');
  assert.equal(neon.evidence, EVIDENCE_KINDS.DUAL);
  const ash = bundle.curation.openingActs.find((i) => i.name === 'Static Ash');
  assert.equal(ash.evidence, EVIDENCE_KINDS.CONFIRMED_AFFINITY);
  assert.equal(bundle.stats.dualEvidence, 2, 'Neon Ritual + Local Roastery');
  assert.match(neon.pitch, /92% affinity/);
  assert.equal(typeof neon.affinityPercent, 'number');

  // Session lifecycle.
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.equal(bundle.session.execution.step, 11);
  assert.deepEqual(bundle.failures.map((f) => f.code), [ACTIVATION_CODES.SYNTHESIS_SKIPPED],
    'the only ledger entry is the deliberate synthesis skip');
});

test('honest degradation: the insights leg fails, the curation survives', async () => {
  const bundle = await runExperiential('Static Ash Live', {
    ...baseOptions({
      insightsFn: async () => {
        const error = new Error('insights down');
        error.code = 'UPSTREAM_ERROR';
        throw error;
      },
    }),
  });

  assert.equal(bundle.audience.available, false);
  assert.equal(bundle.audience.error, 'UPSTREAM_ERROR');
  const ledger = bundle.failures.filter((f) => f.code === ACTIVATION_CODES.INSIGHTS_FAILED);
  assert.equal(ledger.length, 1);
  assert.ok(bundle.curation.openingActs.length > 0, 'graph evidence still curates');
  for (const item of bundle.curation.openingActs) {
    assert.equal(item.evidence, EVIDENCE_KINDS.CONFIRMED_AFFINITY);
  }
  assert.equal(bundle.stats.dualEvidence, 0);
  assert.equal(bundle.session.state, AgentState.DELIVERED);
});

test('real client path: the default insights leg reaches /v2/insights', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, results: { entities: [] } }),
    };
  };
  try {
    const bundle = await runExperiential('Static Ash Live', {
      ...baseOptions(), insightsFn: undefined,
    });
    assert.equal(bundle.audience.available, true);
    assert.equal(bundle.audience.count, 0, 'empty insights, honestly reported');
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }
  assert.equal(calls.length, 1, 'the insights client issued exactly one request');
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v2/insights');
  assert.equal(url.host, 'hackathon.api.qloo.com', 'sanctioned host only');
});

test('scene bias: a venue-local candidate gains the documented boost', async () => {
  // Three dining candidates so no lone carrier claims weight 1.0
  // (the generic_weight Via Negativa rule would cut it).
  const localAffinity = async (ids, domain) => {
    if (domain === 'dining') {
      return {
        results: [
          row('Berlin Kabarett Schmankerl', 'dining', 0.62, { tags: [tag('Berlin')] }),
          row('Midnight Diner', 'dining', 0.81),
          row('Local Roastery', 'dining', 0.69),
        ],
      };
    }
    return affinityFn(ids, domain);
  };
  const withScene = await runExperiential('Static Ash Live', {
    ...baseOptions({ affinityFn: localAffinity }),
    scene: { location: 'Berlin' },
  });
  const boosted = withScene.ranked.find((e) => e.name === 'Berlin Kabarett Schmankerl');
  assert.ok(boosted, '0.62 + 0.05 >= the 0.65 gate');
  assert.equal(boosted.affinityBase, 0.62);
  assert.deepEqual({ ...boosted.contextMatch }, { era: null, location: true });

  const plain = await runExperiential('Static Ash Live', {
    ...baseOptions({ affinityFn: localAffinity }),
  });
  assert.ok(!plain.ranked.some((e) => e.name === 'Berlin Kabarett Schmankerl'),
    'without the venue context, 0.62 fails the gate');
});

test('vendors dedup: ranked picks and venue entities never double-list', async () => {
  const venueAffinity = async (ids, domain) => {
    if (domain === 'dining') {
      return { results: [row('Midnight Diner', 'dining', 0.81)] };
    }
    return affinityFn(ids, domain);
  };
  const bundle = await runExperiential('Static Ash Live', {
    ...baseOptions({ affinityFn: venueAffinity }),
  });
  const names = bundle.curation.vendors.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, 'no duplicates');
});

test('zero network and determinism', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network attempted');
  };
  try {
    const a = await runExperiential('Static Ash Live', baseOptions());
    const b = await runExperiential('Static Ash Live', baseOptions());
    assert.equal(a.entity.name, 'Midsommar');
    assert.deepEqual(calls, [], 'every client was injected');
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }
});

test('option contracts: programmer misuse is a TypeError', async () => {
  await assert.rejects(() => runExperiential('X', { insightsFn: insightsStub }), TypeError);
  for (const bad of [0, 51, 2.5]) {
    await assert.rejects(() => runExperiential('X', { ...baseOptions(), topN: bad }), TypeError);
  }
  await assert.rejects(
    () => runExperiential('X', { ...baseOptions(), scene: 42 }), TypeError
  );
  await assert.rejects(
    () => runExperiential('X', { ...baseOptions(), contextBoost: 9 }), TypeError
  );
  await assert.rejects(
    () => runExperiential('X', { ...baseOptions(), insightsFn: 'nope' }), TypeError
  );
});

test('synthesis: disabled keeps the curation intact', async () => {
  const bundle = await runExperiential('Static Ash Live', baseOptions());
  assert.equal(bundle.synthesis.attempted, false);
  assert.equal(bundle.synthesis.failure.code, ACTIVATION_CODES.SYNTHESIS_SKIPPED);
  assert.ok(bundle.curation.openingActs.length > 0);
  assert.equal(bundle.stats.synthesis, ACTIVATION_CODES.SYNTHESIS_SKIPPED);
});

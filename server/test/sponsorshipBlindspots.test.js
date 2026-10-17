/**
 * SponsorshipBlindspots gate (task 98) — sponsorship blindspot
 * detection:
 *   - the five machine-readable flags with their exported floors;
 *   - the renormalized danger score (measured axes only; nothing
 *     measurable -> the unverifiable force-to-high rule);
 *   - the verdict ladder (high_risk / elevated / clear) and the
 *     blindspot/clear split;
 *   - the runExperiential-bundle adapter (sponsor picks enriched
 *     with ranked popularity + the audience top list);
 *   - tuning overrides, the TypeError matrix, the render contract,
 *     determinism, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'blindspots-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  detectSponsorshipBlindspots, piecesFromActivationBundle, renderSponsorshipBlindspots,
  BLINDSPOT_FLAGS, RISK_VERDICTS, SPONSORSHIP_TUNING,
} = await import('../src/modes/SponsorshipBlindspots.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { searchStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const T = (name) => ({ name });

// Six candidates, one per outcome shape.
const candidates = () => [
  { id: 'a', name: 'Iron Atelier', domain: 'fashion',
    affinity: 0.88, audienceAffinity: 0.9, popularity: 0.4, evidence: 'dual' },
  { id: 'b', name: 'Chrome Works', domain: 'fashion',
    affinity: 0.75, audienceAffinity: null, popularity: 0.3, evidence: 'confirmed_affinity' },
  { id: 'c', name: 'Zero Resonance', domain: 'fashion',
    affinity: 0.05, audienceAffinity: 0.1, popularity: 0.3, evidence: 'confirmed_affinity' },
  { id: 'd', name: 'Obscure Pick', domain: 'fashion',
    affinity: 0.6, audienceAffinity: 0.5, popularity: 0.01, evidence: 'dual' },
  { id: 'e', name: 'Mass Market Shill', domain: 'fashion',
    affinity: 0.1, audienceAffinity: 0.15, popularity: 0.8, evidence: 'audience_insight' },
  { id: 'f', name: 'Ghost Sponsor', domain: 'fashion',
    affinity: null, audienceAffinity: null, popularity: null, evidence: null },
];

test('the five flags: floors, the unverifiable rule, the verdict ladder', () => {
  const report = detectSponsorshipBlindspots(candidates());

  const byName = new Map(report.candidates.map((r) => [r.name, r]));

  const iron = byName.get('Iron Atelier');
  assert.deepEqual([...iron.flags], [], 'dual-aligned, recognized — no flags');
  assert.equal(iron.verdict, RISK_VERDICTS.CLEAR);
  assert.equal(iron.riskScore,
    Math.round((0.35 * 0.12 + 0.35 * 0.1 + 0.15 * 0.6 + 0.15 * 0) * 1e12) / 1e12,
    'the renormalized danger mean over all four measured axes');
  assert.equal(iron.riskPercent, 17);

  const chrome = byName.get('Chrome Works');
  assert.deepEqual([...chrome.flags], [BLINDSPOT_FLAGS.SINGLE_EVIDENCE],
    'confirmed by only one leg');
  assert.equal(chrome.verdict, RISK_VERDICTS.ELEVATED);
  // taste (0.35) + recognition (0.15) + evidence (0.15) = 0.65; the
  // audience axis is unmeasured and RENORMALIZED OUT.
  assert.ok(Math.abs(chrome.riskScore
    - (0.35 * 0.25 + 0.15 * 0.7 + 0.15 * 0.5) / 0.65) < 1e-9,
  'the renormalized mean over the three measured axes only');

  const zero = byName.get('Zero Resonance');
  assert.deepEqual([...zero.flags],
    [BLINDSPOT_FLAGS.TASTE, BLINDSPOT_FLAGS.AUDIENCE, BLINDSPOT_FLAGS.SINGLE_EVIDENCE]);
  assert.equal(zero.verdict, RISK_VERDICTS.HIGH, 'a core taste/audience blindspot');
  assert.equal(zero.riskPercent, 83);

  const obscure = byName.get('Obscure Pick');
  assert.deepEqual([...obscure.flags], [BLINDSPOT_FLAGS.LOW_RECOGNITION],
    'popularity 0.01 < recognitionFloor 0.05');
  assert.equal(obscure.verdict, RISK_VERDICTS.ELEVATED);

  const shill = byName.get('Mass Market Shill');
  assert.deepEqual([...shill.flags],
    [BLINDSPOT_FLAGS.TASTE, BLINDSPOT_FLAGS.AUDIENCE,
      BLINDSPOT_FLAGS.SINGLE_EVIDENCE, BLINDSPOT_FLAGS.MASS_MARKET],
  'mainstream popularity + a blindspot -> the inauthentic mass-market flag');
  assert.equal(shill.verdict, RISK_VERDICTS.HIGH);

  const ghost = byName.get('Ghost Sponsor');
  assert.deepEqual([...ghost.flags], [BLINDSPOT_FLAGS.UNVERIFIABLE]);
  assert.equal(ghost.verdict, RISK_VERDICTS.HIGH, 'an unprovable sponsor is unbookable');
  assert.equal(ghost.riskScore, null, 'nothing measurable stays honestly null');
  assert.equal(ghost.riskPercent, 100);
});

test('the split and stats: blindspots vs clear, per-flag counts', () => {
  const report = detectSponsorshipBlindspots(candidates());
  assert.deepEqual(report.blindspots.map((r) => r.name),
    ['Ghost Sponsor', 'Zero Resonance', 'Mass Market Shill', 'Obscure Pick', 'Chrome Works'],
    'risk DESC (null treated as max), then name');
  assert.deepEqual(report.clear.map((r) => r.name), ['Iron Atelier']);
  assert.deepEqual({ ...report.stats }, {
    candidates: 6, blindspots: 5, highRisk: 3, elevated: 2, clear: 1,
    byFlag: {
      taste_blindspot: 2, audience_blindspot: 2, single_evidence: 3,
      low_recognition: 1, mass_market_no_justification: 1, unverifiable: 1,
    },
  });
  assert.equal(report.tuning.graphFloor, SPONSORSHIP_TUNING.graphFloor);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.candidates[0]));
});

test('tuning overrides and the TypeError matrix', () => {
  // Raising the graph floor turns a mid-affinity pick into a blindspot.
  const strict = detectSponsorshipBlindspots(candidates(), {
    tuning: { graphFloor: 0.8 },
  });
  const chrome = strict.candidates.find((r) => r.name === 'Chrome Works');
  assert.ok(chrome.flags.includes(BLINDSPOT_FLAGS.TASTE), '0.75 <= 0.8 now blindspots');

  for (const bad of [{ graphFloor: 2 }, { audienceFloor: -1 }, { weights: { taste: -1 } }]) {
    assert.throws(() => detectSponsorshipBlindspots([], { tuning: bad }),
      TypeError, JSON.stringify(bad));
  }
  assert.throws(() => detectSponsorshipBlindspots(null), TypeError);
  assert.throws(() => renderSponsorshipBlindspots({}), TypeError);
  assert.throws(() => piecesFromActivationBundle(null), TypeError);
});

test('honest emptiness: no candidates -> a stated empty report', () => {
  const report = detectSponsorshipBlindspots([]);
  assert.deepEqual(report.blindspots, []);
  assert.equal(report.stats.candidates, 0);
  assert.match(report.summary, /No measurable resonance risk across 0/);
  assert.match(renderSponsorshipBlindspots(report), /No measurable resonance risk across 0/);
});

test('real run: the adapter enriches sponsors, the screen runs end to end', async () => {
  const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
  const brandRow = (name, i, extra = {}) => ({
    id: UUID(`f${i}00000`), name, subtype: 'urn:entity:brand',
    affinity: 0.9 - i * 0.05, popularity: 0.4,
    tags: [{ id: 'urn:tag:genre:fashion:gothic', name: 'Gothic', type: 'urn:tag:genre:fashion' }],
    ...extra,
  });
  const brandAffinity = async (ids, domain) => {
    if (domain === 'fashion') {
      return { results: [brandRow('Iron Atelier', 0), brandRow('Chrome Works', 1, { affinity: 0.1, popularity: 0.8 })] };
    }
    return {
      results: [{ id: UUID(`${domain.slice(0, 1)}90000`), name: `Filler ${domain}`, subtype: 'urn:entity:artist', affinity: 0.8, popularity: 0.4 }],
    };
  };

  const bundle = await runExperiential('Static Ash Live', {
    affinityFn: brandAffinity,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    insightsFn: async () => ({
      count: 1,
      results: [{ name: 'Iron Atelier', affinity: 0.9 }],
    }),
    synthesis: false,
    cutRate: 0,
  });

  const candidatesFromBundle = piecesFromActivationBundle(bundle);
  assert.equal(candidatesFromBundle.length, bundle.curation.sponsors.length,
    'one candidate per sponsor pick');
  const iron = candidatesFromBundle.find((c) => c.name === 'Iron Atelier');
  assert.ok(iron, 'the sponsored brand is screened');
  assert.equal(iron.popularity, 0.4, 'ranked popularity is pulled in');
  assert.equal(iron.audienceAffinity, 0.9, 'the audience top list is matched by name');
  assert.equal(iron.evidence, 'dual', 'the task-87 evidence label rides along');

  const report = detectSponsorshipBlindspots(candidatesFromBundle);
  assert.equal(report.stats.candidates, candidatesFromBundle.length);
  assert.ok(!/\p{Extended_Pictographic}/u.test(renderSponsorshipBlindspots(report)),
    'zero emojis');
});

test('render contract and determinism', () => {
  const report = detectSponsorshipBlindspots(candidates());
  const document = renderSponsorshipBlindspots(report);
  assert.match(document, /^SPONSORSHIP BLINDSPOTS — brands that would fail on site$/m);
  assert.match(document, /^5 of 6 sponsor candidate\(s\) carry measurable resonance risk \(3 high, 2 elevated\) — screen before booking\.$/m);
  assert.match(document, /^ {3}- Ghost Sponsor \[high risk\] — 100% risk: unverifiable$/m);
  assert.match(document, /^ {3}- Zero Resonance \[high risk\] — 83% risk: taste blindspot, audience blindspot, single evidence$/m);
  assert.match(document, /^CLEARED \(1\): Iron Atelier$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  const a = detectSponsorshipBlindspots(candidates());
  const b = detectSponsorshipBlindspots(candidates());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderSponsorshipBlindspots(a), renderSponsorshipBlindspots(b));
});

/**
 * AntagonistProfile gate (task 97) — antagonist profile generation
 * for dramaturges:
 *   - the tension metric (heroAnchor x antagonistDivergence), pinned
 *     math and the ranking (tension DESC, divergence DESC, domain);
 *   - the signature conflict (the strongest tension);
 *   - the honest gap ledger: no_antagonist_evidence,
 *     no_protagonist_anchor, anchor_not_unsigned, and the
 *     degenerate self_match guard;
 *   - the runAntithesis-bundle adapter;
 *   - the render contract, determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'antagonist-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildAntagonistProfile, profileFromAntithesisBundle, renderAntagonistProfile,
  ANTAGONIST_REASONS,
} = await import('../src/modes/AntagonistProfile.js');
const { buildAntithesisBlock } = await import('../src/modes/AntithesisMode.js');
const { runAntithesis } = await import('../src/modes/AntithesisMode.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const row = (id, name, domain, extra = {}) => ({ id, name, domain, ...extra });

// Music: a committed hero anchor (0.98) + a strong blindspot
// (0.02 -> 98% divergence). Film: a hero anchor (0.9) + a proven
// zero (100% divergence). Dining: a single measurable candidate ->
// degenerate self-match. Books: nothing -> a gap.
const block = () => buildAntithesisBlock({
  anchor: { name: 'Static Ash Live', domain: 'music' },
  candidates: [
    row('m1', 'Static Ash Live', 'music', { affinity: 0.98, popularity: 0.9 }),
    row('m2', 'Zzz Corrupt', 'music', { affinity: 0.02, popularity: 0.99 }),
    row('m3', 'Rust Choir', 'music', { affinity: 0.4, popularity: 0.2 }),
    row('f1', 'Hero Flick', 'film', { affinity: 0.9, popularity: 0.8 }),
    row('f2', 'Null Correlate', 'film', { affinity: 0, popularity: 0.5 }),
    row('d1', 'Hero Bistro', 'dining', { affinity: 0.85, popularity: 0.6 }),
  ],
  domains: ['music', 'film', 'dining', 'books'],
  perDomain: 3,
  conflictLimit: 5,
});

test('tension metric: heroAnchor x divergence, ranked, signature', () => {
  const b = block();
  assert.deepEqual(b.protagonist.fingerprint.map((f) => [f.domain, f.name, f.affinityPercent]), [
    ['music', 'Static Ash Live', 98],
    ['film', 'Hero Flick', 90],
    ['dining', 'Hero Bistro', 85],
    ['books', null, null],
  ], 'the fingerprint is the per-domain strongest hero affinity');

  const profile = buildAntagonistProfile({
    protagonist: b.protagonist, antithesis: b,
  });

  assert.deepEqual(profile.environments.map((e) => e.domain), ['music', 'film'],
    'dining self-matches and books has no opposition — both ledgered as gaps');
  const music = profile.environments[0];
  assert.equal(music.tension, Math.round(0.98 * 0.98 * 1e12) / 1e12,
    'hero anchor 0.98 x divergence 0.98');
  assert.equal(music.tensionPercent, 96);
  assert.equal(music.hero.name, 'Static Ash Live');
  assert.equal(music.antagonist.name, 'Zzz Corrupt');
  assert.equal(music.antagonist.divergencePercent, 98);

  const film = profile.environments[1];
  assert.equal(film.tension, 0.9, 'hero anchor 0.9 x divergence 1.0 (proven zero)');
  assert.equal(film.tensionPercent, 90);
  assert.equal(film.antagonist.dissonanceClass, 'measured_dissonance');

  assert.equal(profile.signature.domain, 'music', 'the strongest tension signs the profile');
  assert.equal(profile.signature.tensionPercent, 96);
  assert.deepEqual({ ...profile.stats }, {
    domains: 4, paired: 2, gaps: 2, maxTension: 96, meanTension: 93,
  });
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.environments[0]));
});

test('the gap ledger: every reason reported, nothing invented', () => {
  const profile = buildAntagonistProfile({
    protagonist: block().protagonist, antithesis: block(),
  });
  const reasons = profile.gaps.map((g) => [g.domain, g.reason]);
  assert.deepEqual(reasons, [
    ['dining', ANTAGONIST_REASONS.SELF_MATCH],
    ['books', ANTAGONIST_REASONS.NO_ANTAGONIST_EVIDENCE],
  ], 'the single-candidate domain is a self-match; the empty domain is a gap');

  // A signed hero anchor carries no unsigned affinity -> honest null.
  const signedBlock = buildAntithesisBlock({
    anchor: { name: 'Static Ash Live', domain: 'film' },
    candidates: [
      row('f1', 'Signed Hero', 'film', { correlation: 0.9, popularity: 0.8 }),
      row('f2', 'Faint Signal', 'film', { affinity: 0.15, popularity: 0.5 }),
    ],
    domains: ['film'],
    perDomain: 3,
  });
  const signedProfile = buildAntagonistProfile({
    protagonist: signedBlock.protagonist, antithesis: signedBlock,
  });
  assert.deepEqual(signedProfile.environments, []);
  assert.equal(signedProfile.gaps[0].reason, ANTAGONIST_REASONS.ANCHOR_NOT_UNSIGNED);

  // A matrix domain absent from the fingerprint -> no anchor.
  const anchorless = buildAntagonistProfile({
    protagonist: { name: 'X', domain: 'music', fingerprint: [] },
    antithesis: { matrix: [{ domain: 'music', count: 1, entries: [
      { name: 'Opposed', divergencePercent: 90 },
    ] }] },
  });
  assert.equal(anchorless.gaps[0].reason, ANTAGONIST_REASONS.NO_PROTAGONIST_ANCHOR);
  assert.deepEqual(anchorless.environments, []);
  assert.equal(anchorless.signature, null);
});

test('honest emptiness: nothing to stage -> stated, not faked', () => {
  const profile = buildAntagonistProfile({
    protagonist: { name: 'Static Ash Live', domain: 'music', fingerprint: [] },
    antithesis: { matrix: [{ domain: 'books', count: 0, entries: [] }] },
  });
  assert.deepEqual(profile.environments, []);
  assert.equal(profile.signature, null);
  assert.equal(profile.stats.maxTension, null);
  assert.equal(profile.stats.meanTension, null);
  assert.match(profile.summary, /cannot prove a subconscious clash/);
  assert.match(renderAntagonistProfile(profile), /cannot prove a subconscious clash/);
});

test('bounds: limit and the ingress TypeError matrix', () => {
  const b = block();
  for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }]) {
    assert.throws(() => buildAntagonistProfile({
      protagonist: b.protagonist, antithesis: b,
    }, bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => buildAntagonistProfile({ antithesis: b }), TypeError);
  assert.throws(() => buildAntagonistProfile({ protagonist: b.protagonist }), TypeError);
  assert.throws(() => buildAntagonistProfile(null), TypeError);
  assert.throws(() => profileFromAntithesisBundle(null), TypeError);
  assert.throws(() => renderAntagonistProfile({}), TypeError);
});

test('real run: the profile rides the antithesis bundle', async () => {
  const options = () => ({
    affinityFn: affinityStub,
    search: searchStub,
    tagsFn: tagsStub,
    synthesis: false,
  });
  const bundle = await runAntithesis('Static Ash Live', options());
  const profile = profileFromAntithesisBundle(bundle);

  assert.equal(profile.protagonist.name, bundle.entity.name);
  assert.equal(
    profile.stats.paired + profile.stats.gaps, profile.stats.domains,
    'every domain is either staged or honestly ledgered'
  );
  assert.ok(profile.signature === null
    || (profile.signature.tensionPercent >= 0 && profile.signature.tensionPercent <= 100));
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.ok(!/\p{Extended_Pictographic}/u.test(renderAntagonistProfile(profile)),
    'zero emojis');
});

test('render contract and determinism', () => {
  const profile = buildAntagonistProfile({
    protagonist: block().protagonist, antithesis: block(),
  });
  const document = renderAntagonistProfile(profile);
  assert.match(document,
    /^ANTAGONIST PROFILE — the world that subconsciously clashes with Static Ash Live$/m);
  assert.match(document,
    /^ {3}\[music\] 96% tension — Static Ash Live \(98%\) vs Zzz Corrupt \(98% divergence\)$/m);
  assert.match(document,
    /^SIGNATURE CONFLICT \[music\]: Static Ash Live vs Zzz Corrupt — 96% tension$/m);
  assert.match(document, /^UNSCORED \(2\): dining \[self match\], books \[no antagonist evidence\]$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  const a = buildAntagonistProfile({ protagonist: block().protagonist, antithesis: block() });
  const c = buildAntagonistProfile({ protagonist: block().protagonist, antithesis: block() });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(c)));
  assert.equal(renderAntagonistProfile(a), renderAntagonistProfile(c));
});

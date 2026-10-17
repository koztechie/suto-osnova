/**
 * ContrastExplainer gate (task 100) — the textual explanation
 * generator for directors and marketers:
 *   - the evidence statements over the measured axes + the honest
 *     "unmeasured" statements for the missing ones;
 *   - the band-keyed DIRECTOR and MARKETER reading tables (all four
 *     bands), the audience filter, the `both` default;
 *   - the honest null path (no measurable contrast -> NO fabricated
 *     readings);
 *   - the one-call explainEntities adapter;
 *   - the render contract, determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'contrast-explainer-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  explainContrast, explainEntities, renderContrastExplanation,
  DIRECTOR_READINGS, MARKETER_READINGS,
} = await import('../src/engine/ContrastExplainer.js');
const { calculateCulturalDistance } = await import('../src/engine/CulturalDistance.js');

const T = (name) => ({ name });

const A = () => ({
  name: 'Static Ash Live',
  tags: [T('gothic'), T('post-punk')],
  profile: { music: 0.9, fashion: 0.7 },
});
const B = () => ({
  name: 'Neon Ritual',
  tags: [T('gothic'), T('techno')],
  profile: { music: 0.3, fashion: 0.9 },
});

test('evidence + readings over a measured contrast', () => {
  const expl = explainContrast(calculateCulturalDistance(A(), B()));

  assert.equal(expl.band, 'divergent');
  assert.equal(expl.distancePercent, 51);
  assert.equal(expl.headline,
    'divergent contrast (51% measured distance) between Static Ash Live and Neon Ritual');
  assert.deepEqual([...expl.evidence], [
    'shared vocabulary: 1 shared of 3 union tag(s) — 67% apart',
    'audience profile: 2 shared domain(s) — 40% mean deviation',
  ], 'each statement traces to a measured axis');
  assert.deepEqual([...expl.gaps], []);
  assert.equal(expl.readings.director.angle, 'two worlds');
  assert.equal(expl.readings.marketer.angle, 'segmented');
  assert.equal(expl.basis, 'band divergent at 51% distance, measured on 2 axis/axes');
  assert.ok(Object.isFrozen(expl));
  assert.ok(Object.isFrozen(expl.readings));
});

test('the band-keyed reading tables: all four bands, both audiences', () => {
  const bands = [
    [{ music: 0.5 }, { music: 0.5 }, 'kindred', 'mirror', 'co-brand safe'],
    [{ music: 0.8 }, { music: 0.6 }, 'adjacent', 'friction', 'cross-sell'],
    [{ music: 0.9 }, { music: 0.4 }, 'divergent', 'two worlds', 'segmented'],
    [{ music: 0.9 }, { music: 0.1 }, 'antipodal', 'opposition', 'mutual-exclusion'],
  ];
  for (const [pa, pb, band, directorAngle, marketerAngle] of bands) {
    const expl = explainEntities({ name: 'A', profile: pa }, { name: 'B', profile: pb });
    assert.equal(expl.band, band, `${band} band`);
    assert.equal(expl.readings.director.angle, directorAngle, `${band} director`);
    assert.equal(expl.readings.marketer.angle, marketerAngle, `${band} marketer`);
    assert.equal(expl.readings.director.guidance, DIRECTOR_READINGS[band].guidance);
    assert.equal(expl.readings.marketer.guidance, MARKETER_READINGS[band].guidance);
  }
});

test('the audience filter and the both default', () => {
  const directorOnly = explainEntities(A(), B(), { audience: 'director' });
  assert.equal(directorOnly.readings.director.angle, 'two worlds');
  assert.equal(directorOnly.readings.marketer, undefined, 'marketer is not returned');
  assert.equal(directorOnly.audience, 'director');

  const marketerOnly = explainEntities(A(), B(), { audience: 'marketer' });
  assert.equal(marketerOnly.readings.marketer.angle, 'segmented');
  assert.equal(marketerOnly.readings.director, undefined);

  const both = explainEntities(A(), B());
  assert.ok(both.readings.director && both.readings.marketer, 'both by default');
});

test('honest gaps: an unmeasured axis is stated, never invented', () => {
  // Identical tags + a one-sided profile -> the tags axis measures 0
  // distance and the vector axis is honestly unmeasured.
  const expl = explainEntities(
    { name: 'A', tags: [T('gothic')] },
    { name: 'B', tags: [T('gothic')], profile: { film: 0.1 } },
  );
  assert.equal(expl.band, 'kindred');
  assert.equal(expl.distancePercent, 0);
  assert.deepEqual([...expl.evidence],
    ['shared vocabulary: 1 shared of 1 union tag(s) — 0% apart']);
  assert.deepEqual([...expl.gaps],
    ['no shared domain between their profiles — the taste-vector axis is unmeasured']);
});

test('honest null: no measurable contrast -> NO fabricated readings', () => {
  const expl = explainEntities({ name: 'A' }, { name: 'B' });
  assert.equal(expl.band, null);
  assert.equal(expl.distancePercent, null);
  assert.equal(expl.headline, 'no measurable contrast between A and B');
  assert.deepEqual({ ...expl.readings }, {}, 'no readings on the null path');
  assert.equal(expl.basis, 'no measurable axis to ground a reading');
  assert.equal(expl.gaps.length, 2, 'both axes stated as unmeasured');
  const document = renderContrastExplanation(expl);
  assert.match(document, /no measurable contrast between A and B/);
  assert.ok(!/DIRECTOR \[/.test(document), 'no DIRECTOR line is rendered');
  assert.ok(!/MARKETER \[/.test(document), 'no MARKETER line is rendered');
});

test('the TypeError matrix and the render contract', () => {
  for (const bad of [null, {}, { components: [], missing: 'x' }]) {
    assert.throws(() => explainContrast(bad), TypeError, JSON.stringify(bad));
  }
  for (const badAudience of ['actor', 'PR', 42]) {
    assert.throws(() => explainContrast(
      calculateCulturalDistance(A(), B()), { audience: badAudience }
    ), TypeError, JSON.stringify(badAudience));
  }
  assert.throws(() => renderContrastExplanation({}), TypeError);

  const expl = explainEntities(A(), B());
  const document = renderContrastExplanation(expl);
  assert.match(document, /^CULTURAL CONTRAST — Static Ash Live vs Neon Ritual$/m);
  assert.match(document, /^divergent contrast \(51% measured distance\) between Static Ash Live and Neon Ritual$/m);
  assert.match(document, /^ {3}- shared vocabulary: 1 shared of 3 union tag\(s\) — 67% apart$/m);
  assert.match(document, /^ {3}- audience profile: 2 shared domain\(s\) — 40% mean deviation$/m);
  assert.match(document, /^DIRECTOR \[two worlds\]: /m);
  assert.match(document, /^MARKETER \[segmented\]: /m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');
});

test('determinism and deep-freeze', () => {
  const a = explainEntities(A(), B());
  const b = explainEntities(A(), B());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderContrastExplanation(a), renderContrastExplanation(b));
});

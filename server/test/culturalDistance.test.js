/**
 * CulturalDistance gate (task 99) — calculateCulturalDistance:
 *   - the two evidence axes (task-59 tag kinship; the per-domain
 *     affinity-profile deviation over SHARED domains) with pinned
 *     math;
 *   - the renormalized weighting (missing axes out, never zero);
 *     the honest null when nothing is comparable;
 *   - the band readout (kindred/adjacent/divergent/antipodal) at
 *     the exact boundaries;
 *   - symmetry, the weights override, the TypeError matrix;
 *   - the profileFromVector adapter (error/empty domains excluded);
 *   - determinism, deep-freeze, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'cultural-distance-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  calculateCulturalDistance, profileFromVector, bandOf,
  DISTANCE_WEIGHTS, DISTANCE_REASONS,
} = await import('../src/engine/CulturalDistance.js');

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

test('both axes: pinned tag-kinship and profile-deviation math', () => {
  const d = calculateCulturalDistance(A(), B());

  // tags: shared {gothic} of union {gothic, post-punk, techno} = 1/3
  // (equal weights, no popularity) -> kinship 0.333333 -> distance
  // 0.666667.
  const tags = d.components.find((c) => c.key === 'tags');
  assert.equal(tags.weight, DISTANCE_WEIGHTS.tags);
  assert.equal(tags.value, 1 - 0.333333);
  assert.match(tags.evidence, /1 shared of 3 union tag\(s\)/);

  // vector: |0.9-0.3| and |0.7-0.9| over the two shared domains ->
  // (0.6+0.2)/2 = 0.4.
  const vector = d.components.find((c) => c.key === 'vector');
  assert.equal(vector.value, 0.4);
  assert.equal(vector.weight, DISTANCE_WEIGHTS.vector);
  assert.match(vector.evidence, /2 shared domain\(s\)/);

  // distance = (0.4*0.666667 + 0.6*0.4) / 1.0.
  const expected = (DISTANCE_WEIGHTS.tags * (1 - 0.333333)
    + DISTANCE_WEIGHTS.vector * 0.4);
  assert.equal(d.distance, Math.round(expected * 1e12) / 1e12);
  assert.equal(d.distancePercent, 51);
  assert.equal(d.band, 'divergent');
  assert.deepEqual([...d.missing], []);
  assert.deepEqual({ ...d.between }, { a: 'Static Ash Live', b: 'Neon Ritual' });
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.components[0]));
});

test('renormalized weighting: a missing axis is out, never zero', () => {
  // No tags -> only the vector axis contributes; weight renormalizes
  // to 1.0 over the vector weight alone.
  const d = calculateCulturalDistance(
    { name: 'A', profile: { music: 0.9, fashion: 0.7 } },
    { name: 'B', profile: { music: 0.3, fashion: 0.9 } },
  );
  assert.equal(d.components.length, 1);
  assert.equal(d.distance, 0.4, 'the vector axis alone IS the distance');
  assert.deepEqual(d.missing.map((m) => [m.key, m.reason]),
    [['tags', DISTANCE_REASONS.NO_TAGS]]);
  assert.equal(d.distancePercent, 40);
  assert.equal(d.band, 'adjacent');

  // Profiles sharing no domain -> the vector axis is unmeasurable
  // (only-onesided domains contribute nothing).
  const disjoint = calculateCulturalDistance(
    { name: 'A', tags: [T('gothic')] },
    { name: 'B', tags: [T('gothic')], profile: { film: 0.1 } },
  );
  assert.deepEqual(disjoint.missing.map((m) => m.reason),
    [DISTANCE_REASONS.NO_SHARED_DOMAINS]);
  assert.equal(disjoint.distance, 0, 'identical tags, no comparable vector');
});

test('honest null: nothing comparable -> uncomputed, never faked', () => {
  const d = calculateCulturalDistance({ name: 'A' }, { name: 'B' });
  assert.equal(d.distance, null);
  assert.equal(d.distancePercent, null);
  assert.equal(d.band, null);
  assert.deepEqual(d.missing.map((m) => m.key), ['tags', 'vector']);
  assert.match(d.summary, /stays uncomputed/);
});

test('the band readout at the exact boundaries', () => {
  assert.equal(bandOf(0), 'kindred');
  assert.equal(bandOf(0.15), 'kindred');
  assert.equal(bandOf(0.2), 'adjacent', 'the boundary belongs to the upper band');
  assert.equal(bandOf(0.49), 'adjacent');
  assert.equal(bandOf(0.5), 'divergent');
  assert.equal(bandOf(0.8), 'antipodal');
  assert.equal(bandOf(1), 'antipodal');
  assert.equal(bandOf(null), null);
});

test('symmetry, weights override, and the TypeError matrix', () => {
  const ab = calculateCulturalDistance(A(), B());
  const ba = calculateCulturalDistance(B(), A());
  assert.deepEqual(JSON.parse(JSON.stringify(ab.components)),
    JSON.parse(JSON.stringify(ba.components)), 'symmetric axes');
  assert.equal(ab.distance, ba.distance, 'the metric is symmetric');

  const graphOnly = calculateCulturalDistance(A(), B(), {
    weights: { tags: 0, vector: 1 },
  });
  assert.equal(graphOnly.distance, 0.4, 'vector weight dominates');

  const tagOnly = calculateCulturalDistance(A(), B(), {
    weights: { tags: 1, vector: 0 },
  });
  assert.equal(tagOnly.distance, 1 - 0.333333);

  for (const bad of [{ tags: -1 }, { vector: Number.NaN }, { bogus: 1 }]) {
    assert.throws(() => calculateCulturalDistance(A(), B(), { weights: bad }),
      TypeError, JSON.stringify(bad));
  }
  assert.throws(() => calculateCulturalDistance(A(), B(), {
    weights: { tags: 0, vector: 0 },
  }), TypeError);
  assert.throws(() => calculateCulturalDistance(null, B()), TypeError);
  assert.throws(() => calculateCulturalDistance(A(), null), TypeError);
  assert.throws(() => calculateCulturalDistance([], B()), TypeError);
  assert.throws(() => profileFromVector(null), TypeError);
});

test('profileFromVector: error and empty domains excluded, never zero-filled', () => {
  const profile = profileFromVector({
    ok: 2, failed: 1,
    domains: [
      { domain: 'music', status: 'ok', page: { results: [{ affinity: 0.8 }, { affinity: 0.4 }] } },
      { domain: 'film', status: 'ok', page: { results: [] } },
      { domain: 'dining', status: 'error', error: { code: 'x' }, page: null },
      { domain: 'books', status: 'ok', page: { results: [{ affinity: 1 }, { name: 'no-aff' }] } },
    ],
    failures: [],
  });
  assert.deepEqual({ ...profile }, { music: 0.6, books: 1 },
    'film (empty) and dining (error) are excluded; books averages the one finite affinity');
  assert.ok(Object.isFrozen(profile));
});

test('determinism and zero-emoji purity', () => {
  const a = calculateCulturalDistance(A(), B());
  const b = calculateCulturalDistance(A(), B());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(!/\p{Extended_Pictographic}/u.test(a.summary), 'zero emojis');
  assert.ok(!/\p{Extended_Pictographic}/u.test(
    calculateCulturalDistance({ name: 'A' }, { name: 'B' }).summary
  ), 'zero emojis on the null path');
});

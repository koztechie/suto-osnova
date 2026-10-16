/**
 * AffinityScorer tests (task 59) — pins the cultural kinship index:
 * rarity-weighted Jaccard math over shared tags (reusing the task-57
 * uniqueness coefficient), the four renormalized components (reusing
 * the task-48 nameSimilarity), honest nulls for unmeasurable pairs,
 * the rarity-weighted coherence aggregate, validation and frozen
 * deterministic outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  culturalKinship,
  tagKinship,
  coherenceIndex,
  KINSHIP_WEIGHTS,
  KINSHIP_DEFAULTS,
} from '../src/engine/AffinityScorer.js';
import { uniquenessCoefficient } from '../src/engine/UniquenessCoefficient.js';
import { filterLongTail } from '../src/engine/LongTailFilter.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;

const RARE = { id: 'urn:tag:genre:media:slow_cinema', name: 'Slow Cinema', popularity: 1e-6 };
const MASS = { id: 'urn:tag:genre:media:drama', name: 'Drama', popularity: 0.9 };
const MID = { id: 'urn:tag:genre:media:noir', name: 'Noir', popularity: 0.01 };
const UNKNOWN_POP = { id: 'urn:tag:genre:media:x', name: 'X' }; // no popularity

const weightOf = (tag, rarityWeight = 0.5) =>
  1 + rarityWeight * (uniquenessCoefficient(tag.popularity ?? null).coefficient ?? 0);

test('tagKinship: identical, disjoint, and the rarity-weighted middle', () => {
  const identical = tagKinship({ tags: [RARE, MASS] }, { tags: [RARE, MASS] });
  assert.equal(identical.value, 1);
  assert.equal(identical.jaccard, 1);
  assert.equal(identical.sharedCount, 2);

  const disjoint = tagKinship({ tags: [RARE] }, { tags: [MASS] });
  assert.equal(disjoint.value, 0);
  assert.equal(disjoint.jaccard, 0);
  assert.deepEqual([...disjoint.shared], []);

  // Sharing the RARE tag proves more kinship than sharing the MASS one.
  const rareShared = tagKinship({ tags: [RARE, MID] }, { tags: [RARE] });
  const expectedRare =
    weightOf(RARE) / (weightOf(RARE) + weightOf(MID));
  assert.ok(Math.abs(rareShared.value - round6(expectedRare)) < 1e-9);

  const massShared = tagKinship({ tags: [MASS, MID] }, { tags: [MASS] });
  const expectedMass =
    weightOf(MASS) / (weightOf(MASS) + weightOf(MID));
  assert.ok(Math.abs(massShared.value - round6(expectedMass)) < 1e-9);
  assert.ok(
    rareShared.jaccard === massShared.jaccard && rareShared.value > massShared.value,
    'equal Jaccard, higher value for the rare shared tag — the whole point'
  );
});

test('tagKinship: absent when either side has no tags', () => {
  assert.equal(tagKinship({ tags: [RARE] }, {}), null);
  assert.equal(tagKinship({}, { tags: [RARE] }), null);
  assert.equal(tagKinship(null, null), null);
});

test('tagKinship: unknown popularity tags carry the honest base weight', () => {
  const withUnknown = tagKinship({ tags: [UNKNOWN_POP, MASS] }, { tags: [UNKNOWN_POP] });
  const expected = weightOf(UNKNOWN_POP) / (weightOf(UNKNOWN_POP) + weightOf(MASS));
  assert.equal(weightOf(UNKNOWN_POP), 1, 'unmeasured -> no boost');
  assert.ok(Math.abs(withUnknown.value - round6(expected)) < 1e-9);
});

test('culturalKinship: all four components, high-kinship pair', () => {
  const anchor = {
    name: 'Blade Runner',
    domain: 'film',
    tags: [RARE],
    affinity: 0.9,
  };
  const candidate = {
    name: 'Blade Runner (1982)',
    category: 'film',
    tags: [RARE],
  };

  const kinship = culturalKinship(anchor, candidate);

  assert.deepEqual(kinship.present, ['graphAffinity', 'tagKinship', 'nameResemblance', 'domainFit']);
  assert.deepEqual([...kinship.missing], []);
  assert.equal(kinship.components.graphAffinity, 0.9, 'clamp + round');
  assert.equal(kinship.components.tagKinship, 1);
  assert.ok(kinship.components.nameResemblance > 0.8, 'reused task-48 hybrid');
  assert.equal(kinship.components.domainFit, 1, 'domain vs category field');
  assert.ok(kinship.index > 0.8, 'high kinship');
  assert.ok(Object.isFrozen(kinship));
  assert.ok(Object.isFrozen(kinship.components));
});

test('renormalization: missing components never score zero', () => {
  // No tags on either side -> tag component absent, not 0.
  const noTags = culturalKinship(
    { name: 'A', affinity: 0.8, domain: 'music' },
    { name: 'B', domain: 'music' }
  );
  assert.ok(!noTags.present.includes('tagKinship'));
  assert.deepEqual([...noTags.missing], ['tagKinship']);
  assert.equal(noTags.components.nameResemblance, 0, 'dissimilar names still measurable');
  assert.ok(
    Math.abs(noTags.index - round6((0.45 * 0.8 + 0.2 * 0 + 0.1 * 1) / 0.75)) < 1e-9,
    'weighted mean over the present components only'
  );

  // A bare pair with only a name: one component.
  const bare = culturalKinship({ name: 'Dune' }, { name: 'Dune Messiah' });
  assert.deepEqual([...bare.present], ['nameResemblance']);
  assert.ok(bare.components.nameResemblance > 0.6);

  // Nothing measurable -> index null, never 0.
  const nothing = culturalKinship({}, {});
  assert.equal(nothing.index, null);
  assert.deepEqual([...nothing.present], []);
});

test('domainFit semantics: mismatch scores 0, unclassified is absent', () => {
  const mismatch = culturalKinship({ domain: 'film' }, { domain: 'music' });
  assert.equal(mismatch.components.domainFit, 0);

  const unclassified = culturalKinship({ domain: 'film' }, { category: 'not-a-domain' });
  assert.ok(!unclassified.present.includes('domainFit'));
  assert.ok(unclassified.missing.includes('domainFit'), 'absent, not zero');
});

test('affinity sources: correlation alias, clamping, pair fallback', () => {
  assert.equal(
    culturalKinship({ correlation: 0.7 }, { name: 'X' }).components.graphAffinity,
    0.7,
    'task-52 alias'
  );
  assert.equal(
    culturalKinship({ affinity: 1.5 }, {}).components.graphAffinity,
    1,
    'clamped to the [0, 1] contract'
  );
  assert.equal(
    culturalKinship({ affinity: null }, { affinity: 0.4 }).components.graphAffinity,
    0.4,
    'either side supplies the pair affinity'
  );
});

test('validation: bad weights and rarity are TypeErrors', () => {
  for (const bad of [{ weights: { bogus: 1 } }, { weights: { tagKinship: -1 } }, { rarityWeight: 1.5 }, { rarityWeight: -0.1 }]) {
    assert.throws(() => culturalKinship({ name: 'A' }, { name: 'B' }, bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => tagKinship({ tags: [RARE] }, { tags: [RARE] }, { rarityWeight: 2 }), TypeError);
  assert.equal(KINSHIP_WEIGHTS.graphAffinity, 0.45);
  assert.equal(KINSHIP_DEFAULTS.rarityWeight, 0.5);
});

test('coherenceIndex: rarity-weighted aggregate with audit pairs', () => {
  const anchor = { name: 'Blade Runner', domain: 'film', tags: [RARE] };
  const candidates = [
    { id: 'c1', name: 'Blade Runner (1982)', domain: 'film', popularity: 0.001, affinity: 0.9, tags: [RARE] }, // high kinship, rare
    { id: 'c2', name: 'Heat', domain: 'film', popularity: 0.9, affinity: 0.5, tags: [MASS] }, // lower kinship, mass
    { id: 'c3' }, // no name/domain/tags/affinity -> nothing measurable
  ];

  const result = coherenceIndex(anchor, candidates);

  assert.equal(result.count, 3);
  assert.equal(result.measured, 2);
  assert.equal(result.unmeasured, 1);
  assert.equal(result.pairs[2].index, null, 'audit keeps the unmeasured pair');
  assert.equal(result.pairs[0].weight > result.pairs[1].weight, true, 'rare candidate weighs more');
  // Rarity weighting pulls coherence ABOVE the plain mean here.
  assert.ok(result.coherence > result.mean);
  assert.ok(Math.abs(result.coherence - round6(
    (result.pairs[0].weight * result.pairs[0].index + result.pairs[1].weight * result.pairs[1].index) /
      (result.pairs[0].weight + result.pairs[1].weight)
  )) < 1e-9, 'exact weighted mean');
  assert.equal(result.min, Math.min(result.pairs[0].index, result.pairs[1].index));
  assert.equal(result.max, Math.max(result.pairs[0].index, result.pairs[1].index));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pairs));
});

test('coherenceIndex: empty and fully-unmeasurable inputs', () => {
  const empty = coherenceIndex({ name: 'A' }, []);
  assert.deepEqual(
    { coherence: empty.coherence, count: empty.count, measured: empty.measured, min: empty.min },
    { coherence: null, count: 0, measured: 0, min: null }
  );

  const unmeasurable = coherenceIndex({}, [{ name: 'X' }, { name: 'Y' }]);
  assert.equal(unmeasurable.coherence, null, 'never guessed as 0');
  assert.equal(unmeasurable.measured, 0);
});

test('determinism: identical inputs, serializable outputs', () => {
  const anchor = { name: 'Dune', domain: 'film', affinity: 0.8 };
  const candidates = [
    { name: 'Dune Messiah', domain: 'film', popularity: 0.02 },
    { name: 'Arrival', domain: 'film', popularity: 0.5, tags: [MID] },
  ];

  const run = () => ({
    pair: culturalKinship(anchor, candidates[0]),
    aggregate: coherenceIndex(anchor, candidates),
  });
  assert.deepEqual(run(), run());

  const serialized = JSON.parse(JSON.stringify(run()));
  assert.equal(typeof serialized.pair.index, 'number');
  assert.equal(serialized.aggregate.count, 2);
});

test('composition: LongTailFilter survivors feed the coherence aggregate', () => {
  const filtered = filterLongTail([
    { id: 'E1', name: 'Obscure Auteur', affinity: 0.8, popularity: 0.25 },
    { id: 'E2', name: 'Cult Deep Cut', affinity: 0.75, popularity: 0.002 },
    { id: 'E3', name: 'Blockbuster', affinity: 0.72, popularity: 0.95 },
  ]);
  assert.equal(filtered.kept.length, 2, 'the noise cut removes E3');

  const anchor = { name: 'Blade Runner', domain: 'film', affinity: 0.9 };
  const result = coherenceIndex(anchor, filtered.kept);

  assert.equal(result.measured, 2, 'kept entries are scorable pairs');
  assert.ok(result.coherence !== null);
  assert.ok(result.max >= result.min);
});

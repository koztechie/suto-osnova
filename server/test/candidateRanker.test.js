/**
 * Candidate ranker tests (task 48) — pins the statistical ranking
 * contract for ambiguous searches: the five-signal weighted score with
 * absent-signal renormalization, hybrid name similarity, graph
 * affinity outranking raw popularity, tag overlap, domain fit,
 * validated weight overrides, frozen explainable outputs and
 * deterministic tie-breaking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'candidate-ranker-test-key';

const {
  rankCandidates,
  scoreCandidate,
  nameSimilarity,
  tagOverlap,
  RANK_SIGNALS,
  DEFAULT_WEIGHTS,
} = await import('../src/services/candidateRanker.js');

const entity = (over = {}) => ({
  id: over.id ?? 'AAAAAAA1-1111-4222-8333-444455556666',
  name: over.name ?? 'Blade Runner',
  subtype: over.subtype ?? 'urn:entity:movie',
  // Explicit `undefined` must survive (the gateway drops zeroes too) —
  // only an ABSENT key gets the default.
  popularity: 'popularity' in over ? over.popularity : 0.9,
  affinity: over.affinity,
  tags: over.tags ?? [],
});

test('nameSimilarity: exact, edit-distance and token-containment hybrids', () => {
  assert.equal(nameSimilarity('blade runner', 'Blade Runner'), 1);
  // One typo out of 12 chars: ~0.917 — still strong evidence.
  const typo = nameSimilarity('blade runnr', 'Blade Runner');
  assert.ok(typo > 0.9 && typo < 1, `got ${typo}`);
  // Containment: the query's tokens all appear in the longer name.
  assert.equal(nameSimilarity('the matrix', 'The Matrix Reloaded'), 1);
  // Unrelated short strings collapse to 0.
  assert.equal(nameSimilarity('dune', 'heat'), 0);
  // Malformed inputs score 0, never throw.
  assert.equal(nameSimilarity(null, 'x'), 0);
  assert.equal(nameSimilarity('x', undefined), 0);
});

test('tagOverlap: containment fraction, null when either side is empty', () => {
  const tags = [
    { id: 'urn:tag:keyword:media:moody', name: 'Slow Burn Moody', type: 'urn:tag:keyword:media' },
    { id: 'urn:tag:keyword:media:office', name: 'Office', type: 'urn:tag:keyword:media' },
  ];
  assert.equal(tagOverlap(['moody'], tags), 1);
  assert.equal(tagOverlap(['moody', 'cozy'], tags), 0.5);
  assert.equal(tagOverlap([], tags), null, 'no query words -> signal absent');
  assert.equal(tagOverlap(['moody'], []), null, 'no tags -> signal absent');
  assert.equal(tagOverlap(['moody'], undefined), null);
  assert.equal(tagOverlap(['zzz'], tags), 0);
  // Plain string tags work too.
  assert.equal(tagOverlap(['office'], ['Office']), 1);
});

test('scoreCandidate: weighted mean over PRESENT signals (exact math)', () => {
  const { score, signals } = scoreCandidate(
    entity({ popularity: 0.8 }),
    { queryKey: 'blade runner' }
  );
  // name 1.0 @0.35 + popularity 0.8 @0.2, nothing else present.
  assert.ok(Math.abs(score - (0.35 * 1 + 0.2 * 0.8) / 0.55) < 1e-12);
  assert.deepEqual({ ...signals }, { nameSimilarity: 1, popularity: 0.8 });
});

test('scoreCandidate: graph affinity joins the mean when Qloo sent it', () => {
  const { score, signals } = scoreCandidate(
    entity({ popularity: 0.5, affinity: 0.98 }),
    { queryKey: 'blade runner' }
  );
  assert.ok(Math.abs(score - (0.35 + 0.3 * 0.98 + 0.2 * 0.5) / 0.85) < 1e-12);
  assert.equal(signals[RANK_SIGNALS.GRAPH_AFFINITY], 0.98);
});

test('scoreCandidate: domainFit is 1/0 under a hint, absent without one', () => {
  const artistEntity = { ...entity(), subtype: 'urn:entity:artist' };
  const withHint = scoreCandidate(artistEntity, {
    queryKey: 'kraftwerk',
    targetDomain: 'music',
  });
  assert.equal(withHint.signals[RANK_SIGNALS.DOMAIN], 1);

  const mismatch = scoreCandidate(artistEntity, {
    queryKey: 'kraftwerk',
    targetDomain: 'books',
  });
  assert.equal(mismatch.signals[RANK_SIGNALS.DOMAIN], 0);
  assert.ok(mismatch.score < withHint.score, 'mismatch is a penalty');

  const noHint = scoreCandidate(artistEntity, { queryKey: 'kraftwerk' });
  assert.equal(noHint.signals[RANK_SIGNALS.DOMAIN], undefined, 'signal absent');
});

test('ranking: graph affinity outranks raw popularity (the graph wins)', () => {
  const popular = entity({ id: 'AAAAAAA1-1111-4222-8333-444455556666', popularity: 0.95, affinity: 0.4 });
  const graphFavorite = entity({ id: 'BBBBBBB1-1111-4222-8333-444455556666', popularity: 0.5, affinity: 0.99 });

  const ranked = rankCandidates([popular, graphFavorite], { queryKey: 'blade runner' });

  assert.equal(ranked[0].candidate.id, graphFavorite.id, 'affinity beats popularity');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('missing data is renormalized, a zero popularity is a real zero', () => {
  const withZero = entity({ id: 'AAAAAAA1-1111-4222-8333-444455556666', popularity: 0 });
  const withoutData = entity({ id: 'BBBBBBB1-1111-4222-8333-444455556666', popularity: undefined });

  const ranked = rankCandidates([withZero, withoutData], { queryKey: 'blade runner' });

  // The zero-data candidate scores a clean 1.0 on name alone; the
  // zero-popularity candidate is honestly penalized on its 0.
  assert.equal(ranked[0].candidate.id, withoutData.id);
  assert.equal(ranked[0].score, 1);
  assert.ok(Math.abs(ranked[1].score - 0.35 / 0.55) < 1e-12);
});

test('tie-breaking is deterministic: score, popularity, name, id', () => {
  const a = entity({ id: 'AAAAAAA1-1111-4222-8333-444455556666', popularity: 0.9 });
  const b = entity({ id: 'BBBBBBB1-1111-4222-8333-444455556666', popularity: 0.9 });
  const c = entity({ id: 'CCCCCCC1-1111-4222-8333-444455556666', popularity: 0.6 });

  const ranked = rankCandidates([a, b, c], { queryKey: 'blade runner' });
  const reshuffled = rankCandidates([c, b, a], { queryKey: 'blade runner' });

  assert.equal(ranked[0].candidate.id, a.id, 'equal scores -> equal popularity -> id order');
  assert.equal(ranked[1].candidate.id, b.id);
  assert.equal(ranked[2].candidate.id, c.id);
  assert.deepEqual(
    ranked.map((r) => r.candidate.id),
    reshuffled.map((r) => r.candidate.id),
    'input order irrelevant'
  );
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('weights are an overrideable, validated contract', () => {
  const popular = entity({ id: 'AAAAAAA1-1111-4222-8333-444455556666', popularity: 0.99 });
  const named = entity({ id: 'BBBBBBB1-1111-4222-8333-444455556666', name: 'Blade Runner II', popularity: 0.1 });

  // Name-only weighting flips the winner.
  const nameOnly = rankCandidates([popular, named], { queryKey: 'blade runner ii' }, {
    weights: { nameSimilarity: 1 },
  });
  assert.equal(nameOnly[0].candidate.id, named.id);

  // Invalid overrides fail typed.
  assert.throws(
    () => rankCandidates([], { queryKey: 'x' }, { weights: { bogus: 1 } }),
    TypeError
  );
  assert.throws(
    () => rankCandidates([], { queryKey: 'x' }, { weights: { popularity: -1 } }),
    TypeError
  );
  assert.throws(
    () => rankCandidates([], { queryKey: 'x' }, { weights: { popularity: 0 } }),
    TypeError
  );
  assert.throws(() => scoreCandidate(entity(), { queryKey: 'x' }, null), TypeError);
  assert.ok(Object.isFrozen(DEFAULT_WEIGHTS));
});

test('outputs are frozen, serializable and empty-safe', () => {
  const ranked = rankCandidates([entity()], { queryKey: 'blade runner' });

  assert.ok(Object.isFrozen(ranked));
  assert.ok(Object.isFrozen(ranked[0]));
  assert.ok(Object.isFrozen(ranked[0].signals));
  assert.ok(!Object.isFrozen(ranked[0].candidate), "caller's entity object untouched");
  assert.throws(() => {
    ranked[0].score = 2;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(ranked))[0].rank, 1, 'serializable');

  assert.deepEqual(rankCandidates([], { queryKey: 'x' }), []);
  assert.deepEqual(rankCandidates(undefined, { queryKey: 'x' }), []);
});

test('determinism: identical inputs produce identical rankings', () => {
  const page = () => [
    entity({ id: 'AAAAAAA1-1111-4222-8333-444455556666', popularity: 0.7, affinity: 0.6, tags: [{ name: 'Moody' }] }),
    entity({ id: 'BBBBBBB1-1111-4222-8333-444455556666', popularity: 0.7, affinity: 0.6, tags: [{ name: 'Moody' }] }),
  ];
  const context = { queryKey: 'blade runner', queryWords: ['moody'], targetDomain: 'film' };
  assert.deepEqual(rankCandidates(page(), context), rankCandidates(page(), context));
});

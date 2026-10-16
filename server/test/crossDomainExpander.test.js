/**
 * CrossDomainExpander tests (task 49) — pins the pure cross-domain
 * taste expansion contract: deterministic planning (canonical order,
 * self-domain removal, typed rejections), tolerant row normalization,
 * self-loop removal, per-domain + global dedup, weight shares,
 * truncation, coverage reporting, global flattening, deep-frozen
 * outputs and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  expansionPlan,
  expandTastes,
  flattenExpansion,
  normalizeExpansionRow,
  ExpansionInputError,
  EXPANSION_CODES,
  EXPANSION_LIMITS,
} from '../src/engine/CrossDomainExpander.js';
import { MANDATORY_DOMAINS } from '../src/services/domainMapper.js';

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;

const row = (tag, name, affinity, over = {}) => ({
  id: UUID(tag),
  name,
  subtype: over.subtype ?? 'urn:entity:artist',
  popularity: over.popularity ?? 0.7,
  affinity,
  tags: over.tags ?? [],
});

const SEED = { id: UUID('SEED000'), category: 'film' };

test('expansionPlan: default targets are the other four domains, canonical order', () => {
  const plan = expansionPlan(SEED);

  assert.deepEqual([...plan.domains], ['music', 'books', 'dining', 'fashion']);
  assert.deepEqual({ ...plan.seed }, { id: SEED.id, domain: 'film' });
  assert.equal(plan.maxPerDomain, EXPANSION_LIMITS.DEFAULT_MAX_PER_DOMAIN);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.domains));
});

test('expansionPlan: seed shape tolerance (category/domain field, aliases)', () => {
  assert.deepEqual(
    [...expansionPlan({ id: SEED.id, domain: 'TV SHOW' }).domains],
    ['music', 'books', 'dining', 'fashion'],
    'seed domain aliases resolve'
  );
  assert.equal(expansionPlan({ id: SEED.id, domain: 'music' }).seed.domain, 'music');
});

test('expansionPlan: explicit subset keeps caller order, resolves aliases, drops self', () => {
  const plan = expansionPlan(SEED, {
    domains: ['restaurants', 'film', 'BOOKS', 'restaurants'],
  });
  assert.deepEqual([...plan.domains], ['dining', 'books'], 'dedup + self removed');
});

test('expansionPlan: typed rejections for seeds and domain selections', () => {
  assert.throws(
    () => expansionPlan({ category: 'film' }),
    (e) => e instanceof ExpansionInputError && e.code === EXPANSION_CODES.INVALID_SEED
  );
  assert.throws(
    () => expansionPlan({ id: SEED.id, category: 'blockchain' }),
    (e) =>
      e.code === EXPANSION_CODES.INVALID_SEED &&
      e.cause?.name === 'DomainMappingError'
  );
  assert.throws(
    () => expansionPlan(SEED, { domains: ['film'] }),
    (e) => e.code === EXPANSION_CODES.NO_TARGET_DOMAINS
  );
  assert.throws(
    () => expansionPlan(SEED, { domains: ['nonsense'] }),
    (e) => e.code === EXPANSION_CODES.NO_TARGET_DOMAINS && e.cause?.name === 'DomainMappingError'
  );
  assert.throws(
    () => expansionPlan(SEED, { domains: [] }),
    (e) => e.code === EXPANSION_CODES.NO_TARGET_DOMAINS
  );
  assert.throws(
    () => expansionPlan(SEED, { maxPerDomain: Infinity }),
    (e) => e.code === EXPANSION_CODES.INVALID_PLAN
  );
});

test('expansionPlan: maxPerDomain is clamped to 1..50', () => {
  assert.equal(expansionPlan(SEED, { maxPerDomain: 0 }).maxPerDomain, 1);
  assert.equal(expansionPlan(SEED, { maxPerDomain: 999 }).maxPerDomain, 50);
  assert.equal(expansionPlan(SEED, { maxPerDomain: 3.9 }).maxPerDomain, 3);
});

test('expansionPlan: includeSeedDomain keeps the source domain in the vector (task 50)', () => {
  const plan = expansionPlan(SEED, { includeSeedDomain: true });
  assert.deepEqual([...plan.domains], [...MANDATORY_DOMAINS], 'all five, canonical order');

  // The flag also governs explicit subsets.
  const subset = expansionPlan(SEED, {
    domains: ['film', 'music'],
    includeSeedDomain: true,
  });
  assert.deepEqual([...subset.domains], ['film', 'music']);

  // Default remains cross-only (task 49 contract untouched).
  assert.ok(!expansionPlan(SEED).domains.includes('film'));
});

test('expandTastes: happy path — ordering, weight shares, self and invalid drops', () => {
  const plan = expansionPlan(SEED, { domains: ['music', 'books'] });

  const musicPage = {
    results: [
      row('MUSIC01', 'Blade Runner OST', 0.2),
      row('MUSIC02', 'Vangelis', 0.8),
      { id: SEED.id, name: 'Self Loop', affinity: 0.99 }, // seed must drop
      { name: 'No Id Here', affinity: 0.5 }, // malformed -> droppedInvalid
      'not-an-object', // malformed
    ],
  };
  const booksRows = [
    { entity_id: UUID('BOOK001'), name: 'Do Androids Dream', query: { affinity: 0.6 } },
  ];

  const expansion = expandTastes(plan, { music: musicPage, books: booksRows });

  const music = expansion.domains[0];
  assert.equal(music.domain, 'music');
  assert.equal(music.count, 2);
  assert.deepEqual(
    music.entities.map((e) => e.name),
    ['Vangelis', 'Blade Runner OST'],
    'affinity desc'
  );
  assert.equal(music.entities[0].rank, 1);
  assert.equal(music.entities[0].affinity, 0.8);
  assert.ok(Math.abs(music.entities[0].weight - 0.8) < 1e-12, 'share of affinity mass');
  assert.ok(Math.abs(music.entities[1].weight - 0.2) < 1e-12);

  const books = expansion.domains[1];
  assert.equal(books.entities[0].id, UUID('BOOK001'), 'raw Qloo shape accepted');
  assert.equal(books.entities[0].affinity, 0.6);

  assert.deepEqual({ ...expansion.coverage }, { planned: 2, covered: 2, uncovered: [] });
  assert.deepEqual(
    { ...expansion.totals },
    { entities: 3, duplicates: 0, droppedSelf: 1, droppedInvalid: 2, truncatedDomains: 0, unplannedPayloads: 0 }
  );
});

test('expandTastes: an entity reached via two domains is kept ONCE (first domain wins)', () => {
  const plan = expansionPlan(SEED, { domains: ['music', 'books'] });
  const shared = row('SHARED', '跨界 Entity', 0.5, { subtype: 'urn:entity:book' });

  const expansion = expandTastes(plan, {
    music: [shared],
    books: [{ ...shared, affinity: 0.9 }],
  });

  assert.equal(expansion.domains[0].count, 1, 'music (canonical first) keeps it');
  assert.equal(expansion.domains[1].count, 0, 'books sees it as a duplicate');
  assert.equal(expansion.totals.duplicates, 1);
  assert.deepEqual([...expansion.coverage.uncovered], ['books']);

  const flat = flattenExpansion(expansion);
  assert.equal(flat.length, 1, 'no double counting downstream');
  assert.equal(flat[0].domain, 'music');
});

test('expandTastes: coverage reports missing domains explicitly', () => {
  const plan = expansionPlan(SEED, { domains: ['music', 'books', 'dining'] });
  const expansion = expandTastes(plan, { music: [row('M0', 'Artist', 0.5)] });

  assert.deepEqual({ ...expansion.coverage }, {
    planned: 3,
    covered: 1,
    uncovered: ['books', 'dining'],
  });
  assert.equal(expansion.domains[1].count, 0, 'unplanned domain still present, empty');
  assert.equal(expansion.totals.unplannedPayloads, 0);
  // Extra payloads outside the plan are counted, not silently absorbed.
  const extra = expandTastes(plan, { music: [], fashion: [row('F0', 'Brand', 0.4)] });
  assert.equal(extra.totals.unplannedPayloads, 1);
});

test('expandTastes: truncation flags a capped domain', () => {
  const plan = expansionPlan(SEED, { domains: ['music'], maxPerDomain: 2 });
  const page = [
    row('M1', 'A', 0.9),
    row('M2', 'B', 0.8),
    row('M3', 'C', 0.7),
  ];
  const expansion = expandTastes(plan, { music: page });

  assert.equal(expansion.domains[0].count, 2);
  assert.equal(expansion.domains[0].truncated, true);
  assert.equal(expansion.totals.truncatedDomains, 1);
  assert.equal(expansion.domains[0].entities[1].name, 'B', 'lowest eligible survives the cap');
});

test('expandTastes: missing affinities rank last with weight 0, never NaN', () => {
  const plan = expansionPlan(SEED, { domains: ['music'] });
  const page = [
    row('M1', 'No Affinity', null, { subtype: 'urn:entity:artist' }),
    row('M2', 'Scored', 0.4),
  ];
  const expansion = expandTastes(plan, { music: page });

  const [scored, unscored] = expansion.domains[0].entities;
  assert.equal(scored.name, 'Scored');
  assert.equal(unscored.affinity, null, 'kept, visible');
  assert.equal(unscored.weight, 0);

  // All-null page: every weight is 0 (no division blowups).
  const allNull = expandTastes(plan, {
    music: [row('M1', 'X', null), row('M2', 'Y', null)],
  });
  assert.ok(allNull.domains[0].entities.every((e) => e.weight === 0));
  assert.ok(!Number.isNaN(allNull.domains[0].entities[0].rank));
});

test('expandTastes: input row order does not affect the output', () => {
  const plan = expansionPlan(SEED, { domains: ['music'] });
  const page = () => [
    row('M1', 'Alpha', 0.5),
    row('M2', 'Beta', 0.9),
    row('M3', 'Gamma', 0.7),
  ];

  assert.deepEqual(
    expandTastes(plan, { music: page() }),
    expandTastes(plan, { music: [...page()].reverse() }),
    'sorting is canonical, not input-preserving'
  );
});

test('flattenExpansion: one global list, weight desc, domain + globalRank attached', () => {
  const plan = expansionPlan(SEED, { domains: ['music', 'books'] });
  const expansion = expandTastes(plan, {
    music: [row('M1', 'Low', 0.1)],
    books: [row('B1', 'High', 0.9), row('B2', 'Mid', 0.5)],
  });

  const flat = flattenExpansion(expansion);
  // Weights are per-domain SHARES: a single-entity domain has share
  // 1.0, so it leads the global list (documented semantics).
  assert.deepEqual(flat.map((e) => e.name), ['Low', 'High', 'Mid']);
  assert.deepEqual(flat.map((e) => e.globalRank), [1, 2, 3]);
  assert.deepEqual(flat.map((e) => e.domain), ['music', 'books', 'books']);
  assert.ok(Math.abs(flat[1].weight - 0.9 / 1.4) < 1e-12, 'share within books');
  assert.ok(Object.isFrozen(flat));
  assert.ok(Object.isFrozen(flat[0]));

  assert.throws(() => flattenExpansion({}), (e) => e instanceof ExpansionInputError);
  assert.throws(() => flattenExpansion(null), (e) => e instanceof ExpansionInputError);
});

test('outputs are deeply frozen and JSON serializable', () => {
  const plan = expansionPlan(SEED, { domains: ['music'] });
  const expansion = expandTastes(plan, {
    music: [row('M1', 'Tagged', 0.5, { tags: [{ id: 'urn:tag:x:y', name: 'Y', type: 'urn:tag:x' }] })],
  });

  assert.ok(Object.isFrozen(expansion));
  assert.ok(Object.isFrozen(expansion.domains));
  assert.ok(Object.isFrozen(expansion.domains[0].entities));
  assert.ok(Object.isFrozen(expansion.domains[0].entities[0].tags));
  assert.throws(() => {
    expansion.domains[0].entities[0].weight = 1;
  }, TypeError);
  const round = JSON.parse(JSON.stringify(expansion));
  assert.equal(round.domains[0].entities[0].name, 'Tagged');
});

test('determinism: identical inputs produce identical records', () => {
  const run = () => {
    const plan = expansionPlan(SEED);
    return expandTastes(plan, {
      music: [row('M1', 'A', 0.3), row('M2', 'B', 0.6)],
      books: [row('B1', 'C', 0.4)],
      dining: [],
      fashion: [row('F1', 'D', 0.2)],
    });
  };
  assert.deepEqual(run(), run());
});

test('normalizeExpansionRow: client shape, raw shape, garbage', () => {
  const client = normalizeExpansionRow(row('C1', 'Client Shape', 0.42));
  assert.equal(client.affinity, 0.42);
  assert.equal(client.subtype, 'urn:entity:artist');

  const raw = normalizeExpansionRow({
    entity_id: UUID('R1'),
    name: 'Raw Shape',
    query: { affinity: 0.17 },
    tags: [{ tag_id: 'urn:tag:k:v', name: 'V', type: 'urn:tag:k' }],
  });
  assert.equal(raw.id, UUID('R1'));
  assert.equal(raw.affinity, 0.17);
  assert.deepEqual({ ...raw.tags[0] }, { id: 'urn:tag:k:v', name: 'V', type: 'urn:tag:k' });

  assert.equal(normalizeExpansionRow(null), null);
  assert.equal(normalizeExpansionRow('x'), null);
  assert.equal(normalizeExpansionRow({ name: 'No Id' }), null);
  assert.equal(normalizeExpansionRow({ id: 'x' }), null);
  assert.equal(normalizeExpansionRow([1]), null);
});

/**
 * BrandPartners gate (task 91) — partner brand selection for
 * sponsorship zones + the merch direction:
 *   - the composite (audience / graph / style kinship) with pinned
 *     score math, tier logic, brandVerified honesty;
 *   - MERCH_MAP pinned entry by entry + the explicit-only baseline;
 *   - the minScore gate, weight contracts, TypeError matrix;
 *   - the adapter over a REAL runExperiential bundle;
 *   - rendering, determinism, deep-freeze.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'brand-partners-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  selectBrandPartners, piecesFromActivationBundle, renderBrandPartners,
  MERCH_MAP, BASELINE_MERCH, BRAND_REASONS, BRAND_TIERS,
} = await import('../src/modes/BrandPartners.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { searchStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const T = (name) => ({ name });

const pieces = () => ({
  audienceRows: [
    { name: 'Iron Atelier', affinity: 0.9, subtype: 'urn:entity:brand' },
    { name: 'Chrome Works', affinity: 0.7 },
    { name: 'Mystery Signal', affinity: 0.8 },
    { name: 'Zero Evidence', affinity: null },
  ],
  graphBrands: [
    { name: 'Iron Atelier', subtype: 'urn:entity:brand', affinity: 0.88, tags: [T('Gothic')] },
    { name: 'Ash Couture', subtype: 'urn:entity:brand', affinity: 0.74, tags: [T('Post-Punk')] },
    { name: 'Empty Signal', subtype: 'urn:entity:brand', affinity: 0.5, tags: [] },
  ],
  styleMarkers: ['Gothic', 'Post-Punk'],
});

test('composite: pinned scores, tiers, brandVerified honesty', () => {
  const block = selectBrandPartners(pieces());

  assert.deepEqual(block.brands.map((b) => b.name),
    ['Iron Atelier', 'Mystery Signal', 'Chrome Works', 'Ash Couture', 'Empty Signal']);

  const iron = block.brands[0];
  assert.equal(iron.tier, BRAND_TIERS.DUAL);
  assert.equal(iron.brandVerified, true);
  assert.equal(iron.components.style, 0.5, 'Gothic shared of Gothic+Post-Punk union');
  assert.equal(iron.score,
    Math.round((0.5 * 0.9 + 0.35 * 0.88 + 0.15 * 0.5) * 1e12) / 1e12, 'all three signals');

  const chrome = block.brands.find((b) => b.name === 'Chrome Works');
  assert.equal(chrome.tier, BRAND_TIERS.AUDIENCE);
  assert.equal(chrome.brandVerified, false, 'no subtype -> honestly unverified');
  assert.equal(chrome.score, 0.7);

  const mystery = block.brands.find((b) => b.name === 'Mystery Signal');
  assert.equal(mystery.score, 0.8, 'audience signal alone keeps full value');

  const ash = block.brands.find((b) => b.name === 'Ash Couture');
  assert.equal(ash.tier, BRAND_TIERS.GRAPH);
  assert.equal(ash.score, Math.round(((0.35 * 0.74 + 0.15 * 0.5) / 0.5) * 1e12) / 1e12,
    'graph+style renormalized');

  assert.deepEqual(block.rejected.map((r) => [r.name, r.reason]), [
    ['Zero Evidence', BRAND_REASONS.NO_EVIDENCE],
  ]);
  assert.equal(block.stats.dual, 1);
  assert.equal(block.stats.verified, 3, 'Iron Atelier + Ash Couture + Empty Signal');
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.brands[0]));
});

test('merch: marker-mapped lines with provenance', () => {
  const block = selectBrandPartners(pieces());
  assert.deepEqual(block.merch.items.map((i) => i.name), [
    'black tees', 'silver rings', 'velvet pouches',
    'enamel pins', 'screen-printed tees', 'silver chains',
  ]);
  assert.deepEqual(block.merch.items.map((i) => i.source.marker),
    ['Gothic', 'Gothic', 'Gothic', 'Post-Punk', 'Post-Punk', 'Post-Punk']);
  assert.match(block.merch.summary, /6 merch line\(s\) from 2 style marker\(s\)\./);

  // The baseline ships ONLY on explicit request.
  const withBaseline = selectBrandPartners(pieces(), { baseline: true, merchLimit: 20 });
  const baselineNames = withBaseline.merch.items
    .filter((i) => i.source.kind === 'baseline').map((i) => i.name);
  assert.deepEqual(baselineNames, [...BASELINE_MERCH]);
  assert.ok(!block.merch.items.some((i) => i.source.kind === 'baseline'),
    'default run stays evidence-only');
});

test('MERCH_MAP: pinned entry by entry', () => {
  for (const [marker, products] of Object.entries(MERCH_MAP)) {
    const block = selectBrandPartners({ graphBrands: [], audienceRows: [], styleMarkers: [marker] });
    assert.deepEqual(block.merch.items.map((i) => i.name), [...products], `MERCH_MAP[${marker}]`);
    assert.equal(block.merch.items[0].source.marker, marker);
  }
});

test('gates and weight contracts', () => {
  const gated = selectBrandPartners(pieces(), { minScore: 0.7 });
  assert.ok(!gated.brands.some((b) => b.name === 'Ash Couture'), '0.668 < 0.7');
  assert.ok(!gated.brands.some((b) => b.name === 'Empty Signal'));
  assert.ok(!gated.brands.some((b) => b.name === 'Zero Evidence'), 'still no evidence');
  assert.deepEqual(gated.rejected.map((r) => r.reason).sort(), [
    BRAND_REASONS.BELOW_MIN_SCORE, BRAND_REASONS.BELOW_MIN_SCORE, BRAND_REASONS.NO_EVIDENCE,
  ]);

  const graphOnly = selectBrandPartners(pieces(), {
    weights: { audience: 0, graph: 1, style: 0 },
  });
  assert.deepEqual(graphOnly.brands.map((b) => b.score), [0.88, 0.74, 0.5],
    'graph weight dominates in graph order');

  for (const bad of [{ maxBrands: 0 }, { merchLimit: 51 }, { minScore: 2 },
    { weights: { audience: -1 } }, { weights: { bogus: 1 } }]) {
    assert.throws(() => selectBrandPartners(pieces(), bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => selectBrandPartners(pieces(), {
    weights: { audience: 0, graph: 0, style: 0 },
  }), TypeError);
  assert.throws(() => selectBrandPartners(null), TypeError);
});

test('adapter: a REAL activation bundle feeds the selection end to end', async () => {
  // Distinct ids per domain (the shared runner stub reuses ids across
  // domains, and expandTastes dedups globally — fashion would vanish).
  const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
  const brandRow = (name, i, extra = {}) => ({
    id: UUID(`f${i}00000`), name, subtype: 'urn:entity:brand',
    affinity: 0.9 - i * 0.05, popularity: 0.4,
    tags: [{ id: 'urn:tag:genre:fashion:gothic', name: 'Gothic', type: 'urn:tag:genre:fashion' }],
    ...extra,
  });
  const brandAffinity = async (ids, domain) => {
    if (domain === 'fashion') {
      return { results: [brandRow('Iron Atelier', 0), brandRow('Chrome Works', 1)] };
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
      results: [{ name: 'Iron Atelier', affinity: 0.6 }],
    }),
    synthesis: false,
    cutRate: 0,
  });

  const adapted = piecesFromActivationBundle(bundle);
  assert.equal(adapted.graphBrands.length, 2, 'the fashion-domain picks');
  assert.equal(adapted.graphBrands[0].subtype, 'urn:entity:brand', 'Qloo subtype kept');
  assert.equal(adapted.audienceRows[0].affinity, 0.6, 'affinityPercent -> affinity');
  assert.equal(adapted.audienceRows[0].subtype, null,
    'the task-88 row carries no subtype — honestly unverified');
  assert.ok(adapted.styleMarkers.includes('Gothic'), 'fashion tags feed style markers');

  const block = selectBrandPartners(adapted);
  const iron = block.brands.find((b) => b.name === 'Iron Atelier');
  assert.ok(iron, 'the audience-tested brand is selected');
  assert.equal(iron.tier, 'dual', 'audience + graph evidence');
  assert.ok(!/\p{Extended_Pictographic}/u.test(renderBrandPartners(block)), 'zero emojis');
});

test('rendering, determinism and the TypeError matrix', () => {
  const block = selectBrandPartners(pieces());
  const document = renderBrandPartners(block);
  assert.match(document, /^BRAND PARTNERS \(sponsorship & merch\)$/m);
  assert.match(document, /^ {3}- Iron Atelier \[dual, verified brand\] — 88%$/m);
  assert.match(document, /^ {3}- Chrome Works \[audience_brand\] — 70%$/m,
    'unverified row carries no brand claim');
  assert.match(document, /^MERCH DIRECTION:$/m);
  assert.match(document, /^ {3}- black tees \(from marker "Gothic"\)$/m);

  const empty = renderBrandPartners(selectBrandPartners({
    graphBrands: [], audienceRows: [], styleMarkers: [],
  }));
  assert.match(empty, /no brand with measurable audience evidence/);
  assert.match(empty, /merch line stays generic/);

  const a = selectBrandPartners(pieces());
  const b = selectBrandPartners(pieces());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderBrandPartners(a), renderBrandPartners(b));

  assert.throws(() => renderBrandPartners({}), TypeError);
  assert.throws(() => piecesFromActivationBundle(null), TypeError);
});

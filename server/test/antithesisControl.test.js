/**
 * Mainstream Pop Icon — the Mode 3 CONTROL TEST SET (task 110): a
 * golden end-to-end scenario for the TASTE ANTITHESIS ENGINE.
 *
 * A self-contained, deterministic fixture universe stands in for the
 * Qloo graph (zero network): a MAINSTREAM pop anchor whose taste
 * graph contains, per domain, a high-affinity hero (the protagonist's
 * own taste / fingerprint), a ZERO-affinity broad-popularity pick (the
 * proven antithesis — conscious cultural dissonance), and one
 * low-affinity OBSCURE pick (graph noise, cut by the task-96
 * dissonance filter). The REAL runAntithesis runs against it, and the
 * test pins the engine contract: the lowest_correlation strategy with
 * the honest null thresholds, the per-domain blindspot MATRIX leading
 * with the zero-affinity antithesis, the conflict drivers, the
 * protagonist fingerprint (the contrast), the noise filtration, the
 * terminal FSM lifecycle, determinism, and the formatted document.
 *
 * The fixture encodes the live-verified domain-mapping contracts
 * (music=artist; books=book; film=movie; fashion=brand + the fashion
 * tag family; dining=place + the restaurant tag family) and
 * per-domain DISTINCT UUIDs (expandTastes dedups globally).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'antithesis-control-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runAntithesis, ANTITHESIS_TIERS } = await import('../src/modes/AntithesisMode.js');
const { MODE_ANTITHESIS, SELECTION_STRATEGIES } = await import('../src/engine/ModeDispatcher.js');
const { DISSONANCE_REASONS } = await import('../src/engine/DissonanceFilter.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { ENTITY_ID, buildProvenanceTable } = await import('../src/formatters/ProvenanceTable.js');
const { formatDossier } = await import('../src/formatters/DossierFormatter.js');

const SEED = 'Mainstream Pop Icon';

// --- the deterministic mainstream-vs-antithesis fixture universe --------------
const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const T = (id, name, type) => ({ id, name, type });
const ANCHOR = {
  id: UUID('e00e0000'), name: SEED, subtype: 'urn:entity:artist', popularity: 0.9,
  tags: [T('urn:tag:genre:music:pop', 'Pop', 'urn:tag:genre:music')],
};
const SUB = {
  music: 'urn:entity:artist', books: 'urn:entity:book', fashion: 'urn:entity:brand',
  dining: 'urn:entity:place', film: 'urn:entity:movie',
};
const BASE = { music: 1, books: 2, fashion: 3, dining: 4, film: 5 };
const TAGS = {
  music: [T('urn:tag:genre:music:pop', 'Pop', 'urn:tag:genre:music')],
  books: [T('urn:tag:genre:media:fiction', 'Fiction', 'urn:tag:genre:media')],
  fashion: [T('urn:tag:genre:brand:fashion', 'Fashion', 'urn:tag:genre:brand')],
  dining: [T('urn:tag:genre:place:restaurant', 'Restaurant', 'urn:tag:genre:place')],
  film: [T('urn:tag:genre:media:horror', 'Horror', 'urn:tag:genre:media')],
};
// [name, affinity, popularity] — hero / zero-antithesis / obscure-noise
const UNIVERSE = {
  music: [['Chart Darling', 0.95, 0.9], ['Concrete Drone', 0, 0.7], ['Faint Hum', 0.05, 0.01]],
  books: [['Bestseller Now', 0.92, 0.85], ['Samizdat Edge', 0, 0.65]],
  fashion: [['Mall Brand', 0.9, 0.8], ['Razor Couture', 0, 0.7]],
  dining: [['Chain Bistro', 0.88, 0.75], ['Crypt Kitchen', 0, 0.6]],
  film: [['Blockbuster Hit', 0.93, 0.9], ['Silent Reel', 0, 0.6]],
};

const affinityFn = async (ids, dom) => {
  const key = String(dom);
  let k = key;
  if (key.includes('artist')) k = 'music';
  else if (key.includes('book')) k = 'books';
  else if (key.includes('brand')) k = 'fashion';
  else if (key.includes('place')) k = 'dining';
  else if (key.includes('movie')) k = 'film';
  const rows = UNIVERSE[k] ?? UNIVERSE.music;
  return {
    results: rows.map(([name, affinity, popularity], i) => ({
      id: UUID(`${BASE[k]}${i}0000`), name, subtype: SUB[k], affinity, popularity, tags: TAGS[k],
    })),
  };
};
const searchStub = async () => ({ results: [ANCHOR] });
const tagsFn = async () => ({ results: TAGS.music });
const searchFn = async () => ({ results: [] });

const options = () => ({
  affinityFn, search: searchStub, searchFn, tagsFn, synthesis: false,
});

// --- the pinned golden antithesis contract ------------------------------------

test('anchor: the mainstream icon resolves across five domains', async () => {
  const bundle = await runAntithesis(SEED, options());
  assert.equal(bundle.mode, MODE_ANTITHESIS);
  assert.equal(bundle.output, 'cultural_blindspot_report');
  assert.equal(bundle.entity.name, SEED);
  assert.equal(bundle.entity.category, 'music');
  assert.equal(bundle.entity.id, UUID('e00e0000'));
  assert.ok(ENTITY_ID.test(bundle.entity.id));
  assert.deepEqual([...bundle.expansion.domains],
    ['film', 'music', 'books', 'dining', 'fashion']);
  assert.equal(bundle.expansion.candidates, 11);
});

test('the selection: lowest_correlation with the honest null thresholds', async () => {
  const bundle = await runAntithesis(SEED, options());
  assert.equal(bundle.selection.strategy, SELECTION_STRATEGIES.LOWEST_CORRELATION);
  assert.equal(bundle.selection.thresholds, null,
    'the plan honest null: nothing is accepted on affinity in Mode 3');
  assert.equal(bundle.selection.measurable, 11);
  assert.equal(bundle.selection.unmeasurable, 0);
});

test('the blindspot matrix: each domain LEADS with the zero-affinity antithesis', async () => {
  const bundle = await runAntithesis(SEED, options());
  const matrix = bundle.antithesis.matrix;
  assert.deepEqual(matrix.map((z) => [z.domain, z.entries.map((e) => [e.name, e.tier])]), [
    ['film', [['Silent Reel', ANTITHESIS_TIERS.ZERO_AFFINITY], ['Blockbuster Hit', ANTITHESIS_TIERS.LOWEST_CORRELATION]]],
    ['music', [['Concrete Drone', ANTITHESIS_TIERS.ZERO_AFFINITY], ['Chart Darling', ANTITHESIS_TIERS.LOWEST_CORRELATION]]],
    ['books', [['Samizdat Edge', ANTITHESIS_TIERS.ZERO_AFFINITY], ['Bestseller Now', ANTITHESIS_TIERS.LOWEST_CORRELATION]]],
    ['dining', [['Crypt Kitchen', ANTITHESIS_TIERS.ZERO_AFFINITY], ['Chain Bistro', ANTITHESIS_TIERS.LOWEST_CORRELATION]]],
    ['fashion', [['Razor Couture', ANTITHESIS_TIERS.ZERO_AFFINITY], ['Mall Brand', ANTITHESIS_TIERS.LOWEST_CORRELATION]]],
  ], 'the proven zero correlation leads; the hero is the honest weakest-divergence tail');
  // The protagonist fingerprint is the CONTRAST: the hero per domain.
  assert.deepEqual(bundle.antithesis.protagonist.fingerprint.map((f) => [f.domain, f.name]), [
    ['film', 'Blockbuster Hit'], ['music', 'Chart Darling'], ['books', 'Bestseller Now'],
    ['dining', 'Chain Bistro'], ['fashion', 'Mall Brand'],
  ]);
});

test('conflict drivers: the strongest divergences are the zero-affinity picks', async () => {
  const bundle = await runAntithesis(SEED, options());
  assert.deepEqual(bundle.antithesis.conflictDrivers.map((e) => e.name), [
    'Concrete Drone', 'Razor Couture', 'Samizdat Edge', 'Crypt Kitchen', 'Silent Reel',
  ], '100% divergence, popularity then name tiebreaks');
  assert.equal(bundle.antithesis.stats.zeroAffinity, 5);
});

test('noise filtration: the obscure pick is cut, not staged', async () => {
  const bundle = await runAntithesis(SEED, options());
  const cut = bundle.antithesis.dissonance.cut;
  assert.deepEqual(cut.map((c) => [c.name, c.reason]),
    [['Faint Hum', DISSONANCE_REASONS.OBSCURE_UNPROVEN]],
  'low affinity + obscure popularity is graph noise, not opposition');
  assert.equal(bundle.antithesis.stats.noiseCut, 1);
  assert.equal(bundle.antithesis.stats.selected, 10);
  assert.ok(!bundle.antithesis.matrix.some((z) => z.entries.some((e) => e.name === 'Faint Hum')),
    'the noise never reaches the matrix');
});

test('lifecycle: DELIVERED/COMPLETED, unpersisted', async () => {
  const bundle = await runAntithesis(SEED, options());
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.equal(bundle.session.execution.step, 11);
  assert.equal(bundle.session.id, null, 'no baseDir -> no persistence');
});

test('determinism and zero-emoji purity', async () => {
  const a = await runAntithesis(SEED, options());
  const b = await runAntithesis(SEED, options());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(a)), 'zero emojis');
});

test('the document: blindspot report, verifiable sources, privacy', async () => {
  const bundle = await runAntithesis(SEED, options());
  const doc = formatDossier(bundle);
  for (const id of ['blindspot', 'sources', 'privacy']) {
    assert.ok(doc.sectionIndex.includes(id), `the ${id} section is present`);
  }
  assert.equal(doc.sectionIndex[doc.sectionIndex.length - 1], 'privacy', 'privacy closes');

  // The provenance table verifies the entities against Qloo.
  const table = buildProvenanceTable(bundle);
  assert.ok(table.stats.verified >= 6, 'the anchor + the blindspot picks are UUID-verified');
  assert.ok(table.entities.some((r) => r.name === SEED && r.verifiable));
  assert.ok(!table.entities.some((r) => r.id && r.id.startsWith('urn:')), 'no urn: leakage');
});

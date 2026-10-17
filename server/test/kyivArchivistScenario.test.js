/**
 * Kyiv Underground Archivist — the Mode 1 CONTROL TEST SET (task
 * 108): a golden end-to-end scenario for a named character dossier.
 *
 * A self-contained, deterministic fixture universe stands in for the
 * Qloo graph (zero network): the character concept "Kyiv Underground
 * Archivist" resolves to a Kyiv-underground MUSIC artist anchor, and
 * the taste graph expands across all five agent domains with
 * Kyiv-flavored entities (Podil Echo, Samizdat Nights, Black Podil
 * Atelier, Krypta Bar, Kyiv Nocturne ...). The REAL runWorldbuilder
 * runs against it, and the test pins the full dossier contract:
 * anchor resolution, the five-domain expansion, the monotonically
 * narrowing chain, the pinned non-obvious RANKED order (with the
 * 2000s-Kyiv scene bias applied), all five extracted layers, the
 * terminal FSM lifecycle, determinism, and the formatted/printed
 * document (verifiable DATA SOURCES + the PRIVACY NOTICE).
 *
 * The fixture encodes the live-verified domain-mapping contracts:
 * music=artist, books=book, film=movie map directly; dining=place
 * CARRIED BY the restaurant tag family; fashion=brand CARRIED BY the
 * fashion tag family — and per-domain DISTINCT UUIDs (expandTastes
 * dedups globally, so reused ids would collapse the domains).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'kyiv-archivist-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { MODE_WORLDBUILDER } = await import('../src/engine/ModeDispatcher.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { ENTITY_ID } = await import('../src/formatters/ProvenanceTable.js');
const { formatDossier } = await import('../src/formatters/DossierFormatter.js');
const { exportHtml } = await import('../src/formatters/HtmlPrintFormatter.js');
const { buildProvenanceTable } = await import('../src/formatters/ProvenanceTable.js');

const SEED = 'Kyiv Underground Archivist';

// --- the deterministic Kyiv-underground fixture universe ----------------------
const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const T = (id, name, type) => ({ id, name, type });
const ANCHOR = {
  id: UUID('abcd0000'), name: SEED, subtype: 'urn:entity:artist', popularity: 0.55,
  tags: [T('urn:tag:genre:music:gothic', 'Gothic', 'urn:tag:genre:music'),
    T('urn:tag:genre:music:postpunk', 'Post-Punk', 'urn:tag:genre:music')],
};
const SUB = {
  music: 'urn:entity:artist', books: 'urn:entity:book', fashion: 'urn:entity:brand',
  dining: 'urn:entity:place', film: 'urn:entity:movie',
};
const BASE = { music: 1, books: 2, fashion: 3, dining: 4, film: 5 };
const TAGS = {
  music: [T('urn:tag:genre:music:gothic', 'Gothic', 'urn:tag:genre:music'),
    T('urn:tag:genre:music:postpunk', 'Post-Punk', 'urn:tag:genre:music')],
  books: [T('urn:tag:genre:media:fiction', 'Fiction', 'urn:tag:genre:media')],
  fashion: [T('urn:tag:genre:brand:fashion', 'Fashion', 'urn:tag:genre:brand')],
  dining: [T('urn:tag:genre:place:restaurant', 'Restaurant', 'urn:tag:genre:place')],
  film: [T('urn:tag:genre:media:horror', 'Horror', 'urn:tag:genre:media')],
};
// [name, affinity, popularity]
const UNIVERSE = {
  music: [['Podil Echo', 0.93, 0.4], ['Khreshchatyk Static', 0.9, 0.35], ['Obolon Drone', 0.88, 0.3]],
  books: [['Samizdat Nights', 0.9, 0.3], ['Underground Almanac', 0.86, 0.25]],
  fashion: [['Black Podil Atelier', 0.91, 0.35], ['Brutalist Kyiv', 0.87, 0.3]],
  dining: [['Krypta Bar', 0.9, 0.3], ['Speakeasy Podil', 0.85, 0.25]],
  film: [['Kyiv Nocturne', 0.89, 0.35], ['Babel Requiem', 0.85, 0.3]],
};
const ALL_NAMES = Object.values(UNIVERSE).flat().map(([n]) => n);

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
  affinityFn,
  search: searchStub,
  searchFn,
  tagsFn,
  synthesis: false,
  scene: { era: '2000s', location: 'Kyiv' },
});

// --- the pinned golden contract ----------------------------------------------

test('anchor: the character resolves to the Kyiv underground artist + scene', async () => {
  const bundle = await runWorldbuilder(SEED, options());

  assert.equal(bundle.mode, MODE_WORLDBUILDER);
  assert.equal(bundle.entity.name, SEED);
  assert.equal(bundle.entity.category, 'music');
  assert.equal(bundle.entity.id, UUID('abcd0000'));
  assert.ok(ENTITY_ID.test(bundle.entity.id), 'the anchor id is a Qloo UUID');
  assert.equal(bundle.seed.normalized, SEED);
  assert.ok(['direct_title', 'person', 'aesthetic_description'].includes(bundle.seed.format));
  assert.ok(['high', 'medium', 'low'].includes(bundle.seed.confidence));
  // The 2000s-Kyiv scene context is fixed on the bundle.
  assert.equal(bundle.scene.era, '2000s');
  assert.equal(bundle.scene.location, 'Kyiv');
});

test('expansion: all five agent domains, the full Kyiv universe', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  assert.deepEqual([...bundle.expansion.domains],
    ['film', 'music', 'books', 'dining', 'fashion']);
  assert.equal(bundle.expansion.candidates, 11, '3 music + 2 each of the rest');
});

test('chain: monotonically narrowing, honestly counted', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  const { threshold, longTail, cliches, ranked } = bundle.chain;
  assert.equal(threshold.input, bundle.expansion.candidates);
  assert.ok(threshold.kept + threshold.rejected === threshold.input);
  assert.ok(longTail.input === threshold.kept);
  assert.ok(longTail.kept <= longTail.input);
  assert.ok(cliches.kept <= longTail.kept);
  assert.equal(ranked, bundle.ranked.length);
  assert.ok(ranked <= 10, 'default topN respected');
});

test('ranked: the pinned non-obvious order (2000s-Kyiv bias applied)', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  assert.deepEqual(bundle.ranked.map((r) => r.name), [
    'Brutalist Kyiv', 'Kyiv Nocturne', 'Krypta Bar', 'Samizdat Nights',
    'Black Podil Atelier', 'Podil Echo', 'Khreshchatyk Static', 'Obolon Drone',
    'Underground Almanac', 'Speakeasy Podil',
  ], 'the deterministic non-obvious order under the scene boost');
  // Every pick is a real Kyiv-universe entity carrying a Qloo UUID.
  for (const entry of bundle.ranked) {
    assert.ok(ALL_NAMES.includes(entry.name), `${entry.name} is from the universe`);
    assert.ok(ENTITY_ID.test(entry.id), `${entry.name} carries a Qloo UUID`);
  }
  // A genuine cross-domain dossier: all five domains represented.
  assert.deepEqual([...new Set(bundle.ranked.map((r) => r.domain))].sort(),
    ['books', 'dining', 'fashion', 'film', 'music']);
});

test('layers: all five extracted, coverage honest', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  assert.deepEqual(Object.keys(bundle.layers).sort(),
    ['gastronomy', 'literary', 'material', 'sound', 'visual']);
  assert.deepEqual(bundle.coverage,
    { sound: true, literary: true, material: true, gastronomy: true, visual: true });
});

test('lifecycle: the session reaches DELIVERED/COMPLETED, unpersisted', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.equal(bundle.session.execution.step, 11);
  assert.equal(bundle.session.id, null, 'no baseDir -> no persistence');
});

test('determinism and zero-emoji purity', async () => {
  const a = await runWorldbuilder(SEED, options());
  const b = await runWorldbuilder(SEED, options());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(a)), 'zero emojis');
});

test('the document: verifiable DATA SOURCES + the PRIVACY NOTICE', async () => {
  const bundle = await runWorldbuilder(SEED, options());
  const doc = formatDossier(bundle);
  assert.ok(doc.sectionIndex.includes('sources'), 'the DATA SOURCES section is present');
  assert.ok(doc.sectionIndex.includes('privacy'), 'the PRIVACY NOTICE is present');
  assert.equal(doc.sectionIndex[doc.sectionIndex.length - 1], 'privacy', 'privacy closes');

  // The provenance table verifies the Kyiv entities against Qloo.
  const table = buildProvenanceTable(bundle);
  assert.ok(table.stats.verified >= 11, 'the anchor + all ranked picks are UUID-verified');
  assert.ok(table.entities.some((r) => r.name === SEED && r.verifiable));
  assert.ok(!table.entities.some((r) => r.id && r.id.startsWith('urn:')), 'no urn: leakage');

  // The printed HTML carries the sources table and the notice.
  const html = exportHtml(bundle, { now: '2026-01-01T00:00:00Z' });
  assert.match(html, /<table class="sources">/);
  assert.match(html, /<h2>PRIVACY NOTICE<\/h2>/);
  assert.ok(!/<script/i.test(html), 'no raw script');
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'zero emojis in print');
});

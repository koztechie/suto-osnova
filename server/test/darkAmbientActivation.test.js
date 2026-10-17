/**
 * Dark Ambient Live — the Mode 2 CONTROL TEST SET (task 109): a
 * golden end-to-end scenario for a hypothetical festival TOUR
 * activation (ExperientialActivation).
 *
 * A self-contained, deterministic fixture universe stands in for the
 * Qloo graph + audience-insights legs (zero network): the tour
 * concept "Dark Ambient Live" resolves to a dark-ambient MUSIC
 * headliner anchor; the taste graph expands across the THREE
 * activation domains (music -> opening acts, fashion -> brand
 * sponsors, dining -> F&B vendors) with dark-scene entities; and the
 * AUDIENCE INSIGHTS leg returns a top list that CONFIRMS two of the
 * picks — exercising Mode 2's first-class dual-evidence marking.
 *
 * The fixture encodes the live-verified domain-mapping contracts
 * (music=artist; fashion=brand + the fashion tag family; dining=place
 * + the restaurant tag family) and per-domain DISTINCT UUIDs
 * (expandTastes dedups globally). The REAL runExperiential runs
 * against it, and the test pins the full activation contract: anchor,
 * the three-domain expansion, the audience leg, the curation lists
 * with dual-evidence attribution, the afterparty/food-zone/resonance
 * blocks, the terminal FSM lifecycle, determinism, and the formatted
 * document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'dark-ambient-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { MODE_ACTIVATION } = await import('../src/engine/ModeDispatcher.js');
const { EVIDENCE_KINDS } = await import('../src/modes/ExperientialMode.js');
const { AgentState } = await import('../src/engine/AgentStateMachine.js');
const { AgentPhase } = await import('../src/engine/AgentPhases.js');
const { ENTITY_ID, buildProvenanceTable } = await import('../src/formatters/ProvenanceTable.js');
const { formatDossier } = await import('../src/formatters/DossierFormatter.js');

const SEED = 'Dark Ambient Live';

// --- the deterministic dark-ambient fixture universe --------------------------
const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const T = (id, name, type) => ({ id, name, type });
const ANCHOR = {
  id: UUID('d00d0000'), name: SEED, subtype: 'urn:entity:artist', popularity: 0.6,
  tags: [T('urn:tag:genre:music:darkambient', 'Dark Ambient', 'urn:tag:genre:music')],
};
const SUB = { music: 'urn:entity:artist', fashion: 'urn:entity:brand', dining: 'urn:entity:place' };
const BASE = { music: 1, fashion: 3, dining: 4 };
const TAGS = {
  music: [T('urn:tag:genre:music:darkambient', 'Dark Ambient', 'urn:tag:genre:music'),
    T('urn:tag:genre:music:drone', 'Drone', 'urn:tag:genre:music')],
  fashion: [T('urn:tag:genre:brand:fashion', 'Fashion', 'urn:tag:genre:brand')],
  dining: [T('urn:tag:genre:place:restaurant', 'Restaurant', 'urn:tag:genre:place')],
};
// [name, affinity, popularity]
const UNIVERSE = {
  music: [['Atrium Drift', 0.93, 0.4], ['Null Signal', 0.9, 0.35], ['Grey Static', 0.88, 0.3]],
  fashion: [['Monochrome Atelier', 0.91, 0.35], ['Obsidian Wear', 0.87, 0.3]],
  dining: [['The Crypt Bar', 0.9, 0.3], ['Nocturne Cafe', 0.85, 0.25]],
};

const affinityFn = async (ids, dom) => {
  const key = String(dom);
  let k = key;
  if (key.includes('artist')) k = 'music';
  else if (key.includes('brand')) k = 'fashion';
  else if (key.includes('place')) k = 'dining';
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
// The audience-insights leg confirms two of the curation picks.
const insightsFn = async () => ({
  count: 2,
  results: [{ name: 'Monochrome Atelier', affinity: 0.8 }, { name: 'Atrium Drift', affinity: 0.75 }],
});

const options = () => ({
  affinityFn, search: searchStub, searchFn, tagsFn, insightsFn, synthesis: false,
});

// --- the pinned golden activation contract ------------------------------------

test('anchor: the tour resolves to the dark-ambient headliner', async () => {
  const bundle = await runExperiential(SEED, options());
  assert.equal(bundle.mode, MODE_ACTIVATION);
  assert.equal(bundle.entity.name, SEED);
  assert.equal(bundle.entity.category, 'music');
  assert.equal(bundle.entity.id, UUID('d00d0000'));
  assert.ok(ENTITY_ID.test(bundle.entity.id), 'the headliner id is a Qloo UUID');
});

test('expansion: the three activation domains only', async () => {
  const bundle = await runExperiential(SEED, options());
  assert.deepEqual([...bundle.expansion.domains], ['music', 'dining', 'fashion']);
  assert.equal(bundle.expansion.candidates, 7, '3 music + 2 fashion + 2 dining');
});

test('the audience leg: first-class insights drive the run', async () => {
  const bundle = await runExperiential(SEED, options());
  assert.equal(bundle.audience.available, true, 'the insights leg is required by Mode 2');
  assert.equal(bundle.audience.count, 2);
  assert.deepEqual(bundle.audience.top.map((r) => [r.name, r.affinityPercent]), [
    ['Monochrome Atelier', 80], ['Atrium Drift', 75],
  ]);
});

test('curation: opening acts / sponsors / vendors with dual-evidence', async () => {
  const bundle = await runExperiential(SEED, options());
  const { openingActs, sponsors, vendors } = bundle.curation;

  assert.deepEqual(openingActs.map((x) => [x.name, x.evidence]), [
    ['Atrium Drift', EVIDENCE_KINDS.DUAL],
    ['Null Signal', EVIDENCE_KINDS.CONFIRMED_AFFINITY],
    ['Grey Static', EVIDENCE_KINDS.CONFIRMED_AFFINITY],
  ]);
  assert.deepEqual(sponsors.map((x) => [x.name, x.evidence]), [
    ['Monochrome Atelier', EVIDENCE_KINDS.DUAL],
    ['Obsidian Wear', EVIDENCE_KINDS.CONFIRMED_AFFINITY],
  ]);
  assert.deepEqual(vendors.map((x) => [x.name, x.evidence]), [
    ['The Crypt Bar', EVIDENCE_KINDS.CONFIRMED_AFFINITY],
    ['Nocturne Cafe', EVIDENCE_KINDS.CONFIRMED_AFFINITY],
  ]);
  // The two audience-confirmed picks are the dual ones.
  assert.equal(bundle.stats.dualEvidence, 2);
});

test('the activation blocks: afterparty, food zones, resonance', async () => {
  const bundle = await runExperiential(SEED, options());
  assert.ok(bundle.afterparty !== null, 'the afterparty block rides activation');
  assert.equal(bundle.afterparty.venues.length, 1, 'The Crypt Bar is the nightlife venue');
  assert.ok(bundle.foodZones !== null, 'the F&B zone map rides activation');
  assert.equal(bundle.foodZones.stats.placed, 2, 'both dining entities zone cleanly');
  assert.ok(bundle.resonance !== null, 'the resonance index rides activation');
  assert.equal(bundle.resonance.score, 79, 'the deterministic index for this fixture');
});

test('lifecycle: DELIVERED/COMPLETED, unpersisted', async () => {
  const bundle = await runExperiential(SEED, options());
  assert.equal(bundle.session.state, AgentState.DELIVERED);
  assert.equal(bundle.session.phase, AgentPhase.COMPLETED);
  assert.equal(bundle.session.execution.step, 11);
  assert.equal(bundle.session.id, null, 'no baseDir -> no persistence');
});

test('determinism and zero-emoji purity', async () => {
  const a = await runExperiential(SEED, options());
  const b = await runExperiential(SEED, options());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(a)), 'zero emojis');
});

test('the document: activation sections, verifiable sources, privacy', async () => {
  const bundle = await runExperiential(SEED, options());
  const doc = formatDossier(bundle);
  for (const id of ['resonance', 'audience', 'opening_acts', 'sponsors', 'vendors',
    'food_zones', 'afterparty', 'sources', 'privacy']) {
    assert.ok(doc.sectionIndex.includes(id), `the ${id} section is present`);
  }
  assert.equal(doc.sectionIndex[doc.sectionIndex.length - 1], 'privacy', 'privacy closes');

  // The provenance table verifies the dark-scene entities against Qloo.
  const table = buildProvenanceTable(bundle);
  assert.ok(table.stats.verified >= 7, 'the anchor + the curation picks are UUID-verified');
  assert.ok(table.entities.some((r) => r.name === SEED && r.verifiable));
  assert.ok(!table.entities.some((r) => r.id && r.id.startsWith('urn:')), 'no urn: leakage');
});

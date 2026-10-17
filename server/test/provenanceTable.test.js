/**
 * ProvenanceTable gate (task 106) — the DATA SOURCES table:
 *   - the UUID verifiability rule (a Qloo entity id is a UUID; urn:
 *     tags/places are NOT entity references and are excluded);
 *   - name-join recovery (a curation/audience row recovers its UUID
 *     from a matched ranked entity, else is honestly `unverified`);
 *   - the source set per entity, the full (uncapped) listing, the
 *     stats;
 *   - the text and semantic-<table> renderers (escaped);
 *   - the DossierFormatter + real-bundle integration;
 *   - determinism, deep-freeze, the TypeError matrix, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'provenance-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildProvenanceTable, renderProvenanceTable, renderProvenanceTableHtml,
  ENTITY_ID, SCAN_KEYS,
} = await import('../src/formatters/ProvenanceTable.js');
const { formatDossier, LAYOUTS } = await import('../src/formatters/DossierFormatter.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const UUID = (n) => `${n.toString(16).padStart(8, '0')}-1111-4222-8333-444455556666`;

const bundle = () => ({
  mode: 'activation',
  entity: { id: UUID(0xa), name: 'Midsommar', category: 'film' },
  ranked: [
    { id: UUID(0), name: 'Neighbor 0', domain: 'film', affinity: 0.9 },
    { id: UUID(1), name: 'Neighbor 1', domain: 'music', affinity: 0.8 },
  ],
  layers: {
    gastronomy: {
      // A urn: tag is NOT an entity reference -> excluded by the UUID rule.
      drinks: [{ id: 'urn:tag:genre:place:coffee', name: 'Coffee' }],
      venues: [{ id: UUID(2), name: 'Basilica Coffee', domain: 'place' }],
    },
  },
  curation: {
    // 'Neighbor 0' matches a ranked entity -> recovers its UUID.
    sponsors: [{ name: 'Neighbor 0', domain: 'film', affinityPercent: 90, evidence: 'dual' }],
  },
  audience: {
    // No UUID anywhere -> honestly unverified.
    top: [{ name: 'Unknown Brand', affinityPercent: 80 }],
  },
});

test('the UUID verifiability rule and the source set', () => {
  const table = buildProvenanceTable(bundle());

  const byName = new Map(table.entities.map((r) => [r.name, r]));
  assert.equal(byName.get('Midsommar').id, UUID(0xa), 'the anchor is verified');
  assert.deepEqual([...byName.get('Midsommar').sources], ['anchor']);

  assert.deepEqual([...byName.get('Neighbor 0').sources], ['curation', 'ranked'],
    'the name-join attaches the curation source to the ranked entity');
  assert.equal(byName.get('Neighbor 0').verifiable, true);

  assert.equal(byName.get('Basilica Coffee').verifiable, true, 'a venue UUID is a real id');
  assert.deepEqual([...byName.get('Basilica Coffee').sources], ['layers']);

  const unknown = byName.get('Unknown Brand');
  assert.equal(unknown.verifiable, false, 'no UUID anywhere -> unverified');
  assert.equal(unknown.id, null);
  assert.deepEqual([...unknown.sources], ['audience']);

  assert.ok(!byName.has('Coffee'), 'a urn: tag is NOT an entity reference');
  assert.deepEqual({ ...table.stats }, { total: 5, verified: 4, unverified: 1 });
  assert.match(table.summary, /5 entity reference\(s\), 4 verified against Qloo/);
  assert.ok(Object.isFrozen(table));
  assert.ok(Object.isFrozen(table.entities[0]));
});

test('the UUID pattern and the scanned sections are exported contracts', () => {
  assert.ok(ENTITY_ID.test(UUID(0xdead)));
  assert.ok(!ENTITY_ID.test('urn:tag:genre:music:gothic'));
  assert.ok(SCAN_KEYS.includes('ranked') && SCAN_KEYS.includes('antithesis'));
});

test('the text and semantic-table renderers (escaped)', () => {
  const table = buildProvenanceTable(bundle());
  const text = renderProvenanceTable(table);
  assert.match(text, /^DATA SOURCES: 5 entity reference\(s\), 4 verified against Qloo\.$/m);
  assert.match(text, /^ {3}- Midsommar \| .+ \| film \| anchor$/m);
  assert.match(text, /Unknown Brand \| \(no qloo id\) \| unknown \| audience \[unverified\]$/m);

  const html = renderProvenanceTableHtml(table);
  assert.match(html, /<table class="sources">/);
  assert.match(html, /<th>Qloo ID<\/th>/);
  assert.ok(html.includes(`<td>${UUID(0xa)}</td>`), 'the UUID is in the table');
  assert.ok(html.includes('<td class="unverified">(no qloo id)</td>'), 'unverified marked');
  assert.ok(!/<script/i.test(html), 'no raw script');
  assert.throws(() => renderProvenanceTable({}), TypeError);
  assert.throws(() => renderProvenanceTableHtml({}), TypeError);
});

test('escaping: an untrusted entity name never executes', () => {
  const table = buildProvenanceTable({
    mode: 'activation',
    entity: { id: UUID(9), name: '<script>x</script>', category: 'film' },
  });
  const html = renderProvenanceTableHtml(table);
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
});

test('determinism and the TypeError matrix', () => {
  const a = buildProvenanceTable(bundle());
  const b = buildProvenanceTable(bundle());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.throws(() => buildProvenanceTable(null), TypeError);
});

test('real bundles: the anchor + ranked entities are verified', async () => {
  const shared = {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  };
  const wb = await runWorldbuilder('Static Ash Live', shared);
  const wbTable = buildProvenanceTable(wb);
  assert.ok(wbTable.stats.verified > 0, 'the anchor and ranked picks carry UUIDs');
  assert.ok(wbTable.entities.some((r) => r.name === wb.entity.name && r.verifiable),
    'the resolved anchor is verified');
  // No urn: tags leak in as entities.
  assert.ok(!wbTable.entities.some((r) => r.id && r.id.startsWith('urn:')));

  const activation = await runExperiential('Static Ash Live', shared);
  const actTable = buildProvenanceTable(activation);
  assert.ok(actTable.stats.total > 0);
});

test('DossierFormatter integration: the sources section rides with rows', async () => {
  const bundleResult = await runWorldbuilder('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  assert.ok(LAYOUTS.worldbuilder.includes('sources'), 'sources is in every layout');
  const doc = formatDossier(bundleResult);
  const sources = doc.sections.find((s) => s.id === 'sources');
  assert.ok(sources, 'the DATA SOURCES section is present');
  assert.equal(sources.title, 'DATA SOURCES');
  assert.match(sources.body, /^DATA SOURCES: /);
  assert.ok(sources.rows && Array.isArray(sources.rows.entities),
    'the structured table rides the section for the print template');
  assert.ok(sources.rows.entities.some((r) => r.verifiable));

  // A bare bundle with no entity reference yields no sources section.
  const bare = formatDossier({ mode: 'activation', entity: { name: 'X' } });
  assert.ok(!bare.sectionIndex.includes('sources'), 'an empty table is honestly absent');
});

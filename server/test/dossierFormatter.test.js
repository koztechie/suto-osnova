/**
 * DossierFormatter gate (task 101) — the unified output document:
 *   - the SECTION REGISTRY guards (absent blocks skipped, never
 *     faked) and the per-mode LAYOUTS order;
 *   - real bundles from all three modes formatted end to end;
 *   - PER-SECTION FAILURE ISOLATION (one bad optional block degrades
 *     to an honest note and is ledgered, the document survives);
 *   - the explicit `sections` override + the TypeError matrix;
 *   - determinism, the footer, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'dossier-formatter-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  formatDossier, SECTION_REGISTRY, LAYOUTS, DOC_RULE,
} = await import('../src/formatters/DossierFormatter.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { runAntithesis } = await import('../src/modes/AntithesisMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const noLlm = { synthesis: false };

test('registry guards: absent blocks are skipped, never faked', () => {
  const doc = formatDossier({ mode: 'activation', entity: { name: 'X' } });
  assert.deepEqual([...doc.sectionIndex], [], 'no block data -> no sections');
  assert.match(doc.document, /^DOSSIER — Experiential Activation \(Live Events\)$/m);
  assert.match(doc.document, /^ANCHOR: X$/m);
  assert.match(doc.document, /FOOTER: 0 section\(s\)/);
  assert.equal(doc.output, 'activation_curation');
  assert.equal(doc.stats.unavailable, 0);
});

test('the TypeError matrix and the explicit sections override', () => {
  for (const bad of [null, {}, { mode: 42 }]) {
    assert.throws(() => formatDossier(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => formatDossier({ mode: 'activation' }, { sections: 'x' }), TypeError);
  assert.throws(() => formatDossier({ mode: 'activation' }, { sections: ['bogus'] }), TypeError);

  const only = formatDossier(
    { mode: 'activation', entity: { name: 'X' }, audience: { available: true, count: 1, top: [{ name: 'A', affinityPercent: 80 }] } },
    { sections: ['audience'] },
  );
  assert.deepEqual([...only.sectionIndex], ['audience'], 'the override wins');
  assert.match(only.document, /^AUDIENCE INSIGHTS: 1 row\(s\)$/m);
  assert.match(only.document, /^ {3}- A \(80%\)$/m);
});

test('per-section failure isolation: one bad block never kills the document', () => {
  // `resonance` is truthy but not a valid block -> renderResonance
  // throws -> the section degrades to an honest note and is ledgered.
  const doc = formatDossier({
    mode: 'activation',
    entity: { name: 'X' },
    resonance: {},
    audience: { available: false, error: 'upstream', count: 0, top: [] },
  });
  assert.deepEqual([...doc.sectionIndex], ['resonance', 'audience']);
  assert.match(doc.document, /^\(event resonance index unavailable: /m);
  assert.match(doc.document, /^AUDIENCE INSIGHTS: unavailable \(upstream\)$/m);
  assert.equal(doc.stats.unavailable, 1);
  assert.equal(doc.stats.sectionFailures[0].id, 'resonance');
  assert.match(doc.document, /FOOTER: 2 section\(s\), 1 unavailable/);
});

test('real worldbuilder bundle formats end to end', async () => {
  const bundle = await runWorldbuilder('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    ...noLlm,
  });
  const doc = formatDossier(bundle);

  assert.equal(doc.mode, 'worldbuilder');
  assert.equal(doc.output, 'mise_en_scene_dossier');
  assert.ok(doc.sectionIndex.includes('top'), 'the ranked list rides every dossier');
  for (const id of doc.sectionIndex) {
    assert.ok(LAYOUTS.worldbuilder.includes(id), `${id} is in the worldbuilder layout`);
  }
  // The layout order is preserved in the assembled document.
  const positions = doc.sectionIndex.map((id) => LAYOUTS.worldbuilder.indexOf(id));
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y), 'layout order kept');
  assert.ok(doc.document.split('\n').includes(DOC_RULE),
    'the fixed horizontal rule separates sections');
  assert.ok(!/\p{Extended_Pictographic}/u.test(doc.document), 'zero emojis');

  const again = formatDossier(bundle);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), JSON.parse(JSON.stringify(again)),
    'deterministic over the same bundle');
});

test('real activation and antithesis bundles format end to end', async () => {
  const shared = {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    ...noLlm,
  };
  const activation = await runExperiential('Static Ash Live', shared);
  const activationDoc = formatDossier(activation);
  assert.equal(activationDoc.mode, 'activation');
  assert.ok(activationDoc.sectionIndex.includes('audience'), 'the insights leg rides activation');
  for (const id of activationDoc.sectionIndex) {
    assert.ok(LAYOUTS.activation.includes(id));
  }

  const antithesis = await runAntithesis('Static Ash Live', shared);
  const antithesisDoc = formatDossier(antithesis);
  assert.equal(antithesisDoc.mode, 'antithesis');
  assert.equal(antithesisDoc.output, 'cultural_blindspot_report');
  assert.ok(antithesisDoc.sectionIndex.includes('blindspot'));
  assert.match(antithesisDoc.document, /^CULTURAL BLINDSPOT REPORT — /m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(antithesisDoc.document), 'zero emojis');
});

test('the section registry is a coherent exported contract', () => {
  const ids = SECTION_REGISTRY.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate section ids');
  for (const [mode, layout] of Object.entries(LAYOUTS)) {
    for (const id of layout) {
      assert.ok(ids.includes(id), `${mode} layout references a registered section ${id}`);
    }
  }
});

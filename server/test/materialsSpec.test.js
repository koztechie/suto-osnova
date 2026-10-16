/**
 * MaterialsSpec gate (task 85) — the production-designer materials
 * sheet (fabrics, metals, lighting):
 *   - direct pass-through + MATERIAL_MAP derivation over a synthetic
 *     bundle with exactly pinned family contents (incl. the
 *     word-boundary pin: "Monochrome" must NOT yield "chrome");
 *   - entry-by-entry pinning of every MATERIAL_MAP record;
 *   - the provenance/anti-fabrication contract (names only from the
 *     tables, markers only from the bundle);
 *   - dedup, familyLimit, honest emptiness;
 *   - template integration: the MATERIALS SPEC block renders before
 *     the provenance footer, disable flag honored;
 *   - determinism, deep-freeze, TypeError guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'materials-spec-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildMaterialsSpec, renderMaterialsSpec,
  MATERIAL_FAMILIES, MATERIAL_MAP, DIRECT_MATERIALS,
} = await import('../src/modes/MaterialsSpec.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { buildSceneDossier, renderSceneDossier } = await import('../src/modes/SceneDossierTemplate.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const named = (name) => ({ id: `urn:x:${name}`, name, type: 'urn:x' });

test('synthetic bundle: exact family contents, direct + mapped, in order', () => {
  const bundle = {
    layers: {
      material: {
        textures: [named('Velvet')],
        clothingStyles: [named('Gothic')],
        objects: [named('Chrome')],
        architecture: [named('Brutalist')],
      },
      visual: {
        cinematography: [named('Neon')],
        colorSolutions: [named('Monochrome')],
        artSchools: [],
      },
    },
    ranked: [{ domain: 'fashion', name: 'Coat', tags: [named('Gothic')] }],
  };
  const spec = buildMaterialsSpec(bundle);

  assert.deepEqual(spec.families.fabrics.items.map((i) => i.name),
    ['velvet', 'black velvet', 'lace', 'raw canvas', 'matte black wool', 'raw white cotton']);
  assert.deepEqual(spec.families.metals.items.map((i) => i.name),
    ['blackened iron', 'chrome', 'exposed steel', 'brushed aluminium']);
  assert.deepEqual(spec.families.lighting.items.map((i) => i.name),
    ['candlelight', 'fluorescent', 'neon', 'hard key light']);

  assert.equal(spec.stats.markersScanned, 7);
  assert.equal(spec.stats.total, 14);
  assert.ok(Object.isFrozen(spec));
  assert.ok(Object.isFrozen(spec.families.fabrics.items));
  for (const item of spec.families.fabrics.items) {
    assert.ok(Object.hasOwn(item.source, 'kind'));
    assert.ok(Object.hasOwn(item.source, 'marker'));
  }
});

test('word boundary: "Monochrome" derives its map, never the substring "chrome"', () => {
  const spec = buildMaterialsSpec({
    layers: { material: { objects: [named('Monochrome')] } },
    ranked: [],
  });
  assert.deepEqual(spec.families.metals.items.map((i) => i.name), ['brushed aluminium']);
  assert.equal(spec.families.metals.items[0].source.kind, 'mapped');
});

test('MATERIAL_MAP: pinned entry by entry', () => {
  for (const [token, families] of Object.entries(MATERIAL_MAP)) {
    const spec = buildMaterialsSpec({
      layers: { material: { objects: [named(token)] } },
      ranked: [],
    });
    for (const family of MATERIAL_FAMILIES) {
      assert.deepEqual(
        spec.families[family].items.map((i) => i.name),
        [...(families[family] ?? [])],
        `MATERIAL_MAP[${token}].${family}`
      );
    }
  }
  // DIRECT tables: every keyword passes through verbatim, per family.
  for (const family of MATERIAL_FAMILIES) {
    for (const keyword of DIRECT_MATERIALS[family]) {
      const spec = buildMaterialsSpec({
        layers: { material: { objects: [named(keyword)] } },
        ranked: [],
      });
      assert.deepEqual(spec.families[family].items.map((i) => i.name), [keyword],
        `DIRECT ${family}/${keyword}`);
      assert.equal(spec.families[family].items[0].source.kind, 'direct');
    }
  }
});

test('provenance: names only from the tables, markers only from the bundle', () => {
  const known = new Set();
  for (const family of MATERIAL_FAMILIES) {
    for (const name of DIRECT_MATERIALS[family]) known.add(name);
    for (const mapped of Object.values(MATERIAL_MAP)) {
      for (const name of mapped[family] ?? []) known.add(name);
    }
  }
  const bundle = {
    layers: {
      material: { textures: [named('Velvet')], clothingStyles: [named('Gothic')], objects: [named('Chrome')], architecture: [] },
      visual: { cinematography: [], colorSolutions: [named('Monochrome')], artSchools: [] },
    },
    ranked: [],
  };
  const spec = buildMaterialsSpec(bundle);
  for (const family of MATERIAL_FAMILIES) {
    for (const item of spec.families[family].items) {
      assert.ok(known.has(item.name), `invented material name: ${item.name}`);
      assert.ok(['Velvet', 'Gothic', 'Chrome', 'Monochrome'].includes(item.source.marker),
        `invented marker: ${item.source.marker}`);
    }
  }
});

test('dedup and familyLimit', () => {
  const bundle = {
    layers: {
      material: {
        textures: [named('Velvet'), named('velvet'), named('Silk'), named('Satin')],
        clothingStyles: [], objects: [], architecture: [],
      },
      visual: { cinematography: [], colorSolutions: [], artSchools: [] },
    },
    ranked: [],
  };
  const full = buildMaterialsSpec(bundle);
  assert.deepEqual(full.families.fabrics.items.map((i) => i.name),
    ['velvet', 'silk', 'satin'], 'case-insensitive dedup');

  const limited = buildMaterialsSpec(bundle, { familyLimit: 2 });
  assert.equal(limited.families.fabrics.items.length, 2);
  for (const bad of [0, 51, 1.5]) {
    assert.throws(() => buildMaterialsSpec(bundle, { familyLimit: bad }), TypeError);
  }
  assert.throws(() => buildMaterialsSpec(null), TypeError);
  assert.throws(() => renderMaterialsSpec({}), TypeError);
});

test('honest emptiness: no mapped markers -> empty families, no rendered block', () => {
  const spec = buildMaterialsSpec({
    layers: { material: { textures: [named('Zeppelin')] }, visual: {} },
    ranked: [],
  });
  for (const family of MATERIAL_FAMILIES) {
    assert.deepEqual([...spec.families[family].items], []);
    assert.match(spec.families[family].summary, /No verified materials/);
  }
  assert.equal(renderMaterialsSpec(spec), '');
});

test('real bundle integration: the MATERIALS SPEC block frames the dossier', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  const template = buildSceneDossier(bundle);
  assert.ok(template.materials !== null, 'stub markers map into families');
  assert.ok(template.materials.stats.total > 0);

  const document = renderSceneDossier(template);
  assert.match(document, /MATERIALS SPEC \(for the production designer\)/);
  assert.match(document, /^ {3}- .+ \[(direct|mapped) via ".+"\]$/m, 'items carry the derivation');
  assert.match(document, /template=v1$/, 'provenance stays the last line');
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis retained');

  // The disable flag: no spec, no block.
  const bare = buildSceneDossier(bundle, { materials: false });
  assert.equal(bare.materials, null);
  const bareDoc = renderSceneDossier(bare);
  assert.ok(!/MATERIALS SPEC/.test(bareDoc));
});

test('determinism: identical bundle -> identical spec and block', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  const a = buildMaterialsSpec(bundle);
  const b = buildMaterialsSpec(bundle);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderMaterialsSpec(a), renderMaterialsSpec(b));
});

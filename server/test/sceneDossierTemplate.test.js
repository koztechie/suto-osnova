/**
 * SceneDossierTemplate gate (task 83) — the Mode 1 output template:
 *   - real-bundle build: five sections in the frozen order, character
 *     brief with the dominant tonality axis, sound picks present;
 *   - the ANTI-HALLUCINATION pin: every emitted item name exists in
 *     the source bundle (the template never invents proper nouns);
 *   - kind mapping per section (incl. the deliberate wardrobe/
 *     architecture exclusion) over a fully synthetic bundle;
 *   - explicit HONEST EMPTINESS when layers carry no data;
 *   - determinism, deep-frozen template, byte-identical rendering,
 *     and a print-ready document with zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'scene-template-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildSceneDossier, renderSceneDossier,
  SCENE_SECTIONS, SCENE_SECTION_TITLES, SCENE_TEMPLATE_VERSION,
} = await import('../src/modes/SceneDossierTemplate.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const emptySearch = async () => ({ results: [] });
const llmFetchStub = async () => ({
  ok: true, status: 200,
  json: async () => ({
    model: 'stub',
    choices: [{ message: { content: '"Hereditary" with "Gothic" markers.' } }],
  }),
});

const realBundle = async () => runWorldbuilder('A24 Psychological Horror', {
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: emptySearch,
  tagsFn: tagsStub,
  fetchFn: llmFetchStub,
  apiKey: 'scene-key',
});

/** Collect every `name` string anywhere in a JSON-safe structure. */
const collectNames = (value, into = new Set()) => {
  if (Array.isArray(value)) { for (const v of value) collectNames(v, into); return into; }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'name' && typeof v === 'string') into.add(v);
      collectNames(v, into);
    }
  }
  return into;
};

test('real bundle: five sections in the frozen order with the character brief', async () => {
  const bundle = await realBundle();
  const template = buildSceneDossier(bundle);

  assert.equal(template.version, SCENE_TEMPLATE_VERSION);
  assert.deepEqual(template.sections.map((s) => s.key), [...SCENE_SECTIONS]);
  assert.deepEqual(
    template.sections.map((s) => s.title),
    SCENE_SECTIONS.map((key) => SCENE_SECTION_TITLES[key])
  );
  assert.equal(template.anchor.name, bundle.entity.name);
  assert.equal(template.anchor.domain, 'film');
  assert.ok(['direct_title', 'person', 'aesthetic_description'].includes(template.anchor.format));

  const character = template.sections[0];
  assert.equal(character.key, 'character');
  assert.ok(character.items.some((i) => i.kind === 'anchor' && i.name === 'Hereditary'));
  assert.equal(typeof template.tonality.coherent, 'boolean');

  const sound = template.sections[1];
  assert.ok(sound.items.length > 0, 'the sound background carries picks');
  assert.ok(sound.items.some((i) => i.kind === 'artist'));
});

test('anti-hallucination: every emitted name exists in the source bundle', async () => {
  const bundle = await realBundle();
  const template = buildSceneDossier(bundle);
  const known = collectNames(bundle);
  for (const section of template.sections) {
    for (const item of section.items) {
      assert.ok(known.has(item.name),
        `template invented a name: ${section.key}/${item.kind}/${item.name}`);
    }
  }
});

test('kind mapping: full synthetic bundle maps every group, architecture excluded', async () => {
  const tag = (name) => ({ id: `urn:tag:x:${name}`, name, type: 'urn:tag:x' });
  const entity = (name, extra = {}) => ({ id: `e-${name}`, name, ...extra });
  const bundle = {
    mode: 'worldbuilder',
    requestId: 'req-1',
    entity: { id: 'anchor-1', name: 'Neon Diner', category: 'film' },
    seed: { format: 'direct_title', confidence: 'high' },
    tonality: {
      coherent: true,
      centroid: { axes: { dark: 0.8, warm: -0.2 }, support: 6 },
      contradictions: [],
    },
    ranked: [
      { domain: 'music', ...entity('Neon Band'), affinity: 0.9, tags: [tag('neon')] },
      { domain: 'books', ...entity('Diner Novel'), correlation: 0.8 },
      { domain: 'fashion', ...entity('Chrome Jacket'), weight: 0.4 },
      { domain: 'dining', ...entity('Midnight Diner'), affinity: 0.7 },
    ],
    layers: {
      sound: { artists: [entity('Neon Band', { affinity: 0.9 })], albums: [entity('Static Album', { affinity: 0.8 })], genres: [tag('synthwave')], coverage: {}, failures: [] },
      literary: { texts: [entity('Diner Novel', { correlation: 0.8 })], authors: [entity('A. Author', { correlation: 0.7 })], essayists: [], coverage: {}, failures: [] },
      material: { clothingStyles: [tag('chrome')], objects: [tag('jukebox')], textures: [tag('vinyl')], architecture: [tag('modernist')] },
      gastronomy: { drinks: [tag('cherry cola')], traditions: [tag('late night')], venueTypes: [tag('diner')], venues: [entity('Midnight Diner', { affinity: 0.7 })], coverage: {}, failures: [] },
    },
    failures: [],
  };
  const template = buildSceneDossier(bundle);
  const [character, sound, literature, wardrobe, menu] = template.sections;

  assert.deepEqual(character.items.map((i) => i.kind), ['anchor']);
  assert.equal(character.items[0].name, 'Neon Diner');
  assert.deepEqual(template.tonality.axis, { axis: 'dark', direction: 'positive' });

  // Dedup by name is the shelf rule: 'Neon Band' arrives as both the
  // sound artist and the music-domain pick — the first claim wins.
  assert.deepEqual(sound.items.map((i) => i.kind), ['artist', 'album', 'genre']);
  assert.deepEqual(literature.items.map((i) => i.kind), ['text', 'author']);
  assert.deepEqual(wardrobe.items.map((i) => i.kind), ['style', 'object', 'texture', 'fashion_pick']);
  assert.ok(!wardrobe.items.some((i) => i.name === 'modernist'),
    'architecture is scene, not wardrobe — deliberately excluded');
  assert.deepEqual(menu.items.map((i) => i.kind), ['drink', 'tradition', 'venue_type', 'venue']);

  // Evidence notes, never invented prose.
  const artist = sound.items[0];
  assert.equal(artist.note, 'affinity 90%');
  const text = literature.items[0];
  assert.equal(text.note, 'correlation 0.8');
});

test('honest emptiness: empty layers state their emptiness explicitly', () => {
  const template = buildSceneDossier({
    entity: { id: 'e1', name: 'Bare Anchor', category: 'film' },
    layers: {},
    ranked: [],
    tonality: null,
    failures: [],
  });
  const [character, sound, literature, wardrobe, menu] = template.sections;
  assert.equal(character.items[0].name, 'Bare Anchor', 'the anchor survives');
  for (const section of [sound, literature, wardrobe, menu]) {
    assert.deepEqual([...section.items], []);
    assert.match(section.summary, /No verified data/);
  }
  const document = renderSceneDossier(template);
  assert.match(document, /No verified data/);
  assert.match(document, /1\. CHARACTER/);
});

test('frozen template and byte-identical determinism', async () => {
  const bundle = await realBundle();
  const a = buildSceneDossier(bundle);
  const b = buildSceneDossier(bundle);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.sections));
  assert.ok(Object.isFrozen(a.sections[0].items));
  assert.ok(Object.isFrozen(a.provenance));
  assert.equal(renderSceneDossier(a), renderSceneDossier(b));
});

test('renderer: print-ready document, structured lines, zero emojis', async () => {
  const bundle = await realBundle();
  const document = renderSceneDossier(buildSceneDossier(bundle));

  assert.match(document, /^SUTO OSNOVA — MISE-EN-SCENE DOSSIER\n/);
  assert.match(document, /Anchor: Hereditary \(film\)/);
  assert.match(document, /^1\. CHARACTER$/m);
  assert.match(document, /^5\. MENU & DRINKS$/m);
  assert.match(document, /^ {3}- \[[a-z_]+\] .+ \(.+\)$/m, 'item lines carry kind + evidence');
  assert.match(document, /PROVENANCE: mode=worldbuilder /);
  assert.match(document, /template=v1$/);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis in output');
});

test('options and contracts: sectionLimit bounds and TypeError guards', async () => {
  const bundle = await realBundle();
  const limited = buildSceneDossier(bundle, { sectionLimit: 2 });
  for (const section of limited.sections) {
    assert.ok(section.items.length <= 2, `${section.key} respects the cap`);
  }
  for (const bad of [0, 51, 2.5]) {
    assert.throws(() => buildSceneDossier(bundle, { sectionLimit: bad }), TypeError);
  }
  assert.throws(() => buildSceneDossier(null), TypeError);
  assert.throws(() => buildSceneDossier({ entity: {} }), TypeError);
  assert.throws(() => renderSceneDossier({}), TypeError);
});

/**
 * DialogueContext gate (task 86) — the character's dialogue context
 * derived from CONFIRMED preferences:
 *   - voice from the tonality centroid through the pinned VOICE_MAP
 *     (dominant pole = register, traits union, honest unmeasured axes);
 *   - vocabulary: era tokens (task-84 expansion), place cue, confirmed
 *     topic words with deterministic ordering;
 *   - references: confirmed favorites with the task-60 priority-chain
 *     percent and deterministic cue templates;
 *   - the machine-checkable speaker contract (isConfirmedReference);
 *   - anti-fabrication (names/tags/era only from the bundle),
 *     determinism, deep-freeze, TypeError guards, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'dialogue-context-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  buildDialogueContext, renderDialogueContext, isConfirmedReference,
  VOICE_MAP, DIALOGUE_RULES,
} = await import('../src/modes/DialogueContext.js');
const { TONE_POLES } = await import('../src/engine/TonalityEngine.js');
const { contextTokens } = await import('../src/modes/SceneContext.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const tag = (name) => ({ id: `urn:tag:t:${name}`, name, type: 'urn:tag:t' });

const syntheticBundle = () => ({
  entity: { id: 'e1', name: 'Village Atheist', category: 'film' },
  scene: { era: '1970s', location: 'Berlin', geohash: null, startYear: 1970, endYear: 1979 },
  tonality: {
    coherent: true,
    centroid: { axes: { dark_light: -0.8, minimal_ornate: -0.4, intense_calm: 0.2 }, support: 5 },
    contradictions: [],
  },
  ranked: [
    { domain: 'music', name: 'Neon Choir', affinity: 0.9, tags: [tag('Gothic'), tag('Night')] },
    { domain: 'books', name: 'Ash Novel', correlation: 0.7, tags: [tag('Gothic')] },
  ],
  layers: {},
  failures: [],
});

test('voice: dominant pole sets the register, traits union over measured axes', () => {
  const ctx = buildDialogueContext(syntheticBundle());

  assert.equal(ctx.voice.register, VOICE_MAP.dark.register, 'dominant dark_light (-0.8)');
  assert.deepEqual({ ...ctx.voice.dominant },
    { axis: 'dark_light', label: 'dark', value: -0.8 });
  for (const trait of ['understatement', 'morbid humour', 'short sentences', 'even pace']) {
    assert.ok(ctx.voice.traits.includes(trait), `trait ${trait}`);
  }
  assert.equal(ctx.voice.coherent, true);
  assert.equal(ctx.voice.support, 5);
  assert.equal(ctx.stats.measuredAxes, 3);
});

test('VOICE_MAP: pinned entry by entry, key set equals the pole side labels', () => {
  const labels = TONE_POLES.flatMap((pole) => [pole.negative.label, pole.positive.label]);
  assert.deepEqual([...Object.keys(VOICE_MAP)].sort(), [...labels].sort());
  for (const pole of TONE_POLES) {
    for (const side of ['negative', 'positive']) {
      const label = pole[side].label;
      const value = side === 'positive' ? 0.9 : -0.9;
      const ctx = buildDialogueContext({
        ...syntheticBundle(),
        scene: null,
        tonality: { coherent: true, centroid: { axes: { [pole.id]: value }, support: 1 }, contradictions: [] },
      });
      assert.equal(ctx.voice.register, VOICE_MAP[label].register, `${pole.id}/${label} register`);
      for (const trait of VOICE_MAP[label].traits) {
        assert.ok(ctx.voice.traits.includes(trait), `${pole.id}/${label} trait ${trait}`);
      }
    }
  }
});

test('voice honesty: unmeasured axes contribute nothing', () => {
  const ctx = buildDialogueContext({
    ...syntheticBundle(),
    scene: null,
    tonality: { coherent: null, centroid: { axes: { dark_light: 'x', bogus_pole: -1 }, support: null }, contradictions: [] },
  });
  assert.equal(ctx.voice.register, 'neutral');
  assert.deepEqual([...ctx.voice.traits], []);
  assert.equal(ctx.voice.dominant, null);
  assert.equal(ctx.voice.coherent, null);
  assert.equal(ctx.stats.measuredAxes, 0);
});

test('vocabulary: era expansion, place cue, deterministic topic words', () => {
  const ctx = buildDialogueContext(syntheticBundle());
  assert.deepEqual([...ctx.vocabulary.era], [...contextTokens(syntheticBundle().scene)]);
  assert.deepEqual([...ctx.vocabulary.era], ['1970', '1970s', '1979', '70s']);
  assert.equal(ctx.vocabulary.place, 'Berlin');
  assert.deepEqual([...ctx.vocabulary.topics], ['gothic', 'night']);

  const noScene = buildDialogueContext({ ...syntheticBundle(), scene: null });
  assert.deepEqual([...noScene.vocabulary.era], []);
  assert.equal(noScene.vocabulary.place, null);
});

test('references: confirmed favorites with priority-chain percent and cues', () => {
  const ctx = buildDialogueContext(syntheticBundle());
  assert.equal(ctx.references.length, 2);
  assert.deepEqual(ctx.references.map((r) => r.name), ['Neon Choir', 'Ash Novel']);
  assert.equal(ctx.references[0].affinityPercent, 90);
  assert.equal(ctx.references[1].affinityPercent, 70, 'correlation via the task-60 chain');
  assert.match(ctx.references[0].cue, /cites "Neon Choir" as proof/);
  assert.equal(ctx.rules, DIALOGUE_RULES);
  assert.ok(Object.isFrozen(ctx));
  assert.ok(Object.isFrozen(ctx.references[0]));
});

test('speaker contract: isConfirmedReference is exact, case-insensitive, honest', () => {
  const ctx = buildDialogueContext(syntheticBundle());
  assert.equal(isConfirmedReference(ctx, 'Neon Choir'), true);
  assert.equal(isConfirmedReference(ctx, '  neon choir '), true);
  assert.equal(isConfirmedReference(ctx, 'Village Atheist'), true, 'the character themselves');
  assert.equal(isConfirmedReference(ctx, 'Some Random Band'), false);
  assert.equal(isConfirmedReference(ctx, 'Neon'), false, 'no substring forgiveness');
  assert.equal(isConfirmedReference(ctx, ''), false);
  assert.equal(isConfirmedReference(ctx, 42), false);
  assert.equal(isConfirmedReference(null, 'x'), false);
});

test('anti-fabrication: every name and word comes from the bundle', () => {
  const bundle = syntheticBundle();
  const ctx = buildDialogueContext(bundle);
  const rankedNames = new Set(bundle.ranked.map((r) => r.name));
  const tagWords = new Set(bundle.ranked.flatMap((r) => r.tags.map((t) => t.name.toLowerCase())));
  const eraTokens = new Set(contextTokens(bundle.scene));
  for (const ref of ctx.references) {
    assert.ok(rankedNames.has(ref.name), `invented reference: ${ref.name}`);
  }
  for (const topic of ctx.vocabulary.topics) {
    assert.ok(tagWords.has(topic), `invented topic: ${topic}`);
  }
  for (const token of ctx.vocabulary.era) {
    assert.ok(eraTokens.has(token), `invented era token: ${token}`);
  }
});

test('real bundle integration: the dialogue appendix frames an in-character run', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  const ctx = buildDialogueContext(bundle);
  assert.equal(ctx.character.name, 'Hereditary');
  assert.ok(ctx.references.length > 0);
  assert.ok(ctx.vocabulary.topics.length > 0, 'stub tags feed topic words');

  const document = renderDialogueContext(ctx);
  assert.match(document, /^DIALOGUE CONTEXT — Hereditary \(film\)$/m);
  assert.match(document, /^VOICE: register /m);
  assert.match(document, /^CONFIRMED REFERENCES \(the character may cite ONLY these\):$/m);
  assert.match(document, /^ {3}- .+ \(.+?, \d+%?\)$/m);
  assert.match(document, /^RULES: cite only confirmed references/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis');

  const top = ctx.references[0].name;
  assert.equal(isConfirmedReference(ctx, top), true);
  assert.equal(isConfirmedReference(ctx, 'Definitely Not In The Dossier'), false);
});

test('render honesty: an unproven character defers on all cultural claims', () => {
  const ctx = buildDialogueContext({
    entity: { id: 'e2', name: 'Blank Slate', category: 'film' },
    ranked: [],
    layers: {},
    failures: [],
  });
  const document = renderDialogueContext(ctx);
  assert.match(document, /\(none proven — the character defers on all cultural claims\)/);
  assert.match(document, /VOCABULARY: none proven beyond the references/);
});

test('determinism and option bounds', () => {
  const a = buildDialogueContext(syntheticBundle());
  const b = buildDialogueContext(syntheticBundle());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(renderDialogueContext(a), renderDialogueContext(b));

  const limited = buildDialogueContext(syntheticBundle(), { maxReferences: 1, maxTopicWords: 1 });
  assert.equal(limited.references.length, 1);
  assert.equal(limited.vocabulary.topics.length, 1);
  for (const bad of [0, 51, 1.5]) {
    assert.throws(() => buildDialogueContext(syntheticBundle(), { maxReferences: bad }), TypeError);
    assert.throws(() => buildDialogueContext(syntheticBundle(), { maxTopicWords: bad }), TypeError);
  }
  assert.throws(() => buildDialogueContext(null), TypeError);
  assert.throws(() => buildDialogueContext({ entity: {} }), TypeError);
  assert.throws(() => renderDialogueContext({}), TypeError);
});

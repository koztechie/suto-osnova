/**
 * SceneContext integration gate (task 84) — the era + geographic
 * location parameters of a scene, end to end:
 *   - parseSceneContext: normalization, bounds, geohash/years rules,
 *     the TypeError vs SceneContextError split, null for absence;
 *   - contextTokens: deterministic era decade expansion;
 *   - applyContextBoost: the documented selection bias (per-dimension
 *     boost, cap at 1, null affinity stays null, rows never dropped,
 *     legacy no-context pass-through pinned);
 *   - WorldbuilderMode: synchronous validation before any client
 *     call, boosted candidates beating the threshold only with the
 *     context present, the bundle scene echo, legacy determinism;
 *   - SceneDossierTemplate: the scene line in the rendered dossier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'scene-context-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  parseSceneContext, contextTokens, applyContextBoost, contextParams,
  SceneContextError, CONTEXT_CODES, CONTEXT_DEFAULTS,
} = await import('../src/modes/SceneContext.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const {
  buildSceneDossier, renderSceneDossier,
} = await import('../src/modes/SceneDossierTemplate.js');
const { searchStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const tag = (name) => ({ id: `urn:tag:era:${name}`, name, type: 'urn:tag:era' });

test('parseSceneContext: normalization, absence and the error split', () => {
  assert.equal(parseSceneContext(null), null);
  assert.equal(parseSceneContext(undefined), null);
  assert.equal(parseSceneContext({}), null, 'all-empty is no context');

  const ctx = parseSceneContext({ era: '  1970s\u0301  Post-Punk ', location: ' Berlin ' });
  assert.equal(ctx.era, '1970s\u0301 Post-Punk'.normalize('NFC'));
  assert.equal(ctx.location, 'Berlin');
  assert.ok(Object.isFrozen(ctx));

  // Typed VALUE errors.
  for (const [input, code] of [
    [{ era: 'a' }, CONTEXT_CODES.INVALID_ERA],
    [{ era: 'x'.repeat(41) }, CONTEXT_CODES.INVALID_ERA],
    [{ era: '' }, CONTEXT_CODES.INVALID_ERA],
    [{ location: 'x' }, CONTEXT_CODES.INVALID_LOCATION],
    [{ geohash: 'abc' }, CONTEXT_CODES.INVALID_GEOHASH],
    [{ geohash: 'u4pr-i' }, CONTEXT_CODES.INVALID_GEOHASH],
    [{ startYear: 1799 }, CONTEXT_CODES.INVALID_YEARS],
    [{ endYear: 2101 }, CONTEXT_CODES.INVALID_YEARS],
    [{ startYear: 1990, endYear: 1980 }, CONTEXT_CODES.INVALID_YEARS],
  ]) {
    try {
      parseSceneContext(input);
      assert.fail(`must reject ${JSON.stringify(input)}`);
    } catch (error) {
      assert.ok(error instanceof SceneContextError, `${JSON.stringify(input)} -> typed`);
      assert.equal(error.code, code);
    }
  }

  // Programmer TYPE errors.
  for (const bad of [42, 'Berlin', [], { era: 7 }, { location: {} }, { startYear: '1990' }]) {
    assert.throws(() => parseSceneContext(bad), TypeError, `${String(bad)} -> TypeError`);
  }

  // Valid geohash + years.
  const full = parseSceneContext({ geohash: 'U4PRUYD', startYear: 1970, endYear: 1979 });
  assert.equal(full.geohash, 'u4pruyd');
  assert.equal(full.startYear, 1970);
  assert.equal(full.endYear, 1979);
});

test('contextTokens: deterministic decade expansion', () => {
  assert.deepEqual([...contextTokens(parseSceneContext({ era: '1970s' }))],
    ['1970', '1970s', '70s']);
  assert.deepEqual([...contextTokens(parseSceneContext({ startYear: 1970, endYear: 1979 }))],
    ['1970', '1970s', '1979', '70s']);
  assert.deepEqual([...contextTokens(null)], []);
});

test('applyContextBoost: per-dimension bias, cap, honesty, legacy pass-through', () => {
  const rows = [
    { id: 'r1', name: 'West Berlin Cabaret', affinity: 0.62, tags: [tag('Berlin'), tag('1970s')] },
    { id: 'r2', name: 'Mainstream Pop', affinity: 0.9, tags: [] },
    { id: 'r3', name: 'Unscored relic', affinity: null, tags: [tag('Berlin')] },
  ];

  // Legacy: no context -> identical rows (frozen copies, no annotation).
  const plain = applyContextBoost(rows, null);
  assert.deepEqual(JSON.parse(JSON.stringify(plain)), rows);
  assert.ok(!Object.hasOwn(plain[0], 'contextMatch'), 'no context -> no annotation');

  const ctx = parseSceneContext({ era: '1970s', location: 'Berlin' });
  const boosted = applyContextBoost(rows, ctx);
  const [berlin, mainstream, relic] = boosted;

  assert.equal(berlin.affinityBase, 0.62);
  assert.equal(berlin.affinity, 0.62 + CONTEXT_DEFAULTS.boost * 2, 'both dimensions hit');
  assert.deepEqual({ ...berlin.contextMatch }, { era: true, location: true });

  assert.equal(mainstream.affinity, 0.9, 'no match -> no boost');
  assert.deepEqual({ ...mainstream.contextMatch }, { era: false, location: false });

  assert.equal(relic.affinity, null, 'missing affinity stays missing');
  assert.deepEqual({ ...relic.contextMatch }, { era: false, location: true });
  assert.ok(Object.isFrozen(berlin));

  // The cap at 1.
  const near = applyContextBoost(
    [{ id: 'r9', name: 'Berlin 1970s', affinity: 0.99, tags: [tag('Berlin'), tag('1970s')] }],
    ctx
  );
  assert.equal(near[0].affinity, 1);

  // Boost bounds.
  for (const bad of [-0.1, 0.6, Number.NaN]) {
    assert.throws(() => applyContextBoost(rows, ctx, { boost: bad }), TypeError);
  }

  // The reserved passthrough never guesses.
  assert.deepEqual({ ...contextParams(ctx) }, {});
});

const sceneAffinityFn = (calls) => async (ids, domain) => {
  calls.push(domain);
  if (domain === 'film') {
    return {
      results: [
        { id: UUID('bbbbbbb0'), name: 'West Berlin Cabaret', subtype: 'urn:entity:movie', affinity: 0.62, popularity: 0.3, tags: [tag('Berlin'), tag('1970s')] },
        { id: UUID('ccccccc0'), name: 'Mainstream Pop', subtype: 'urn:entity:movie', affinity: 0.9, popularity: 0.95 },
      ],
    };
  }
  return {
    results: [
      { id: UUID(`d${domain.length}00000`), name: `Filler ${domain}`, subtype: 'urn:entity:artist', affinity: 0.9, popularity: 0.5 },
    ],
  };
};

const baseOptions = (calls) => ({
  affinityFn: sceneAffinityFn(calls),
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: tagsStub,
  synthesis: false,
});

test('mode: a bad scene is rejected BEFORE any client call', async () => {
  const calls = [];
  await assert.rejects(
    () => runWorldbuilder('A24 Psychological Horror', {
      ...baseOptions(calls), scene: { location: 'x' },
    }),
    SceneContextError
  );
  await assert.rejects(
    () => runWorldbuilder('A24 Psychological Horror', {
      ...baseOptions(calls), scene: { era: 1970 },
    }),
    TypeError
  );
  await assert.rejects(
    () => runWorldbuilder('A24 Psychological Horror', {
      ...baseOptions(calls), contextBoost: 2,
    }),
    TypeError
  );
  assert.deepEqual(calls, [], 'validation is synchronous and first');
});

test('mode: era+location bias admits a candidate the plain run rejects', async () => {
  const withCalls = [];
  const withScene = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions(withCalls),
    scene: { era: '1970s', location: 'Berlin' },
  });

  assert.deepEqual({ ...withScene.scene },
    { era: '1970s', location: 'Berlin', geohash: null, startYear: null, endYear: null });
  const boosted = withScene.ranked.find((e) => e.name === 'West Berlin Cabaret');
  assert.ok(boosted, 'the era+place-fitting pick survived the gate');
  assert.equal(boosted.affinityBase, 0.62);
  assert.equal(boosted.affinity, 0.72, 'boost applied before the 0.65 gate');
  assert.deepEqual({ ...boosted.contextMatch }, { era: true, location: true });

  // The counterfactual: the same run without context rejects it.
  const plain = await runWorldbuilder('A24 Psychological Horror', baseOptions([]));
  assert.equal(plain.scene, null);
  assert.ok(!plain.ranked.some((e) => e.name === 'West Berlin Cabaret'),
    '0.62 < 0.65 — no bias, no pass');

  // Legacy determinism: undefined scene and null scene are the same run.
  const alsoPlain = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions([]), scene: null,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(plain)),
    JSON.parse(JSON.stringify(alsoPlain))
  );
});

test('template: the scene line frames the rendered dossier', async () => {
  const bundle = await runWorldbuilder('A24 Psychological Horror', {
    ...baseOptions([]),
    scene: { era: '1970s', location: 'Berlin', startYear: 1970, endYear: 1979 },
  });
  const template = buildSceneDossier(bundle);
  assert.deepEqual({ ...template.scene },
    { era: '1970s', location: 'Berlin', geohash: null, startYear: 1970, endYear: 1979 });

  const document = renderSceneDossier(template);
  assert.match(document, /^Scene: 1970s — Berlin \[1970–1979\]$/m);
  assert.ok(!/\p{Extended_Pictographic}/u.test(document), 'zero emojis retained');

  // Context-less runs render no scene line.
  const plain = buildSceneDossier(await runWorldbuilder('A24 Psychological Horror', baseOptions([])));
  assert.equal(plain.scene, null);
  assert.ok(!/^Scene:/m.test(renderSceneDossier(plain)));
});

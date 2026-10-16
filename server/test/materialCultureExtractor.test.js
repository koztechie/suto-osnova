/**
 * Material culture extractor tests (task 53) — pins the material-layer
 * contract with injected clients (zero network): three parallel legs
 * (place affinity, brand affinity, entity-scoped /v2/tags), four-family
 * classification via exported marker tables, carrier-share weights,
 * household OBJECTS as ranked entities, cross-family overlap, leg
 * isolation, typed failures and deterministic frozen outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'material-culture-test-key';

const {
  extractMaterialProfile,
  matchTagMarkers,
  MaterialCultureError,
  MATERIAL_CODES,
  MATERIAL_DEFAULTS,
  MATERIAL_LEGS,
  MATERIAL_TAG_TYPES,
  ARCHITECTURE_MARKERS,
  TEXTURE_MARKERS,
  CLOTHING_MARKERS,
  HOUSEHOLD_MARKERS,
} = await import('../src/services/materialCultureExtractor.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ANCHOR = { id: UUID('SEED000'), name: 'Blade Runner', category: 'film' };

const tag = (family, value, name) => ({
  id: `urn:tag:${family}:${value}`,
  name,
  type: `urn:tag:${family}`,
});

const BRUTALIST = tag('genre:media', 'brutalist', 'Brutalist');
const VELVET = tag('genre:media', 'velvet', 'Velvet');

const KETTLE = {
  id: UUID('PLC0001'),
  name: 'Kettle House',
  subtype: 'urn:entity:place',
  affinity: 0.8,
  popularity: 0.6,
  tags: [
    BRUTALIST,
    tag('genre:place', 'concrete', 'Concrete'),
    tag('genre:place', 'ceramics', 'Ceramics'),
    { id: 'urn:tag:genre:place:restaurant', name: 'Restaurant', type: 'urn:tag:genre:place' },
  ],
};
const DINER = {
  id: UUID('PLC0002'),
  name: 'Neon Diner',
  subtype: 'urn:entity:place',
  affinity: 0.6,
  popularity: 0.5,
  tags: [tag('genre:place', 'tableware', 'Tableware')],
};
const ACME = {
  id: UUID('BRD0001'),
  name: 'Acme Apparel',
  subtype: 'urn:entity:brand',
  affinity: 0.9,
  popularity: 0.7,
  tags: [tag('genre:brand', 'streetwear', 'Streetwear'), tag('genre:brand', 'denim', 'Denim')],
};
const CASA = {
  id: UUID('BRD0002'),
  name: 'Casa Living',
  subtype: 'urn:entity:brand',
  affinity: 0.7,
  popularity: 0.4,
  tags: [
    tag('genre:brand', 'furniture', 'Furniture'),
    tag('genre:brand', 'interior', 'Interior'),
    VELVET,
  ],
};

const CATALOG_TAGS = [
  BRUTALIST, // same URN as Kettle's -> merged sources
  tag('genre:media', 'art_deco', 'Art Deco'),
  VELVET, // same URN as Casa's -> merged sources
];

const stubs = () => ({
  affinityFn: async (ids, urn) => {
    if (urn === 'urn:entity:place') return { results: [KETTLE, DINER] };
    return { results: [ACME, CASA] };
  },
  tagsFn: async () => ({ results: CATALOG_TAGS }),
});

test('anchor validation typed, clients never called', async () => {
  let calls = 0;
  const affinityFn = async () => { calls += 1; return { results: [] }; };
  const tagsFn = async () => { calls += 1; return { results: [] }; };

  for (const bad of [null, {}, { id: 7 }]) {
    await assert.rejects(
      () => extractMaterialProfile(bad, { affinityFn, tagsFn }),
      (err) => err instanceof MaterialCultureError && err.code === MATERIAL_CODES.NO_ANCHOR
    );
  }
  assert.equal(calls, 0);
});

test('full assembly: four families classified, weights and objects ranked', async () => {
  const profile = await extractMaterialProfile(ANCHOR, stubs());

  // Architecture: carriers first, anchor-catalog-only second.
  assert.deepEqual(profile.architecture.map((t) => t.name), ['Brutalist', 'Art Deco']);
  assert.deepEqual([...profile.architecture[0].sources], ['anchor_tags', 'place']);
  assert.equal(profile.architecture[0].carriers, 1);
  assert.ok(Math.abs(profile.architecture[0].weight - 1 / 4) < 1e-12, 'carrier share of 4 entities');
  assert.deepEqual([...profile.architecture[1].sources], ['anchor_tags']);

  // Textures: merged brand + catalog, alphabetical on ties.
  assert.deepEqual(profile.textures.map((t) => t.name), ['Concrete', 'Denim', 'Velvet']);
  assert.deepEqual([...profile.textures[2].sources], ['anchor_tags', 'brand']);

  // Clothing styles.
  assert.deepEqual(profile.clothingStyles.map((t) => t.name), ['Streetwear']);

  // Objects: household entities, marker count first, then correlation.
  assert.deepEqual(profile.objects.map((o) => o.name), ['Casa Living', 'Kettle House', 'Neon Diner']);
  assert.deepEqual([...profile.objects[0].householdMarkers], ['furniture', 'interior']);
  assert.equal(profile.objects[1].category, 'dining', 'restaurant tag family classifies the place');
  assert.equal(profile.objects[2].category, null);

  assert.deepEqual({ ...profile.coverage }, {
    architecture: true,
    textures: true,
    clothingStyles: true,
    objects: true,
    entities: 4,
    tags: 11, // 5 place + 5 brand + 1 catalog-only (art_deco)
  });
  assert.deepEqual(profile.failures, []);
});

test('legs: URNs, takes and tag-type families passed through', async () => {
  const seen = { affinity: [], tags: [] };
  const affinityFn = async (ids, urn, opts) => {
    seen.affinity.push({ urn, opts });
    return { results: [] };
  };
  const tagsFn = async (entityId, type, opts) => {
    seen.tags.push({ entityId, type, opts });
    return { results: [] };
  };

  await extractMaterialProfile(ANCHOR, { ...stubs(), affinityFn, tagsFn, entityTake: 7, tagsTake: 33 });

  assert.deepEqual(seen.affinity.map((s) => s.urn).sort(), ['urn:entity:brand', 'urn:entity:place']);
  assert.ok(seen.affinity.every((s) => s.opts.take === 7));
  assert.deepEqual([...seen.tags[0].type], [...MATERIAL_TAG_TYPES]);
  assert.equal(seen.tags[0].opts.take, 33);
  assert.equal(MATERIAL_DEFAULTS.tagsTake, 30);
});

test('cross-family overlap: one tag can inform two families', async () => {
  const hybrid = { id: 'urn:tag:x:hybrid', name: 'Fashion Textile', type: 'urn:tag:x' };
  const profile = await extractMaterialProfile(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [hybrid] }),
  });

  assert.deepEqual(profile.clothingStyles.map((t) => t.name), ['Fashion Textile']);
  assert.deepEqual(profile.textures.map((t) => t.name), ['Fashion Textile']);
});

test('leg isolation: tags leg failure never aborts the entity legs', async () => {
  const profile = await extractMaterialProfile(ANCHOR, {
    ...stubs(),
    tagsFn: async () => {
      throw Object.assign(new Error('tags 503'), { code: 'UPSTREAM_ERROR' });
    },
  });

  assert.deepEqual(profile.failures.map((f) => f.leg), ['tags']);
  assert.equal(profile.coverage.objects, true, 'entity legs unaffected');
  assert.ok(profile.architecture.length > 0, 'entity-carried tags still classify');
});

test('all legs failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => extractMaterialProfile(ANCHOR, { affinityFn: down, tagsFn: down }),
    (err) =>
      err instanceof MaterialCultureError &&
      err.code === MATERIAL_CODES.ALL_LEGS_FAILED &&
      err.details.failures.length === MATERIAL_LEGS.length
  );

  await assert.rejects(
    () => extractMaterialProfile(ANCHOR, { ...stubs(), tagsFn: down, strict: true }),
    (err) => err.code === MATERIAL_CODES.PARTIAL_FAILURE
  );
});

test('materialLimit caps every family', async () => {
  const profile = await extractMaterialProfile(ANCHOR, { ...stubs(), materialLimit: 1 });
  assert.equal(profile.architecture.length, 1);
  assert.equal(profile.textures.length, 1);
  assert.equal(profile.objects.length, 1);
  assert.equal(profile.objects[0].name, 'Casa Living', 'top-ranked object survives the cap');
});

test('dedup: repeated entity ids merge (first leg wins), tag carriers count entities', async () => {
  const profile = await extractMaterialProfile(ANCHOR, {
    affinityFn: async (ids, urn) => {
      if (urn === 'urn:entity:place') return { results: [KETTLE, { ...KETTLE, affinity: 0.1 }] };
      return { results: [{ ...KETTLE, subtype: 'urn:entity:brand' }, ACME] };
    },
    tagsFn: async () => ({ results: [] }),
  });

  const kettle = profile.objects.filter((o) => o.name === 'Kettle House');
  assert.equal(kettle.length, 1, 'entity kept once across both legs');
  assert.equal(kettle[0].affinity, 0.8, 'first leg occurrence wins');

  const brutalist = profile.architecture.find((t) => t.name === 'Brutalist');
  assert.equal(brutalist.carriers, 1, 'one carrier entity, not two rows');
});

test('marker units: family tables fold variants', () => {
  assert.deepEqual(matchTagMarkers({ name: 'Art Deco', id: 'x' }, ARCHITECTURE_MARKERS), ['art-deco']);
  assert.deepEqual(matchTagMarkers({ name: 'Loose Denim', id: 'urn:tag:x:denim' }, TEXTURE_MARKERS), ['denim']);
  assert.deepEqual(matchTagMarkers({ name: 'Streetwear', id: 'x' }, CLOTHING_MARKERS), ['streetwear']);
  assert.deepEqual(matchTagMarkers({ name: 'Home Decor', id: 'x' }, HOUSEHOLD_MARKERS), ['home-decor', 'decor']);
  assert.deepEqual(matchTagMarkers(null, HOUSEHOLD_MARKERS), []);
});

test('empty legs are not failures', async () => {
  const profile = await extractMaterialProfile(ANCHOR, {
    affinityFn: async () => ({ results: [] }),
    tagsFn: async () => ({ results: [] }),
  });

  assert.deepEqual(profile.failures, []);
  assert.deepEqual({ ...profile.coverage }, {
    architecture: false,
    textures: false,
    clothingStyles: false,
    objects: false,
    entities: 0,
    tags: 0,
  });
  assert.deepEqual(profile.objects, []);
});

test('outputs are deeply frozen, serializable and deterministic', async () => {
  const run = () => extractMaterialProfile(ANCHOR, stubs());

  const profile = await run();
  assert.deepEqual(await run(), profile, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.architecture));
  assert.ok(Object.isFrozen(profile.architecture[0].sources));
  assert.ok(Object.isFrozen(profile.objects));
  assert.ok(Object.isFrozen(profile.objects[0].householdMarkers));
  assert.throws(() => {
    profile.objects[0].rank = 9;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(profile)).objects[0].name, 'Casa Living', 'serializable');
});

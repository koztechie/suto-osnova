/**
 * Sound extractor tests (task 51) — pins the sound-layer contract with
 * injected clients (zero network): two-phase assembly (artists +
 * anchor-scoped genre tags in parallel, then album queries), genre
 * marker merging with carrier-share weights, ambient-first album
 * ranking, per-leg failure isolation, typed vector-level failures,
 * frozen deterministic outputs and the ambient detection tables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'sound-extractor-test-key';

const {
  extractSoundProfile,
  isMusicGenreTag,
  matchAmbientMarkers,
  collectGenreTags,
  rankAlbums,
  SoundExtractionError,
  SOUND_CODES,
  SOUND_DEFAULTS,
  SOUND_LEGS,
} = await import('../src/services/soundExtractor.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const ANCHOR = { id: UUID('SEED000'), name: 'Blade Runner', category: 'film' };

const genreTag = (value, name) => ({
  id: `urn:tag:genre:music:${value}`,
  name,
  type: 'urn:tag:genre:music',
});

const artist = (tag, name, affinity, tags = []) => ({
  id: UUID(tag),
  name,
  subtype: 'urn:entity:artist',
  popularity: 0.7,
  affinity,
  tags,
});

const album = (tag, name, over = {}) => ({
  id: UUID(tag),
  name,
  subtype: 'urn:entity:album',
  popularity: over.popularity ?? 0.5,
  affinity: over.affinity ?? null,
  tags: over.tags ?? [],
});

const VANGELIS = artist('ART0001', 'Vangelis', 0.9, [
  genreTag('rock', 'Rock'),
  genreTag('ambient', 'Ambient'),
]);
const TANGERINE = artist('ART0002', 'Tangerine Dream', 0.7, [
  { id: 'urn:tag:genre:music:ambiental', name: 'Ambiental', type: 'urn:tag:genre:music' },
]);
const KITARO = artist('ART0003', 'Kitaro', 0.5, [
  { id: 'urn:tag:genre:music:new_age', name: 'New Age', type: 'urn:tag:genre:music' },
]);

const ANCHOR_TAGS_PAGE = {
  results: [
    genreTag('rock', 'Rock'),
    genreTag('ambient', 'Ambient'),
    { id: 'urn:tag:genre:film:sci_fi', name: 'Sci Fi', type: 'urn:tag:genre:film' },
  ],
};

const defaultStubs = () => ({
  affinityFn: async () => ({ results: [VANGELIS, TANGERINE, KITARO] }),
  tagsFn: async () => ANCHOR_TAGS_PAGE,
  searchFn: async () => ({ results: [] }),
});

test('anchor validation: no_anchor typed, clients never called', async () => {
  let calls = 0;
  const stubs = {
    affinityFn: async () => { calls += 1; return { results: [] }; },
    tagsFn: async () => { calls += 1; return { results: [] }; },
    searchFn: async () => { calls += 1; return { results: [] }; },
  };

  for (const bad of [null, {}, { id: 42 }, { id: '' }]) {
    await assert.rejects(
      () => extractSoundProfile(bad, stubs),
      (err) => err instanceof SoundExtractionError && err.code === SOUND_CODES.NO_ANCHOR
    );
  }
  assert.equal(calls, 0, 'zero quota on an unresolvable anchor');
});

test('full assembly: artists ranked, genres merged with weights, ambient albums first', async () => {
  const SAW = album('ALB0001', 'Selected Ambient Works', {
    popularity: 0.6,
    tags: [genreTag('ambient', 'Ambient'), genreTag('electronic', 'Electronic')],
  });
  const HITS = album('ALB0002', 'Blade Runner Hits', { popularity: 0.9 });
  const ZEIT = album('ALB0003', 'Zeitgeist', {
    popularity: 0.4,
    tags: [{ id: 'urn:tag:genre:music:lo_fi', name: 'Lo Fi', type: 'urn:tag:genre:music' }],
  });

  const searchPages = {
    'Blade Runner': { results: [SAW, HITS] },
    Vangelis: { results: [SAW, ZEIT] }, // SAW repeats -> dedup by id
    'Tangerine Dream': { results: [] },
  };
  const stubs = {
    ...defaultStubs(),
    searchFn: async (query) => searchPages[query] ?? { results: [] },
  };

  const profile = await extractSoundProfile(ANCHOR, stubs);

  // Artists: affinity-desc ranks with genre tags and ambient flags.
  assert.deepEqual(profile.artists.map((a) => a.name), ['Vangelis', 'Tangerine Dream', 'Kitaro']);
  assert.equal(profile.artists[0].rank, 1);
  assert.equal(profile.artists[0].affinity, 0.9);
  assert.equal(profile.artists[0].ambientTagged, true);
  assert.equal(profile.artists[2].ambientTagged, true, 'New Age is an ambient marker');

  // Genres: anchor tags + artist tags merged, carrier shares, ambient first.
  assert.deepEqual(profile.genres.map((g) => g.name), ['Ambient', 'Ambiental', 'New Age', 'Rock']);
  const rock = profile.genres.find((g) => g.name === 'Rock');
  assert.deepEqual([...rock.sources], ['anchor_tags', 'artist']);
  assert.equal(rock.carriers, 1);
  assert.ok(Math.abs(rock.weight - 1 / 3) < 1e-12, 'carrier share of 3 artists');
  assert.equal(rock.ambient, false, 'Rock stays non-ambient');

  // Albums: ambient-first, dedup keeps first query attribution.
  assert.deepEqual(profile.albums.map((a) => a.name), [
    'Selected Ambient Works',
    'Zeitgeist',
    'Blade Runner Hits',
  ]);
  assert.equal(profile.albums[0].via, 'Blade Runner');
  assert.equal(profile.albums[0].ambient, true);
  assert.deepEqual([...profile.albums[0].ambientMarkers], ['ambient']);
  assert.deepEqual([...profile.albums[1].ambientMarkers], ['lo-fi'], 'lo_fi folded to lo-fi');
  assert.equal(profile.albums[2].ambient, false);

  assert.deepEqual({ ...profile.coverage }, {
    artists: true,
    genres: true,
    albums: true,
    albumQueries: 3,
    albumsFailed: false,
  });
  assert.deepEqual(profile.failures, []);
});

test('album queries: anchor name first, then ranked artist names, deduplicated', async () => {
  const seen = [];
  const searchFn = async (query, types, opts) => {
    seen.push({ query, types, opts });
    return { results: [] };
  };

  await extractSoundProfile(
    { id: ANCHOR.id, name: 'Vangelis' }, // anchor name equals top artist
    { ...defaultStubs(), searchFn, maxAlbumQueries: 3 }
  );

  assert.deepEqual(seen.map((s) => s.query), ['Vangelis', 'Tangerine Dream', 'Kitaro']);
  assert.ok(seen.every((s) => s.types.length === 1 && s.types[0] === 'urn:entity:album'));
  assert.ok(seen.every((s) => s.opts.take === SOUND_DEFAULTS.albumTake));
});

test('ambient detection units: markers fold variants, music-family filter', () => {
  assert.deepEqual(matchAmbientMarkers({ name: 'Lo Fi Beats', id: 'urn:tag:genre:music:lo_fi' }), ['lo-fi']);
  assert.deepEqual(matchAmbientMarkers({ name: 'Ambient', id: 'x' }), ['ambient']);
  assert.deepEqual(matchAmbientMarkers({ name: 'Rock', id: 'urn:tag:genre:music:rock' }), []);
  assert.deepEqual(matchAmbientMarkers(null), []);

  assert.equal(isMusicGenreTag(genreTag('rock', 'Rock')), true);
  assert.equal(isMusicGenreTag({ id: 'urn:tag:subgenre:music:shoegaze', name: 'Shoegaze' }), true);
  assert.equal(isMusicGenreTag({ id: 'urn:tag:genre:film:sci_fi', name: 'Sci Fi' }), false);
  assert.equal(isMusicGenreTag(null), false);
});

test('collectGenreTags: dedup across entities, non-music filtered out', () => {
  const tags = collectGenreTags([
    { tags: [genreTag('rock', 'Rock'), { id: 'urn:tag:genre:film:x', name: 'Film' }] },
    { tags: [genreTag('rock', 'Rock'), genreTag('ambient', 'Ambient')] },
    { tags: 'not-an-array' },
  ]);
  assert.deepEqual(tags.map((t) => t.name).sort(), ['Ambient', 'Rock']);
});

test('rankAlbums: ambient-first, marker count, popularity, via passthrough, cap', () => {
  const ranked = rankAlbums(
    [
      album('A1', 'Plain Hit', { popularity: 0.99 }),
      album('A2', 'Soft Drone', { popularity: 0.1, tags: [genreTag('drone', 'Drone')] }),
      album('A3', 'Ambient Pop', { popularity: 0.8, tags: [genreTag('ambient', 'Ambient')] }),
    ],
    10
  );
  assert.deepEqual(ranked.map((a) => a.name), ['Ambient Pop', 'Soft Drone', 'Plain Hit']);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[2].via, null);

  assert.equal(rankAlbums([album('A1', 'X'), album('A2', 'Y')], 1).length, 1, 'cap applies');
});

test('leg isolation: artists failure captured, other legs survive', async () => {
  const stubs = {
    ...defaultStubs(),
    affinityFn: async () => {
      throw Object.assign(new Error('insights down'), { code: 'UPSTREAM_ERROR' });
    },
    searchFn: async () => ({ results: [album('ALB9', 'Solo Album')] }),
  };

  const profile = await extractSoundProfile(ANCHOR, stubs);

  assert.equal(profile.coverage.artists, false);
  assert.equal(profile.coverage.genres, true);
  assert.equal(profile.coverage.albums, true);
  assert.deepEqual(
    profile.failures.map((f) => ({ leg: f.leg, code: f.code })),
    [{ leg: 'artists', code: 'UPSTREAM_ERROR' }]
  );
  assert.equal(profile.coverage.albumQueries, 1, 'anchor name only without artists');
});

test('album query failure: sibling queries survive, albumsFailed surfaces', async () => {
  const stubs = {
    ...defaultStubs(),
    searchFn: async (query) => {
      if (query === 'Vangelis') throw new Error('search 503');
      return { results: [album('ALB1', 'Kept Album')] };
    },
  };

  const profile = await extractSoundProfile(ANCHOR, stubs);

  assert.equal(profile.coverage.albumsFailed, true);
  assert.equal(profile.albums.length, 1);
  assert.deepEqual(profile.failures.map((f) => [f.leg, f.query]), [['albums', 'Vangelis']]);
});

test('all legs failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => extractSoundProfile(ANCHOR, { affinityFn: down, tagsFn: down, searchFn: down }),
    (err) =>
      err instanceof SoundExtractionError &&
      err.code === SOUND_CODES.ALL_LEGS_FAILED &&
      err.details.failures.length >= SOUND_LEGS.length
  );

  const stubs = defaultStubs();
  await assert.rejects(
    () =>
      extractSoundProfile(ANCHOR, {
        ...stubs,
        tagsFn: async () => {
          throw new Error('tags down');
        },
        strict: true,
      }),
    (err) => err.code === SOUND_CODES.PARTIAL_FAILURE
  );
});

test('no album queries possible: empty albums, not a failure', async () => {
  const profile = await extractSoundProfile(
    { id: ANCHOR.id }, // no name
    {
      ...defaultStubs(),
      affinityFn: async () => {
        throw new Error('no artists either');
      },
    }
  );

  assert.equal(profile.coverage.albumQueries, 0);
  assert.deepEqual(profile.albums, []);
  assert.equal(profile.coverage.albums, false);
  assert.equal(profile.coverage.albumsFailed, false);
  assert.deepEqual(profile.failures.map((f) => f.leg), ['artists']);
});

test('outputs are deeply frozen, serializable and deterministic', async () => {
  const run = () =>
    extractSoundProfile(ANCHOR, {
      ...defaultStubs(),
      searchFn: async () => ({ results: [album('ALB1', 'Ambient One', { tags: [genreTag('ambient', 'Ambient')] })] }),
    });

  const profile = await run();
  assert.deepEqual(await run(), profile, 'identical inputs -> identical records');

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.artists));
  assert.ok(Object.isFrozen(profile.artists[0].genreTags));
  assert.ok(Object.isFrozen(profile.genres[0].sources));
  assert.ok(Object.isFrozen(profile.albums));
  assert.throws(() => {
    profile.artists[0].rank = 9;
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(profile)).genres[0].name, 'Ambient', 'serializable');
});

/**
 * Sound extractor (task 51) — the SOUND LAYER of the dossier: from the
 * initial (resolved) cultural anchor it extracts
 *
 *   1. MUSIC ARTISTS     — entities of `urn:entity:artist` whose taste
 *                          profile Qloo considers close to the anchor
 *                          (cross-domain affinity, insights endpoint);
 *   2. GENRE MARKERS     — the anchor's music genre tags from the Qloo
 *                          tag catalog (`/v2/tags`, entity-scoped) plus
 *                          the genre tags carried by the related
 *                          artists — merged, deduplicated, and scored
 *                          by carrier share (how many of the related
 *                          artists carry the marker);
 *   3. AMBIENT ALBUMS    — albums (`urn:entity:album`) related to the
 *                          anchor, ranked AMBIENT-FIRST via genre-tag
 *                          marker matching.
 *
 * LIVE-VERIFIED ENDPOINT QUIRKS this module is built around (tasks
 * 20-23): `urn:entity:album` is ABSENT from the insights `filter.type`
 * enum — affinity INTO albums does not exist; albums are therefore
 * reached through `GET /search` (which accepts albums, verified 200)
 * by querying the anchor name and the top related artists' names.
 * Genre markers come from `GET /v2/tags` with `filter.entities` scoping
 * plus the artist entities' own tag lists.
 *
 * PIPELINE (two phases, each leg isolated):
 *   phase A (parallel):  artists leg  -> cross-domain affinity;
 *                        genres leg   -> entity-scoped genre tags;
 *   phase B (parallel):  albums leg   -> <=3 searches (anchor name,
 *                        top artist names, deduplicated).
 * A failing leg never aborts the others — it is captured as
 * {leg, code, message} and surfaced through `failures` + `coverage`.
 * Only when EVERY leg fails does the extraction fail typed
 * (SoundExtractionError, all_legs_failed); `strict: true` turns any
 * leg failure into a typed partial_failure.
 *
 * Purity where it matters: ranking, tagging and merging are pure and
 * exported (isMusicGenreTag, matchAmbientMarkers, collectGenreTags),
 * deterministic (no clocks/RNG), and every I/O client is INJECTABLE —
 * the whole module is testable with zero network.
 */

import { getCrossDomainAffinities } from './crossDomainClient.js';
import { searchEntities } from './entitySearchClient.js';
import { findTags } from './tasteTagsClient.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Typed error for sound-extraction failures. */
export class SoundExtractionError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SoundExtractionError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const SOUND_CODES = Object.freeze({
  NO_ANCHOR: 'no_anchor',
  ALL_LEGS_FAILED: 'all_legs_failed',
  PARTIAL_FAILURE: 'partial_failure',
});

/** Documented algorithm defaults. */
export const SOUND_DEFAULTS = Object.freeze({
  artistLimit: 5,
  albumLimit: 6,
  genreLimit: 8,
  artistTake: 10,
  genreTake: 20,
  albumTake: 20,
  maxAlbumQueries: 3,
});

/** The three extraction legs. */
export const SOUND_LEGS = Object.freeze(['artists', 'genres', 'albums']);

const ARTIST_URN = 'urn:entity:artist';
const ALBUM_URN = 'urn:entity:album';
const MUSIC_GENRE_TAG_RE = /^urn:tag:(genre|subgenre|category):music(?::|$)/;

/**
 * Ambient character markers, matched as substrings against normalized
 * tag haystacks (name + id, lowercased, underscores/spaces folded to
 * hyphens — so `lo_fi`, `Lo Fi` and `lo-fi` all hit the `lo-fi`
 * marker). Exported: the table is a tuning contract.
 */
export const AMBIENT_MARKERS = Object.freeze([
  'ambient',
  'ambiental',
  'downtempo',
  'lo-fi',
  'drone',
  'chillout',
  'chill-out',
  'atmospheric',
  'soundscape',
  'new-age',
  'meditation',
]);

const normalizeHaystack = (value) =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

/** True when the tag belongs to the music genre family. */
export function isMusicGenreTag(tag) {
  if (!tag || typeof tag !== 'object') return false;
  const id = typeof tag.id === 'string' ? tag.id : '';
  const type = typeof tag.type === 'string' ? tag.type : '';
  return MUSIC_GENRE_TAG_RE.test(id) || MUSIC_GENRE_TAG_RE.test(type);
}

/** Ambient markers matched by a tag (empty array = not ambient). */
export function matchAmbientMarkers(tag) {
  if (!tag || typeof tag !== 'object') return [];
  const haystack = `${tag.name ?? ''} ${tag.id ?? ''}`;
  const normalized = normalizeHaystack(haystack);
  return AMBIENT_MARKERS.filter((marker) => normalized.includes(marker));
}

/** Pure: deduplicated music-genre tags carried by a set of entities. */
export function collectGenreTags(entities) {
  const byId = new Map();
  for (const entity of Array.isArray(entities) ? entities : []) {
    for (const tag of Array.isArray(entity?.tags) ? entity.tags : []) {
      if (!isMusicGenreTag(tag)) continue;
      const key = typeof tag.id === 'string' && tag.id.length > 0 ? tag.id : tag.name;
      if (key && !byId.has(key)) {
        byId.set(key, { id: tag.id ?? null, name: tag.name ?? null, type: tag.type ?? null });
      }
    }
  }
  return [...byId.values()];
}

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Tolerant page-row extraction (client pages and bare arrays). */
function pageRows(page) {
  if (Array.isArray(page)) return page;
  if (page && typeof page === 'object') {
    if (Array.isArray(page.results)) return page.results;
    if (Array.isArray(page.results?.tags)) return page.results.tags;
  }
  return [];
}

const byAffinity = (a, b) =>
  (b.affinity ?? -1) - (a.affinity ?? -1) ||
  (b.popularity ?? -1) - (a.popularity ?? -1) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

/** Deterministic artist ranking, capped, with per-artist genre tags. */
function rankArtists(rows, limit) {
  const artists = rows
    .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string')
    .map((r) => ({
      id: r.id,
      name: r.name,
      subtype: nonEmptyString(r.subtype) ?? null,
      affinity: finiteNumber(r.affinity),
      popularity: finiteNumber(r.popularity),
      genreTags: collectGenreTags([r]),
    }))
    .sort(byAffinity);

  return artists.slice(0, limit).map((artist, index) => {
    const ambient = artist.genreTags.some((t) => matchAmbientMarkers(t).length > 0);
    return Object.freeze({
      id: artist.id,
      name: artist.name,
      subtype: artist.subtype,
      affinity: artist.affinity,
      popularity: artist.popularity,
      rank: index + 1,
      ambientTagged: ambient,
      genreTags: Object.freeze(
        artist.genreTags.map((t) => Object.freeze({ ...t, markers: Object.freeze(matchAmbientMarkers(t)) }))
      ),
    });
  });
}

/** Ambient-first album ranking: marker count, popularity, name, id. */
export function rankAlbums(rows, limit) {
  const albums = rows
    .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string')
    .map((r) => {
      const genreTags = collectGenreTags([r]);
      const matched = genreTags.filter((t) => matchAmbientMarkers(t).length > 0);
      return {
        id: r.id,
        name: r.name,
        subtype: nonEmptyString(r.subtype) ?? null,
        affinity: finiteNumber(r.affinity),
        popularity: finiteNumber(r.popularity),
        via: nonEmptyString(r.via),
        ambient: matched.length > 0,
        ambientMarkers: Object.freeze([
          ...new Set(matched.flatMap((t) => matchAmbientMarkers(t))),
        ]),
      };
    })
    .sort(
      (a, b) =>
        Number(b.ambient) - Number(a.ambient) ||
        b.ambientMarkers.length - a.ambientMarkers.length ||
        (b.popularity ?? -1) - (a.popularity ?? -1) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    );

  return albums.slice(0, limit).map((album, index) =>
    Object.freeze({ ...album, rank: index + 1 })
  );
}

const describeError = (err) =>
  Object.freeze({
    code:
      typeof err?.code === 'string' && err.code.length > 0
        ? err.code
        : typeof err?.name === 'string' && err.name.length > 0
          ? err.name
          : 'unknown_error',
    message: String(err?.message ?? err).slice(0, 300),
  });

const defaultAffinity = (ids, urn, opts) => getCrossDomainAffinities(ids, urn, opts);
const defaultSearch = (query, types, opts) => searchEntities(query, types, opts);
const defaultTags = (entityId, type, opts) => findTags(entityId, type, opts);

/**
 * Extracts the sound profile of an anchor.
 *
 * @param {{id: string, name?: string, domain?: string, category?: string}} anchor
 *        the RESOLVED seed (task 47 shape); `name` enables anchor-name
 *        album queries.
 * @param {object} [options] limits (artistLimit/albumLimit/genreLimit/
 *        artistTake/genreTake/albumTake/maxAlbumQueries), `strict`,
 *        and injectable clients affinityFn/searchFn/tagsFn.
 * @returns {Readonly<object>} frozen record
 *          {anchor, artists, genres, albums, coverage, failures}.
 * @throws {SoundExtractionError} no_anchor | all_legs_failed |
 *         partial_failure (strict).
 */
export async function extractSoundProfile(anchor, options = {}) {
  const {
    artistLimit = SOUND_DEFAULTS.artistLimit,
    albumLimit = SOUND_DEFAULTS.albumLimit,
    genreLimit = SOUND_DEFAULTS.genreLimit,
    artistTake = SOUND_DEFAULTS.artistTake,
    genreTake = SOUND_DEFAULTS.genreTake,
    albumTake = SOUND_DEFAULTS.albumTake,
    maxAlbumQueries = SOUND_DEFAULTS.maxAlbumQueries,
    strict = false,
    affinityFn = defaultAffinity,
    searchFn = defaultSearch,
    tagsFn = defaultTags,
  } = options;

  if (
    !anchor ||
    typeof anchor !== 'object' ||
    typeof anchor.id !== 'string' ||
    anchor.id.length === 0
  ) {
    throw new SoundExtractionError(
      'extractSoundProfile: anchor must carry a non-empty string id ' +
        '(resolve the seed first)',
      { code: SOUND_CODES.NO_ANCHOR, details: { anchor } }
    );
  }

  const anchorName = nonEmptyString(anchor.name)?.trim() ?? null;
  const failures = [];

  // Phase A: artists + anchor-scoped genre tags, in parallel.
  const [artistsOutcome, genresOutcome] = await Promise.allSettled([
    (async () => {
      const page = await affinityFn([anchor.id], ARTIST_URN, { take: artistTake });
      return rankArtists(pageRows(page), artistLimit);
    })(),
    (async () => {
      const page = await tagsFn(anchor.id, 'urn:tag:genre:music', { take: genreTake });
      return pageRows(page).filter(isMusicGenreTag);
    })(),
  ]);

  let artists = [];
  if (artistsOutcome.status === 'fulfilled') {
    artists = artistsOutcome.value;
  } else {
    failures.push(Object.freeze({ leg: 'artists', ...describeError(artistsOutcome.reason) }));
  }

  let anchorGenres = [];
  if (genresOutcome.status === 'fulfilled') {
    anchorGenres = genresOutcome.value;
  } else {
    failures.push(Object.freeze({ leg: 'genres', ...describeError(genresOutcome.reason) }));
  }

  // Phase B: album queries informed by the anchor + top artists.
  const queries = [];
  const pushQuery = (q) => {
    const trimmed = nonEmptyString(q)?.trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };
  pushQuery(anchorName);
  for (const artist of artists.slice(0, maxAlbumQueries)) pushQuery(artist.name);
  const albumQueries = queries.slice(0, maxAlbumQueries);

  let albums = [];
  let albumsFailed = false;
  if (albumQueries.length > 0) {
    const albumOutcomes = await Promise.allSettled(
      albumQueries.map((query) => searchFn(query, [ALBUM_URN], { take: albumTake }))
    );
    const collected = [];
    const seen = new Set();
    albumOutcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        albumsFailed = true;
        failures.push(
          Object.freeze({
            leg: 'albums',
            query: albumQueries[index],
            ...describeError(outcome.reason),
          })
        );
        return;
      }
      for (const row of pageRows(outcome.value)) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || seen.has(row.id)) {
          continue;
        }
        seen.add(row.id);
        collected.push({ ...row, via: albumQueries[index] });
      }
    });
    albums = rankAlbums(collected, albumLimit);
  }

  // All THREE legs must have failed (one leg can produce several
  // failure records — e.g. several album queries).
  const failedLegs = new Set(failures.map((f) => f.leg));
  if (failedLegs.size === SOUND_LEGS.length) {
    throw new SoundExtractionError(
      'every sound-extraction leg failed — upstream outage',
      { code: SOUND_CODES.ALL_LEGS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new SoundExtractionError(
      `strict mode: ${failures.length} leg(s) failed — ${failures
        .map((f) => f.leg)
        .join(', ')}`,
      { code: SOUND_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  // Genre markers: anchor-scoped tags (source: anchor_tags) merged with
  // artist-carried tags (source: artist, carriers counted).
  const artistCount = artists.length;
  const genreById = new Map();
  const addGenre = (tag, source) => {
    const key = typeof tag.id === 'string' && tag.id.length > 0 ? tag.id : tag.name;
    if (!key) return;
    const entry =
      genreById.get(key) ??
      {
        id: tag.id ?? null,
        name: tag.name ?? null,
        type: tag.type ?? null,
        sources: new Set(),
        carriers: 0,
      };
    entry.sources.add(source);
    genreById.set(key, entry);
    return entry;
  };

  for (const tag of anchorGenres) addGenre(tag, 'anchor_tags');
  for (const artist of artists) {
    for (const tag of artist.genreTags) {
      const entry = addGenre(tag, 'artist');
      if (entry) entry.carriers += 1;
    }
  }

  const genres = [...genreById.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      sources: Object.freeze([...entry.sources].sort()),
      carriers: entry.carriers,
      weight: artistCount > 0 ? entry.carriers / artistCount : 0,
      ambient: matchAmbientMarkers(entry).length > 0,
    }))
    .sort(
      (a, b) =>
        b.carriers - a.carriers ||
        Number(b.ambient) - Number(a.ambient) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
        String(a.id ?? '').localeCompare(String(b.id ?? ''))
    )
    .slice(0, genreLimit)
    .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }));

  return deepFreeze({
    anchor: { id: anchor.id, name: anchorName, domain: anchor.domain ?? anchor.category ?? null },
    artists: Object.freeze(artists),
    genres: Object.freeze(genres),
    albums: Object.freeze(albums),
    coverage: {
      artists: artists.length > 0,
      genres: genres.length > 0,
      albums: albums.length > 0,
      albumQueries: albumQueries.length,
      albumsFailed,
    },
    failures: Object.freeze(failures),
  });
}

const soundExtractor = {
  extractSoundProfile,
  isMusicGenreTag,
  matchAmbientMarkers,
  collectGenreTags,
  rankAlbums,
  SoundExtractionError,
  SOUND_CODES,
  SOUND_DEFAULTS,
  SOUND_LEGS,
  AMBIENT_MARKERS,
};

export default soundExtractor;

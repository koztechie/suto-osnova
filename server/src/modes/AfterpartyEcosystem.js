/**
 * AfterpartyEcosystem (task 89) — the AFTERPARTY ECOSYSTEM block of
 * the activation brief: a deterministic selection of AUTHENTIC bars
 * and nightlife venues derived from the dossier's own evidence (the
 * gastronomy layer's venue entities + the dining-domain ranked picks;
 * venue-type/drink/tradition tags are echoed as SCENE HINTS, never
 * used to classify an individual venue). Names never invented; kinds
 * and authenticity come from exported, pinned vocabularies.
 *
 * HOW A VENUE EARNS ITS PLACE:
 *   1. SOURCE — a real venue entity from the gastronomy layer
 *      (`layer_venue`, carries venueMarkers) or a confirmed
 *      dining-domain pick (`ranked_pick`). Layer venues list first:
 *      an actual Qloo place outranks a taste-graph neighbor.
 *   2. KIND — the exported KIND_REGISTRY matches venue markers and
 *      the venue name (word boundaries, priority order: speakeasy ->
 *      lounge -> club -> late_food -> bar) into one of
 *      bar | speakeasy | club | lounge | late_food; an UNCLASSIFIED
 *      venue never masquerades as a bar — it is counted in stats and
 *      honestly left out of the list.
 *   3. AUTHENTICITY — the exported AUTHENTICITY_MARKERS (dive,
 *      speakeasy, local, neighborhood, family-run, hole-in-the-wall,
 *      byob, independent, artist-run, community, DIY) decide the
 *      tier: `marker_backed` when at least one marker fires, else
 *      `unverified` — asserted, never scored from thin air.
 *
 * The block also echoes the DRINK DIRECTION (gastronomy drink tags),
 * the late-night traditions and the task-84 venue locality.
 *
 * Surfaces: buildAfterpartyEcosystem(pieces, options) -> frozen
 * block (works on the runExperiential bundle pieces); a standalone
 * renderAfterpartyEcosystem(block) for the brief. Pure module: no
 * I/O, no clocks, no RNG (pinned by
 * server/test/afterpartyEcosystem.test.js).
 */

import { connectionScoreOf } from '../engine/ScoreNormalizer.js';

/** Block version. */
export const AFTERPARTY_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const AFTERPARTY_DEFAULTS = Object.freeze({
  limit: 6,
});

/** The nightlife kind vocabulary (priority-ordered tuning contract). */
export const KIND_REGISTRY = Object.freeze([
  Object.freeze({ kind: 'speakeasy', words: Object.freeze(['speakeasy', 'cocktail den']) }),
  Object.freeze({ kind: 'lounge', words: Object.freeze(['lounge', 'listening bar', 'jazz bar', 'rooftop']) }),
  Object.freeze({ kind: 'club', words: Object.freeze(['club', 'nightclub', 'disco', 'dancefloor', 'dance floor', 'warehouse', 'rave']) }),
  Object.freeze({ kind: 'late_food', words: Object.freeze(['late-night', 'late night', 'diner', 'noodle bar', 'food stall']) }),
  Object.freeze({ kind: 'bar', words: Object.freeze(['bar', 'pub', 'beer hall', 'gastropub', 'dive', 'izakaya', 'kneipe', 'tavern', 'saloon', 'cantina']) }),
]);

/** The authenticity vocabulary (exported tuning contract). */
export const AUTHENTICITY_MARKERS = Object.freeze([
  'dive', 'speakeasy', 'local', 'neighborhood', 'neighbourhood',
  'family-run', 'family run', 'hole-in-the-wall', 'byob',
  'independent', 'artist-run', 'community', 'diy',
]);

const normalizeToken = (value) =>
  value.normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

const KIND_WORDS = Object.freeze(
  KIND_REGISTRY.map((entry) => Object.freeze({
    kind: entry.kind,
    regexes: Object.freeze(entry.words.map(
      (word) => new RegExp(`\\b${normalizeToken(word).replace(/ /g, '[ -]')}\\b`)
    )),
  }))
);

const AUTHENTICITY_RES = Object.freeze(
  AUTHENTICITY_MARKERS.map((marker) => ({
    marker,
    re: new RegExp(`\\b${normalizeToken(marker).replace(/ /g, '[ -]')}\\b`),
  }))
);

/** Classify one venue: kind or null (honest unclassified). */
export const classifyVenueKind = (strings) => {
  const haystack = strings.filter((s) => typeof s === 'string')
    .map(normalizeToken).join(' | ');
  if (haystack.length === 0) return null;
  for (const entry of KIND_WORDS) {
    if (entry.regexes.some((re) => re.test(haystack))) return entry.kind;
  }
  return null;
};

/** The authenticity verdict (marker names that fired). */
export const authenticityOf = (strings) => {
  const haystack = strings.filter((s) => typeof s === 'string')
    .map(normalizeToken).join(' | ');
  const fired = AUTHENTICITY_RES
    .filter((entry) => entry.re.test(haystack))
    .map((entry) => entry.marker);
  return Object.freeze(fired);
};

const venueItem = (entry, source) => {
  const markers = Array.isArray(entry?.venueMarkers) ? entry.venueMarkers : [];
  const kind = classifyVenueKind([entry?.name ?? '', ...markers]);
  const authenticity = authenticityOf([entry?.name ?? '', ...markers]);
  const score = connectionScoreOf(entry);
  return Object.freeze({
    name: entry.name,
    kind,
    tier: authenticity.length > 0 ? 'marker_backed' : 'unverified',
    authenticityMarkers: authenticity,
    venueMarkers: Object.freeze(markers.map((m) => String(m))),
    source,
    affinityPercent: typeof score === 'number' ? Math.round(score * 100) : null,
    note: kind === null
      ? 'venue candidate — nightlife kind unproven'
      : `${kind} pick, ${authenticity.length > 0 ? 'marker-backed authenticity' : 'authenticity unverified'}`,
  });
};

/**
 * Build the afterparty ecosystem block.
 *
 * @param {object} pieces { entity, ranked, layers, scene } — the
 *        runExperiential() bundle pieces.
 * @param {object} [options] { limit } (default 6, clamped 1..50).
 * @returns {Readonly<object>} the frozen block.
 */
export function buildAfterpartyEcosystem(pieces, options = {}) {
  if (!pieces || typeof pieces !== 'object' || !pieces.entity
    || typeof pieces.entity.name !== 'string') {
    throw new TypeError('buildAfterpartyEcosystem: pieces must carry a named entity');
  }
  const limit = options.limit ?? AFTERPARTY_DEFAULTS.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('buildAfterpartyEcosystem: limit must be an integer in 1..50');
  }

  const ranked = Array.isArray(pieces.ranked) ? pieces.ranked : [];
  const gastronomy = pieces.layers?.gastronomy ?? null;
  // Scene-level venue-type hints (NOT per-venue evidence — echoed for
  // the brief, never used to classify an individual venue).
  const venueTypeHints = Object.freeze(
    (Array.isArray(gastronomy?.venueTypes) ? gastronomy.venueTypes : [])
      .map((tag) => tag?.name)
      .filter((name) => typeof name === 'string')
  );

  // 1. Layer venues first (real Qloo places), then ranked dining
  //    picks; name-deduplicated, kind-classified, honestly counted.
  const venues = [];
  const seen = new Set();
  let unclassified = 0;
  const push = (entry, source) => {
    if (venues.length >= limit) return;
    if (!entry || typeof entry.name !== 'string' || seen.has(entry.name)) return;
    seen.add(entry.name);
    const item = venueItem(entry, source);
    if (item.kind === null) {
      unclassified += 1;
      return; // never masquerade an unproven venue as a bar
    }
    venues.push(item);
  };
  for (const venue of Array.isArray(gastronomy?.venues) ? gastronomy.venues : []) {
    push(venue, 'layer_venue');
  }
  for (const entry of ranked.filter((row) => row?.domain === 'dining')) {
    push(entry, 'ranked_pick');
  }

  const drinks = Object.freeze(
    (Array.isArray(gastronomy?.drinks) ? gastronomy.drinks : [])
      .map((tag) => tag?.name)
      .filter((name) => typeof name === 'string')
  );
  const traditions = Object.freeze(
    (Array.isArray(gastronomy?.traditions) ? gastronomy.traditions : [])
      .map((tag) => tag?.name)
      .filter((name) => typeof name === 'string')
  );

  return Object.freeze({
    version: AFTERPARTY_VERSION,
    host: Object.freeze({
      name: pieces.entity.name,
      domain: pieces.entity.category ?? null,
    }),
    locality: pieces.scene?.location ?? null,
    venues: Object.freeze(venues),
    drinkDirection: drinks,
    traditions,
    venueTypeHints,
    summary: venues.length > 0
      ? `${venues.length} nightlife pick(s)` +
        `${pieces.scene?.location ? ` around ${pieces.scene.location}` : ''}.`
      : 'No proven nightlife venue in the dossier evidence — the afterparty stays theoretical.',
    stats: Object.freeze({
      considered: (Array.isArray(gastronomy?.venues) ? gastronomy.venues.length : 0)
        + ranked.filter((row) => row?.domain === 'dining').length,
      listed: venues.length,
      unclassified,
      markerBacked: venues.filter((v) => v.tier === 'marker_backed').length,
    }),
  });
}

/**
 * Render the printable afterparty block (deterministic, zero emojis).
 */
export function renderAfterpartyEcosystem(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.venues)) {
    throw new TypeError('renderAfterpartyEcosystem: expected a buildAfterpartyEcosystem() block');
  }
  const lines = [];
  lines.push(`AFTERPARTY ECOSYSTEM — ${block.host.name}${block.host.domain ? ` (${block.host.domain})` : ''}`);
  lines.push(block.summary);
  for (const venue of block.venues) {
    lines.push(
      `   - [${venue.kind}] ${venue.name}` +
        ` (${venue.tier}${venue.affinityPercent !== null ? `, ${venue.affinityPercent}% audience affinity` : ''})`
    );
  }
  if (block.drinkDirection.length > 0) {
    lines.push(`DRINK DIRECTION: ${block.drinkDirection.join(', ')}`);
  }
  if (block.traditions.length > 0) {
    lines.push(`LATE-NIGHT TRADITIONS: ${block.traditions.join(', ')}`);
  }
  return lines.join('\n');
}

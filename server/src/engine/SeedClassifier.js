/**
 * SeedClassifier (task 46) — recognition of the INPUT DATA FORMAT. The
 * user's cultural anchor arrives in one of three shapes:
 *
 *   direct_title         a work title: "The Matrix", "Blade Runner
 *                        (1982)", quoted «Матриця», "Fire Walk with Me:
 *                        The Lost Footage";
 *   person               an author/director/artist name: "Stanley
 *                        Kubrick", "Ludwig van Beethoven", "John Paul
 *                        II", "Kubrick";
 *   aesthetic_description a complex combined aesthetic prompt: "films
 *                        like Blade Runner with slow pacing", "give me
 *                        cozy Studio Ghibli vibes", "coffee shops,
 *                        ambient jazz, rainy afternoons".
 *
 * The classifier is PURE and LEXICAL: no I/O, no clocks, no external
 * knowledge base (determinism is pinned by
 * server/test/seedClassifier.test.js). It scores each format by
 * transparent, individually named signals and reports:
 *
 *   - format + confidence (high/medium/low from score and margin);
 *   - scores for ALL three formats (debuggable, never a black box);
 *   - the list of fired signal names;
 *   - alternatives — the remaining formats ordered by score;
 *   - components — per-format extractions (title+year, name+family,
 *     fragments+quoted segments) that downstream Qloo queries consume.
 *
 * HONEST LIMIT (documented, not hidden): two capitalized words are
 * structurally identical for "Blade Runner" and "Brad Pitt". Lexical
 * heuristics cannot separate them; the module reports the tie as LOW
 * confidence with the person alternative instead of faking certainty.
 * Strong signals (quotes, years, honorifics, particles, connective
 * phrases, category words, request imperatives, fragment splits) break
 * such ties deterministically.
 *
 * Ingress: a plain string (validated through resolveSeed — its typed
 * errors propagate) or an already-resolved seed descriptor.
 */

import { resolveSeed, normalizeSeedText, countCodePoints } from './SeedResolver.js';

/** The three recognized input formats. */
export const SEED_FORMATS = Object.freeze({
  DIRECT_TITLE: 'direct_title',
  PERSON: 'person',
  AESTHETIC_DESCRIPTION: 'aesthetic_description',
});

/** Confidence ladder derived from the winning score and its margin. */
export const SEED_CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

/**
 * Tie-breaking precedence, highest priority first. On an exact score
 * tie the earlier format wins (documented, tested — plain two-word
 * anchors resolve as direct_title with person reported as an
 * alternative).
 */
export const FORMAT_PRECEDENCE = Object.freeze([
  SEED_FORMATS.DIRECT_TITLE,
  SEED_FORMATS.PERSON,
  SEED_FORMATS.AESTHETIC_DESCRIPTION,
]);

// --- signal weights (exported: the whole scoring model is inspectable) ----

export const SIGNAL_WEIGHTS = Object.freeze({
  // direct_title
  quoted_full: 100,
  year_suffix: 40,
  colon_subtitle: 15,
  title_case_full: 30,
  title_case_single: 25,
  contained_title_case_run: 10,
  quoted_inside: 25,
  // person
  honorific_suffix: 40,
  particle_inside: 30,
  full_name_pattern: 30,
  leading_the: 15,
  single_capitalized: 25,
  // aesthetic_description
  request_phrase: 40,
  connective: 25,
  category_word: 20,
  adjective: 10,
  fragment_extra: 15,
});

/** Caps that keep ingredient lists from dominating the outcome. */
const ADJECTIVE_SCORE_CAP = 20;
const FRAGMENT_SCORE_CAP = 30;

/** Confidence thresholds: [min winning score, min margin over runner-up]. */
const CONFIDENCE_HIGH = Object.freeze({ score: 60, margin: 40 });
const CONFIDENCE_MEDIUM = Object.freeze({ score: 30, margin: 20 });

// --- lexical tables ---------------------------------------------------------

const QUOTED_FULL = /^["\u201C\u00AB]([^"\u201D\u00BB]+)["\u201D\u00BB]$/;
const QUOTED_SEGMENT = /["\u201C\u00AB]([^"\u201D\u00BB]+)["\u201D\u00BB]/g;
const YEAR_SUFFIX = /\s*\((\d{4})\)\s*$/;
const COLON_SUBTITLE = /: /;

/** Tokens allowed in a title-cased run beyond name-like words. */
const TITLE_ALLOWLIST = new Set([
  'of', 'and', 'the', 'a', 'an', 'in', 'on', 'to', 'for', 'at', 'by',
  'with', 'vs', 'van', 'von', 'de', 'del', 'da', 'dos', 'le', 'la',
]);

/** Name-like token: starts uppercase, letters/apostrophes/hyphens/dots. */
const NAME_TOKEN = /^[\p{Lu}][\p{L}'’.\-]*$/u;
const PARTICLES = new Set(['van', 'von', 'de', 'del', 'da', 'dos', 'le', 'la']);
const HONORIFIC_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii']);
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sir', 'dame', 'lord', 'lady']);

/** Multi-word request imperatives — very strong description markers. */
const REQUEST_PHRASES = Object.freeze([
  'give me', 'show me', 'find me', 'i want', "i'm looking for",
  'im looking for', 'looking for', 'can you', 'could you', 'tell me',
  'make me',
]);

/** Single tokens/phrases that frame an anchor as a description. */
const CONNECTIVES = Object.freeze([
  'like', 'similar to', 'reminds me of', 'reminding me of',
  'in the style of', 'kind of', 'sort of', 'somewhere between',
  'a mix of', 'mix of', 'combination of', 'vibes', 'vibe',
  'aesthetic', 'aesthetics', 'feel', 'feels', 'feeling', 'mood',
  'atmosphere', 'something', 'anything',
]);

/** Category nouns — a bare work/creator name never contains these. */
const CATEGORY_WORDS = new Set([
  'film', 'films', 'movie', 'movies', 'show', 'shows', 'series', 'tv',
  'music', 'song', 'songs', 'album', 'albums', 'band', 'bands',
  'artist', 'artists', 'author', 'authors', 'writer', 'writers',
  'director', 'directors', 'novel', 'novels', 'book', 'books',
  'restaurant', 'restaurants', 'cuisine', 'food', 'dish', 'dishes',
  'chef', 'cafe', 'bar', 'bars', 'fashion', 'brand', 'brands',
  'designer', 'designers', 'singer', 'singers', 'game', 'games',
]);

/** Descriptive adjectives — each distinct hit adds SIGNAL_WEIGHTS.adjective. */
const ADJECTIVES = new Set([
  'dark', 'cozy', 'moody', 'uplifting', 'gritty', 'dreamy',
  'melancholic', 'nostalgic', 'futuristic', 'vintage', 'minimalist',
  'maximalist', 'epic', 'intense', 'chill', 'relaxing', 'aggressive',
  'playful', 'elegant', 'raw', 'polished', 'whimsical', 'quirky',
  'dramatic', 'romantic', 'sinister', 'warm', 'cold', 'bright', 'sad',
  'funny', 'serious', 'experimental', 'classic', 'modern', 'retro',
  'underground', 'mainstream', 'indie', 'soulful', 'catchy', 'ambient',
  'heavy', 'gentle', 'spicy', 'comforting', 'hearty', 'luxurious',
  'casual', 'avant-garde', 'slow', 'fast',
]);

// --- matching helpers -------------------------------------------------------

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasPhrase(text, phrase) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'u');
  return re.test(text);
}

function tokenize(normalized) {
  return normalized.split(/\s+/).filter((t) => t.length > 0);
}

function isNameToken(token) {
  return NAME_TOKEN.test(token);
}

function stripYear(normalized) {
  const match = normalized.match(YEAR_SUFFIX);
  return {
    year: match ? Number(match[1]) : null,
    withoutYear: match ? normalized.slice(0, match.index).trim() : normalized,
  };
}

function extractQuotedSegments(normalized) {
  const segments = [];
  for (const match of normalized.matchAll(QUOTED_SEGMENT)) {
    segments.push(match[1].trim());
  }
  return segments;
}

function splitFragments(normalized) {
  return normalized
    .split(/[,;/|&]+/)
    .map((f) => f.trim())
    .filter((f) => countCodePoints(f) >= 2);
}

/**
 * Extracts the DISTINCT taste words of an anchor (task 48): the
 * descriptive adjectives that carry its mood ("moody", "cozy" …). Used
 * by the candidate ranker as the query side of the tag-overlap signal —
 * the words a user paints with, matched against an entity's Qloo tag
 * names. Pure, deterministic, case/punctuation-insensitive.
 */
export function extractTasteWords(text) {
  const normalized = typeof text === 'string' ? normalizeSeedText(text) : '';
  const words = normalized
    .toLowerCase()
    .split(/[\s,.;:!?/\\|]+/)
    .filter(Boolean);
  const stripped = words.map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''));
  return Object.freeze([...new Set(stripped.filter((w) => ADJECTIVES.has(w)))]);
}

// --- scoring -----------------------------------------------------------------

function scoreDirectTitle(normalized, tokens, stripped) {
  const signals = [];
  let score = 0;
  const add = (name) => {
    signals.push(name);
    score += SIGNAL_WEIGHTS[name];
  };

  if (QUOTED_FULL.test(normalized)) add('quoted_full');
  if (stripped.year !== null) add('year_suffix');
  if (COLON_SUBTITLE.test(normalized)) add('colon_subtitle');

  const allTitleCase =
    tokens.length > 0 &&
    tokens.every((t) => isNameToken(t) || TITLE_ALLOWLIST.has(t.toLowerCase()));
  if (allTitleCase) {
    if (tokens.length === 1) add('title_case_single');
    else add('title_case_full');
  } else if (tokens.length >= 2) {
    // A contained run of >=2 name tokens ("films like Blade Runner ...").
    for (let i = 0; i < tokens.length - 1; i += 1) {
      if (isNameToken(tokens[i]) && isNameToken(tokens[i + 1])) {
        add('contained_title_case_run');
        break;
      }
    }
  }
  if (extractQuotedSegments(normalized).length > 0 && !QUOTED_FULL.test(normalized)) {
    add('quoted_inside');
  }
  return { score, signals };
}

function scorePerson(normalized, tokens) {
  const signals = [];
  let score = 0;
  const add = (name) => {
    signals.push(name);
    score += SIGNAL_WEIGHTS[name];
  };

  const lower = tokens.map((t) => t.toLowerCase().replace(/[.,]$/, ''));

  // Honorific prefixes and suffixes (jr/sr, roman numerals).
  if (lower.some((t) => HONORIFIC_SUFFIXES.has(t))) add('honorific_suffix');
  if (lower.some((t) => HONORIFICS.has(t)) && !signals.includes('honorific_suffix')) {
    add('honorific_suffix');
  }

  const nameish = tokens.every(
    (t, i) => isNameToken(t) || (i > 0 && PARTICLES.has(lower[i]))
  );
  // A leading article ("The Matrix") marks a WORK, not a person name —
  // excluded from the full-name pattern (leading_the covers it weakly).
  if (
    tokens.length >= 2 &&
    tokens.length <= 4 &&
    nameish &&
    lower[0] !== 'the'
  ) {
    add('full_name_pattern');
  }
  if (lower[0] === 'the' && tokens.length >= 2 && tokens.slice(1).every(isNameToken)) {
    add('leading_the');
  }
  if (tokens.length === 1 && isNameToken(tokens[0])) add('single_capitalized');
  if (lower.some((t) => PARTICLES.has(t)) && tokens.length >= 3) add('particle_inside');

  return { score, signals };
}

function scoreDescription(normalized) {
  const signals = [];
  let score = 0;
  const add = (name) => {
    signals.push(name);
    score += SIGNAL_WEIGHTS[name];
  };
  const text = normalized.toLowerCase();

  if (REQUEST_PHRASES.some((p) => hasPhrase(text, p))) add('request_phrase');
  if (CONNECTIVES.some((p) => hasPhrase(text, p))) add('connective');

  const words = text.split(/\s+/);
  if (words.some((w) => CATEGORY_WORDS.has(w.replace(/[^\p{L}\p{N}-]/gu, '')))) {
    add('category_word');
  }

  const distinctAdjectives = new Set(words.filter((w) => ADJECTIVES.has(w)));
  if (distinctAdjectives.size > 0) {
    score += Math.min(
      distinctAdjectives.size * SIGNAL_WEIGHTS.adjective,
      ADJECTIVE_SCORE_CAP
    );
    signals.push('adjective');
  }

  const fragments = splitFragments(normalized);
  if (fragments.length >= 2) {
    score += Math.min(
      (fragments.length - 1) * SIGNAL_WEIGHTS.fragment_extra,
      FRAGMENT_SCORE_CAP
    );
    signals.push('fragment_extra');
  }

  return { score, signals, fragments };
}

// --- public API ---------------------------------------------------------------

/**
 * Classifies the format of an input cultural anchor.
 *
 * @param {string|{normalized: string}} input raw string (validated via
 *        resolveSeed — its InvalidSeedError propagates) or a resolved
 *        seed descriptor.
 * @returns {Readonly<{format: string, confidence: string,
 *          scores: Readonly<Record<string, number>>, signals: string[],
 *          alternatives: string[], components: object}>}
 * @throws {TypeError} when a descriptor-like input has no usable
 *         `normalized` string (pass raw strings or resolveSeed output).
 */
export function classifySeedFormat(input) {
  const seed = typeof input === 'string' ? resolveSeed(input) : input;
  if (!seed || typeof seed.normalized !== 'string') {
    throw new TypeError(
      'classifySeedFormat: input must be a string or a resolved seed ' +
        'descriptor with a string `normalized` field'
    );
  }

  const normalized = normalizeSeedText(seed.normalized);
  const tokens = tokenize(normalized);
  const stripped = stripYear(normalized);

  const title = scoreDirectTitle(normalized, tokens, stripped);
  const person = scorePerson(normalized, tokens);
  const description = scoreDescription(normalized);

  const scores = Object.freeze({
    [SEED_FORMATS.DIRECT_TITLE]: title.score,
    [SEED_FORMATS.PERSON]: person.score,
    [SEED_FORMATS.AESTHETIC_DESCRIPTION]: description.score,
  });

  // Winner: max score, ties resolved by FORMAT_PRECEDENCE (stable sort).
  const ranked = FORMAT_PRECEDENCE.map((format) => format).sort(
    (a, b) => scores[b] - scores[a]
  );
  const format = ranked[0];
  const runnerUpScore = scores[ranked[1]];
  const margin = scores[format] - runnerUpScore;

  const confidence =
    scores[format] >= CONFIDENCE_HIGH.score && margin >= CONFIDENCE_HIGH.margin
      ? SEED_CONFIDENCE.HIGH
      : scores[format] >= CONFIDENCE_MEDIUM.score && margin >= CONFIDENCE_MEDIUM.margin
        ? SEED_CONFIDENCE.MEDIUM
        : SEED_CONFIDENCE.LOW;

  const fired = [
    ...new Set([...title.signals, ...person.signals, ...description.signals]),
  ];

  const components =
    format === SEED_FORMATS.DIRECT_TITLE
      ? Object.freeze({ title: stripped.withoutYear.replace(/^["\u201C\u00AB]|["\u201D\u00BB]$/g, '').trim(), year: stripped.year })
      : format === SEED_FORMATS.PERSON
        ? Object.freeze({ name: normalized, family: tokens[tokens.length - 1] })
        : Object.freeze({
            fragments: Object.freeze(description.fragments),
            quoted: Object.freeze(extractQuotedSegments(normalized)),
          });

  return Object.freeze({
    format,
    confidence,
    scores,
    signals: Object.freeze(fired),
    alternatives: Object.freeze(ranked.slice(1)),
    components,
  });
}

export default classifySeedFormat;

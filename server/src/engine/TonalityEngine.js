/**
 * TonalityEngine (task 66) — the coherence-check pipeline for the
 * obtained connections under the principle of a SINGLE AESTHETIC
 * TONALITY: do the dossier's cross-domain connections sound like one
 * aesthetic, or does the set contain a lone dissenter (outlier) or two
 * warring camps (axis contradiction)?
 *
 * FOUR DETERMINISTIC STAGES (each exported and unit-tested):
 *   1. classifyTone(connection) — maps the connection's aesthetic
 *      evidence (shared markers + the target's tag names/ids) onto
 *      FIVE OPPOSING POLES via an exported lexicon: dark <-> light,
 *      melancholic <-> uplifting, minimal <-> ornate, futuristic <->
 *      traditional, intense <-> calm. Per axis the value is
 *      (positive - negative) / (positive + negative) in [-1, 1];
 *      an axis without evidence is null, and a connection without ANY
 *      evidence is honestly `unclassified` — never forced onto a tone;
 *   2. coherenceCentroid(vectors) — the evidence-weighted mean per
 *      axis (more evidence pulls harder);
 *   3. deviation — mean |v - centroid| over the comparable axes,
 *      EXCLUDING axes flagged as contradictions (a bimodal axis has
 *      no meaningful centroid);
 *   4. verdict — `outlier` when a connection's deviation >=
 *      outlierThreshold (default 0.6); `contradiction` when an axis
 *      holds at least TWO strong voices on BOTH flanks (>= 2
 *      connections at <= -pole and >= 2 at >= +pole) — a LONE
 *      dissenter is an outlier, TWO CAMPS are a contradiction.
 *
 * Verdict: {coherent} = classified >= 1 && no outliers && no
 * contradictions. Everything unclassifiable is REPORTED in stats, not
 * silently counted as coherent (the shared honesty rule of tasks
 * 56-65). Pure engine module: no I/O, no clocks, no RNG.
 */

/** The five opposing tone poles with their word lexicons (tuning contract). */
export const TONE_POLES = Object.freeze([
  Object.freeze({
    id: 'dark_light',
    negative: Object.freeze({
      label: 'dark',
      words: Object.freeze(['dark', 'noir', 'brutalist', 'gothic', 'dystopian', 'cyberpunk', 'industrial', 'sinister', 'rain', 'night']),
    }),
    positive: Object.freeze({
      label: 'light',
      words: Object.freeze(['bright', 'pastel', 'airy', 'sunny', 'cheerful', 'luminous', 'daylight']),
    }),
  }),
  Object.freeze({
    id: 'melancholic_uplifting',
    negative: Object.freeze({
      label: 'melancholic',
      words: Object.freeze(['melancholic', 'mournful', 'somber', 'lonely', 'nostalgic', 'sad']),
    }),
    positive: Object.freeze({
      label: 'uplifting',
      words: Object.freeze(['uplifting', 'euphoric', 'joyful', 'celebratory', 'hopeful']),
    }),
  }),
  Object.freeze({
    id: 'minimal_ornate',
    negative: Object.freeze({
      label: 'minimal',
      words: Object.freeze(['minimal', 'minimalist', 'austere', 'sparse', 'bare']),
    }),
    positive: Object.freeze({
      label: 'ornate',
      words: Object.freeze(['ornate', 'baroque', 'maximalist', 'opulent', 'decorative', 'art-nouveau']),
    }),
  }),
  Object.freeze({
    id: 'futuristic_traditional',
    negative: Object.freeze({
      label: 'futuristic',
      words: Object.freeze(['futuristic', 'sci-fi', 'scifi', 'neon', 'chrome']),
    }),
    positive: Object.freeze({
      label: 'traditional',
      words: Object.freeze(['traditional', 'vintage', 'rustic', 'classical', 'folk', 'heritage']),
    }),
  }),
  Object.freeze({
    id: 'intense_calm',
    negative: Object.freeze({
      label: 'intense',
      words: Object.freeze(['intense', 'aggressive', 'loud', 'chaotic', 'violent']),
    }),
    positive: Object.freeze({
      label: 'calm',
      words: Object.freeze(['calm', 'serene', 'ambient', 'gentle', 'meditative', 'soothing']),
    }),
  }),
]);

/** Thresholds (exported tuning contract). */
export const TONALITY_DEFAULTS = Object.freeze({
  outlierThreshold: 0.6,
  contradictionPole: 0.5,
  contradictionMinFlank: 2,
});

const normalizeHaystack = (value) =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

const round6 = (value) => Math.round(value * 1e6) / 1e6;

/** The aesthetic evidence strings of a connection (shared + target). */
function evidenceStrings(connection) {
  const strings = [];
  for (const marker of connection?.evidence?.sharedMarkers ?? []) {
    if (typeof marker === 'string') strings.push(normalizeHaystack(marker));
  }
  for (const tag of connection?.target?.tags ?? connection?.tags ?? []) {
    if (!tag || typeof tag !== 'object') continue;
    // ONE haystack per tag: name + id must not double-count a word.
    const haystack = `${tag.name ?? ''} ${tag.id ?? ''}`.trim();
    if (haystack.length > 0) strings.push(normalizeHaystack(haystack));
  }
  return strings.filter((s) => s.length > 0);
}

/**
 * Stage 1: tone classification of ONE connection.
 *
 * @returns {Readonly<{classified, axes, evidenceWords, evidenceCount}>}
 */
export function classifyTone(connection) {
  const haystacks = evidenceStrings(connection);
  const axes = {};
  const evidenceWords = new Set();
  let totalEvidence = 0;

  for (const pole of TONE_POLES) {
    let negative = 0;
    let positive = 0;
    for (const haystack of haystacks) {
      for (const word of pole.negative.words) {
        if (haystack.includes(word)) {
          negative += 1;
          evidenceWords.add(word);
        }
      }
      for (const word of pole.positive.words) {
        if (haystack.includes(word)) {
          positive += 1;
          evidenceWords.add(word);
        }
      }
    }
    totalEvidence += negative + positive;
    axes[pole.id] =
      negative + positive === 0 ? null : round6((positive - negative) / (positive + negative));
  }

  return Object.freeze({
    classified: totalEvidence > 0,
    axes: Object.freeze(axes),
    evidenceWords: Object.freeze([...evidenceWords]),
    evidenceCount: totalEvidence,
  });
}

/**
 * Stage 2: the evidence-weighted tonal centroid of classified vectors.
 *
 * @returns {Readonly<{axes, support}>} per-axis weighted means (null
 *          when nothing measured) and the number of contributing
 *          connections.
 */
export function coherenceCentroid(vectors) {
  const sums = {};
  const weights = {};
  for (const pole of TONE_POLES) {
    sums[pole.id] = 0;
    weights[pole.id] = 0;
  }

  for (const vector of vectors) {
    if (!vector?.classified) continue;
    for (const pole of TONE_POLES) {
      const value = vector.axes?.[pole.id];
      if (typeof value === 'number') {
        const weight = Math.max(1, vector.evidenceCount ?? 1);
        sums[pole.id] += weight * value;
        weights[pole.id] += weight;
      }
    }
  }

  const axes = {};
  let support = 0;
  for (const pole of TONE_POLES) {
    axes[pole.id] = weights[pole.id] > 0 ? round6(sums[pole.id] / weights[pole.id]) : null;
    if (weights[pole.id] > 0) support += 1;
  }
  return Object.freeze({ axes: Object.freeze(axes), support });
}

const validateOptions = (options) => {
  const { outlierThreshold, contradictionPole, contradictionMinFlank } = options;
  if (typeof outlierThreshold !== 'number' || !(outlierThreshold >= 0 && outlierThreshold <= 2)) {
    throw new TypeError('checkTonalCoherence: outlierThreshold must be a number in [0, 2]');
  }
  if (typeof contradictionPole !== 'number' || !(contradictionPole > 0 && contradictionPole <= 1)) {
    throw new TypeError('checkTonalCoherence: contradictionPole must be a number in (0, 1]');
  }
  if (!Number.isInteger(contradictionMinFlank) || contradictionMinFlank < 1) {
    throw new TypeError('checkTonalCoherence: contradictionMinFlank must be an integer >= 1');
  }
};

/**
 * Stages 3-4: the full coherence pipeline over a connection batch.
 *
 * @returns {Readonly<{coherent, centroid, connections, contradictions,
 *          stats}>} frozen: connections carry {name, tone, deviation,
 *          outlier}; contradictions list {axis, negative, positive}
 *          with the offending connection names; stats {total,
 *          classified, unclassified, outliers, contradictionAxes}.
 */
export function checkTonalCoherence(connections, options = {}) {
  const resolved = { ...TONALITY_DEFAULTS, ...options };
  validateOptions(resolved);

  const list = Array.isArray(connections)
    ? connections.filter((c) => c && typeof c === 'object')
    : [];

  const tones = list.map((connection) => classifyTone(connection));
  const centroid = coherenceCentroid(tones);

  // Stage 4a: axis contradictions — substantial strong voices on both
  // flanks turn the axis bimodal (and exempt it from deviation).
  const contradictions = [];
  const contradictionAxes = new Set();
  for (const pole of TONE_POLES) {
    const value = centroid.axes[pole.id];
    if (value === null) continue;
    const negativeFlank = [];
    const positiveFlank = [];
    list.forEach((connection, index) => {
      const axis = tones[index].axes[pole.id];
      if (typeof axis !== 'number') return;
      if (axis <= -resolved.contradictionPole) negativeFlank.push(nameOf(connection));
      if (axis >= resolved.contradictionPole) positiveFlank.push(nameOf(connection));
    });
    if (
      negativeFlank.length >= resolved.contradictionMinFlank &&
      positiveFlank.length >= resolved.contradictionMinFlank
    ) {
      contradictionAxes.add(pole.id);
      contradictions.push(
        Object.freeze({
          axis: pole.id,
          negative: Object.freeze(negativeFlank),
          positive: Object.freeze(positiveFlank),
        })
      );
    }
  }

  // Stage 3: deviation over the non-contradictory comparable axes.
  const entries = list.map((connection, index) => {
    const tone = tones[index];
    let sum = 0;
    let count = 0;
    for (const pole of TONE_POLES) {
      if (contradictionAxes.has(pole.id)) continue;
      const axis = tone.axes[pole.id];
      const center = centroid.axes[pole.id];
      if (typeof axis === 'number' && typeof center === 'number') {
        sum += Math.abs(axis - center);
        count += 1;
      }
    }
    const deviation = count > 0 ? round6(sum / count) : null;
    return Object.freeze({
      name: nameOf(connection),
      tone,
      deviation,
      outlier: deviation !== null && deviation >= resolved.outlierThreshold,
    });
  });

  const classified = tones.filter((t) => t.classified).length;
  const outliers = entries.filter((e) => e.outlier).length;

  return Object.freeze({
    coherent: classified > 0 && outliers === 0 && contradictions.length === 0,
    centroid,
    connections: Object.freeze(entries),
    contradictions: Object.freeze(contradictions),
    stats: Object.freeze({
      total: list.length,
      classified,
      unclassified: list.length - classified,
      outliers,
      contradictionAxes: contradictions.length,
    }),
  });
}

function nameOf(connection) {
  return (
    connection?.target?.name ??
    connection?.name ??
    connection?.evidence?.targetName ??
    'unnamed'
  );
}

const tonalityEngine = {
  classifyTone,
  coherenceCentroid,
  checkTonalCoherence,
  TONE_POLES,
  TONALITY_DEFAULTS,
};

export default tonalityEngine;

/**
 * ContrastExplainer (task 100) — TEXTUAL EXPLANATION GENERATOR for a
 * discovered cultural contrast, aimed at DIRECTORS (режисери) and
 * MARKETERS (маркетологи).
 *
 * THE ZERO-HALLUCINATION STANCE (PRD user story 3): every sentence
 * is a DETERMINISTIC template over the MEASURED evidence of a
 * calculateCulturalDistance() result (task 99). No psychology is
 * invented, no claim outruns its axis: the generator explains WHAT
 * was measured (the tag-vocabulary and taste-vector axes, the
 * renormalized distance, the band) and then offers a band-keyed
 * READING for each audience — craft/booking guidance keyed strictly
 * to the measured band, never a fabricated motive.
 *
 * TWO AUDIENCES, one evidence base:
 *   director — the dramatic reading (how the contrast plays on
 *              stage/screen: mirror -> friction -> two worlds ->
 *              opposition, as the measured distance grows);
 *   marketer — the activation reading (co-brand safe -> cross-sell
 *              -> segmented -> mutual-exclusion, as the measured
 *              distance grows).
 * Both tables are exported (pinned tuning contracts); `both`
 * returns both readings. When the distance is UNCOMPUTABLE (no
 * shared evidence) the generator returns an honest "no measurable
 * contrast" and FABRICATES NO READINGS.
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * explainContrast(result, options), explainEntities(a, b, options)
 * (the one-call generator over task 99), and
 * renderContrastExplanation(explanation) for the printable brief.
 * Pinned by server/test/contrastExplainer.test.js.
 */

import { calculateCulturalDistance } from './CulturalDistance.js';

/** Module version. */
export const EXPLAINER_VERSION = 1;

/** The supported audiences (exported vocabulary). */
export const EXPLAINER_AUDIENCES = Object.freeze(['director', 'marketer', 'both']);

/** The band-keyed DIRECTOR readings (exported tuning contract). */
export const DIRECTOR_READINGS = Object.freeze({
  kindred: Object.freeze({
    angle: 'mirror',
    guidance: 'Stage them as reflections of one cultural position — the tension comes from circumstance, not taste.',
  }),
  adjacent: Object.freeze({
    angle: 'friction',
    guidance: 'A shared world with a measurable seam — play the contrast as disagreement inside one culture.',
  }),
  divergent: Object.freeze({
    angle: 'two worlds',
    guidance: 'Distinct cultural orbits — the pairing reads as a crossing of worlds; give each its own milieu.',
  }),
  antipodal: Object.freeze({
    angle: 'opposition',
    guidance: 'Opposite ends of the measured taste span — the contrast is structural; let the environments carry it.',
  }),
});

/** The band-keyed MARKETER readings (exported tuning contract). */
export const MARKETER_READINGS = Object.freeze({
  kindred: Object.freeze({
    angle: 'co-brand safe',
    guidance: 'Overlapping audience taste — a joint activation or double-billing carries low resonance risk.',
  }),
  adjacent: Object.freeze({
    angle: 'cross-sell',
    guidance: 'Adjacent tastes — a shared core with reachable adjacency; a crossover campaign is defensible.',
  }),
  divergent: Object.freeze({
    angle: 'segmented',
    guidance: 'Divergent tastes — book them for different slots or zones; a single shared stage splits the room.',
  }),
  antipodal: Object.freeze({
    angle: 'mutual-exclusion',
    guidance: 'Opposed tastes — pairing them reads as inauthentic to both audiences; keep the activations separate.',
  }),
});

const roundPercent = (value) => Math.round(value * 100);

/** One plain-language statement per MEASURED axis. */
const axisStatement = (component) => {
  const percent = roundPercent(component.value);
  if (component.key === 'tags') {
    return `shared vocabulary: ${component.evidence} — ${percent}% apart`;
  }
  return `audience profile: ${component.evidence} — ${percent}% mean deviation`;
};

/** One honest statement per MISSING axis (never a fabricated number). */
const gapStatement = (gap) => (gap.reason === 'no_tags'
  ? 'no comparable tag vocabulary (one side has no tags) — the metadata axis is unmeasured'
  : 'no shared domain between their profiles — the taste-vector axis is unmeasured');

const validateResult = (result) => {
  if (!result || typeof result !== 'object'
    || !Array.isArray(result.components) || !Array.isArray(result.missing)) {
    throw new TypeError(
      'explainContrast: expected a calculateCulturalDistance() result'
    );
  }
};

/**
 * Generate the textual explanation of a measured contrast.
 *
 * @param {object} result a calculateCulturalDistance() result.
 * @param {object} [options] { audience: 'director'|'marketer'|
 *        'both' (default 'both') }.
 * @returns {Readonly<object>} the frozen explanation.
 */
export function explainContrast(result, options = {}) {
  validateResult(result);
  const audience = options.audience ?? 'both';
  if (!EXPLAINER_AUDIENCES.includes(audience)) {
    throw new TypeError(
      `explainContrast: audience must be one of ${EXPLAINER_AUDIENCES.join(' | ')}`
    );
  }

  const { a, b } = result.between ?? { a: 'entity A', b: 'entity B' };
  const band = result.band ?? null;
  const distancePercent = result.distancePercent ?? null;
  const evidence = Object.freeze(result.components.map(axisStatement));
  const gaps = Object.freeze(result.missing.map(gapStatement));

  const headline = band === null
    ? `no measurable contrast between ${a} and ${b}`
    : `${band} contrast (${distancePercent}% measured distance) between ${a} and ${b}`;

  // Readings are BAND-KEYED templates; an unmeasurable distance
  // yields NO readings (never a fabricated motive).
  const readings = {};
  if (band !== null) {
    if (audience === 'director' || audience === 'both') {
      readings.director = DIRECTOR_READINGS[band];
    }
    if (audience === 'marketer' || audience === 'both') {
      readings.marketer = MARKETER_READINGS[band];
    }
  }

  return Object.freeze({
    version: EXPLAINER_VERSION,
    audience,
    between: Object.freeze({ a, b }),
    band,
    distancePercent,
    headline,
    evidence,
    gaps,
    readings: Object.freeze(readings),
    basis: band === null
      ? 'no measurable axis to ground a reading'
      : `band ${band} at ${distancePercent}% distance, measured on ` +
        `${result.components.length} axis/axes`,
    summary: band === null
      ? `${headline} — ${gaps.length > 0 ? gaps.join('; ')
        : 'the metric returned no band'}. No reading is offered.`
      : `${headline}. ${evidence.join('; ')}.`,
  });
}

/**
 * The one-call generator: measure the distance (task 99), then
 * explain it.
 */
export function explainEntities(entityA, entityB, options = {}) {
  const result = calculateCulturalDistance(entityA, entityB,
    options.weights ? { weights: options.weights } : {});
  return explainContrast(result, { audience: options.audience ?? 'both' });
}

/**
 * Render the printable contrast brief (deterministic, zero emojis).
 */
export function renderContrastExplanation(explanation) {
  if (!explanation || typeof explanation !== 'object'
    || !Array.isArray(explanation.evidence)) {
    throw new TypeError(
      'renderContrastExplanation: expected an explainContrast() explanation'
    );
  }
  const lines = [];
  lines.push(`CULTURAL CONTRAST — ${explanation.between.a} vs ${explanation.between.b}`);
  lines.push(explanation.headline);
  if (explanation.evidence.length > 0) {
    lines.push('EVIDENCE:');
    for (const statement of explanation.evidence) {
      lines.push(`   - ${statement}`);
    }
  }
  if (explanation.gaps.length > 0) {
    lines.push(`UNMEASURED: ${explanation.gaps.join('; ')}`);
  }
  if (explanation.readings.director) {
    lines.push(
      `DIRECTOR [${explanation.readings.director.angle}]: ` +
        explanation.readings.director.guidance
    );
  }
  if (explanation.readings.marketer) {
    lines.push(
      `MARKETER [${explanation.readings.marketer.angle}]: ` +
        explanation.readings.marketer.guidance
    );
  }
  return lines.join('\n');
}

/**
 * DialogueContext (task 86) — the CHARACTER'S DIALOGUE CONTEXT: a
 * deterministic derivation of how a character TALKS from the taste
 * graph the dossier PROVED. Built strictly on CONFIRMED preferences —
 * the math-chain survivors in bundle.ranked plus the tonality
 * centroid and the scene context (task 84). Nothing unconfirmed
 * enters, so an in-character speaker can never hallucinate a favorite.
 *
 * THE FOUR PARTS:
 *   1. VOICE — the five tonality poles map through the exported
 *      VOICE_MAP table to a speech register and traits (design
 *      knowledge, pinned per side by tests): the character's register
 *      is the DOMINANT pole (max |axis value|, deterministic
 *      tie-break), traits union over every MEASURED axis — an
 *      unmeasured axis contributes nothing (honest silence).
 *   2. VOCABULARY — era tokens (the task-84 decade expansion), the
 *      scene location as a place cue, and TOPIC WORDS: the most
 *      frequent taste-tag words among the confirmed picks.
 *   3. REFERENCES — the confirmed favorites a character may cite,
 *      each with its domain, affinity percent and a deterministic
 *      cue template (templates, never prose inventions).
 *   4. RULES — the machine-checkable speaker contract: cite ONLY
 *      confirmed references, deflect when unsure. isConfirmedReference
 *      enforces it (case-insensitive exact match), so a dialogue
 *      pipeline can validate every in-character claim.
 *
 * Surfaces: buildDialogueContext(bundle, options) -> frozen context;
 * renderDialogueContext(context) -> the printable prompt appendix;
 * isConfirmedReference(context, name) -> boolean.
 * Pure module: no I/O, no clocks, no RNG (pinned by
 * server/test/dialogueContext.test.js).
 */

import { connectionScoreOf } from '../engine/ScoreNormalizer.js';
import { TONE_POLES } from '../engine/TonalityEngine.js';
import { contextTokens } from './SceneContext.js';

/** Template version of the dialogue context. */
export const DIALOGUE_CONTEXT_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const DIALOGUE_DEFAULTS = Object.freeze({
  maxReferences: 8,
  maxTopicWords: 10,
});

/**
 * VOICE_MAP: tone side -> speech register + traits. The exported
 * design-knowledge table (tuning contract, pinned per entry).
 */
export const VOICE_MAP = Object.freeze({
  dark: Object.freeze({
    register: 'dry, low-register',
    traits: Object.freeze(['understatement', 'morbid humour']),
  }),
  light: Object.freeze({
    register: 'warm, open',
    traits: Object.freeze(['ease', 'small talk']),
  }),
  melancholic: Object.freeze({
    register: 'reflective',
    traits: Object.freeze(['pauses', 'past tense']),
  }),
  uplifting: Object.freeze({
    register: 'forward-leaning',
    traits: Object.freeze(['momentum', 'jokes']),
  }),
  minimal: Object.freeze({
    register: 'clipped',
    traits: Object.freeze(['short sentences', 'no adjectives']),
  }),
  ornate: Object.freeze({
    register: 'flowing',
    traits: Object.freeze(['long clauses', 'named details']),
  }),
  futuristic: Object.freeze({
    register: 'present-tense',
    traits: Object.freeze(['neologisms', 'tech metaphors']),
  }),
  traditional: Object.freeze({
    register: 'rooted',
    traits: Object.freeze(['proverbs', 'family lore']),
  }),
  intense: Object.freeze({
    register: 'driving',
    traits: Object.freeze(['imperatives', 'interruptions']),
  }),
  calm: Object.freeze({
    register: 'measured',
    traits: Object.freeze(['even pace', 'questions']),
  }),
});

/** The speaker contract (exported, machine-checkable). */
export const DIALOGUE_RULES = Object.freeze({
  CITE_ONLY_CONFIRMED: 'cite_only_confirmed_references',
  DEFLECT_WHEN_UNSURE: 'deflect_when_unsure',
});

const roundPct = (value) => Math.round(value * 100);

const normalizeWord = (value) =>
  value.normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** The dominant pole (max |value|, deterministic tie-break by id). */
const dominantAxis = (axes) => {
  let best = null;
  for (const [axis, value] of Object.entries(axes)) {
    if (typeof value !== 'number') continue;
    if (best === null || Math.abs(value) > Math.abs(best.value)
      || (Math.abs(value) === Math.abs(best.value) && axis < best.axis)) {
      best = { axis, value };
    }
  }
  return best;
};

/**
 * Build the dialogue context from a mode bundle.
 *
 * @param {object} bundle the frozen runWorldbuilder() result.
 * @param {object} [options] { maxReferences, maxTopicWords }.
 * @returns {Readonly<object>} the frozen dialogue context.
 */
export function buildDialogueContext(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || !bundle.entity
    || typeof bundle.entity.name !== 'string') {
    throw new TypeError('buildDialogueContext: bundle must carry a named entity');
  }
  const maxReferences = options.maxReferences ?? DIALOGUE_DEFAULTS.maxReferences;
  const maxTopicWords = options.maxTopicWords ?? DIALOGUE_DEFAULTS.maxTopicWords;
  for (const [name, value] of [['maxReferences', maxReferences], ['maxTopicWords', maxTopicWords]]) {
    if (!Number.isInteger(value) || value < 1 || value > 50) {
      throw new TypeError(`buildDialogueContext: ${name} must be an integer in 1..50`);
    }
  }

  const entity = bundle.entity;
  const ranked = Array.isArray(bundle.ranked) ? bundle.ranked : [];

  // 1. VOICE from the tonality centroid (honest about unmeasured:
  //    only KNOWN poles with NUMERIC values count — an unknown axis
  //    id is not tonality and contributes nothing).
  const poleById = new Map(TONE_POLES.map((pole) => [pole.id, pole]));
  const axes = bundle.tonality?.centroid?.axes;
  const measured = Object.entries(axes ?? {})
    .filter(([axis, value]) => typeof value === 'number' && poleById.has(axis))
    .map(([axis, value]) => Object.freeze({
      axis,
      side: value >= 0 ? 'positive' : 'negative',
      value,
    }));
  const dominant = dominantAxis(
    Object.fromEntries(measured.map((entry) => [entry.axis, entry.value]))
  );
  const sideLabel = (entry) => {
    const pole = poleById.get(entry.axis);
    if (pole === undefined) return null;
    return entry.side === 'positive' ? pole.positive.label : pole.negative.label;
  };
  const traits = [];
  const registerSeen = new Set();
  let register = 'neutral';
  for (const entry of measured) {
    const label = sideLabel(entry);
    const mapped = label !== null ? VOICE_MAP[label] : undefined;
    if (mapped === undefined) continue;
    for (const trait of mapped.traits) {
      if (traits.length < 8 && !traits.includes(trait)) traits.push(trait);
    }
    registerSeen.add(mapped.register);
    if (dominant !== null && entry.axis === dominant.axis) register = mapped.register;
  }
  const voice = Object.freeze({
    register,
    traits: Object.freeze(traits),
    axes: Object.freeze(measured),
    dominant: dominant === null ? null
      : Object.freeze({ axis: dominant.axis, label: sideLabel(dominant), value: dominant.value }),
    coherent: bundle.tonality?.coherent ?? null,
    support: bundle.tonality?.centroid?.support ?? null,
  });

  // 2. VOCABULARY: era tokens, place cue, confirmed topic words.
  const scene = bundle.scene ?? null;
  const eraTokens = scene === null ? []
    : [...contextTokens({ ...scene, location: null })];
  const topicCounts = new Map();
  for (const entry of ranked) {
    for (const tag of Array.isArray(entry?.tags) ? entry.tags : []) {
      if (typeof tag?.name !== 'string' || tag.name.length === 0) continue;
      const word = normalizeWord(tag.name);
      if (word.length === 0) continue;
      topicCounts.set(word, (topicCounts.get(word) ?? 0) + 1);
    }
  }
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTopicWords)
    .map(([word]) => word);
  const vocabulary = Object.freeze({
    era: Object.freeze(eraTokens),
    place: scene?.location ?? null,
    topics: Object.freeze(topics),
  });

  // 3. REFERENCES: the confirmed favorites, evidence + cue template.
  //    The percent follows the task-60 priority chain (affinity ->
  //    correlation -> index -> weight), never a raw guess.
  const references = ranked.slice(0, maxReferences).map((entry) => {
    const score = connectionScoreOf(entry);
    return Object.freeze({
      name: entry.name,
      domain: entry?.domain ?? null,
      affinityPercent: typeof score === 'number' ? roundPct(score) : null,
      cue: `when ${entry?.domain ?? 'culture'} comes up, cites "${entry.name}" as proof`,
    });
  });

  return Object.freeze({
    version: DIALOGUE_CONTEXT_VERSION,
    character: Object.freeze({ name: entity.name, domain: entity.category ?? null }),
    voice,
    vocabulary,
    references: Object.freeze(references),
    rules: DIALOGUE_RULES,
    stats: Object.freeze({
      rankedConsidered: ranked.length,
      references: references.length,
      topicWords: topics.length,
      measuredAxes: measured.length,
    }),
  });
}

/**
 * The machine-checkable speaker contract: is this name a CONFIRMED
 * reference of the character? Case-insensitive exact match against
 * the reference list (the character's own name always qualifies).
 */
export function isConfirmedReference(context, name) {
  if (!context || !Array.isArray(context.references) || typeof name !== 'string') return false;
  const needle = name.normalize('NFC').trim().toLowerCase();
  if (needle.length === 0) return false;
  if (context.character?.name?.toLowerCase() === needle) return true;
  return context.references.some((ref) => ref.name.toLowerCase() === needle);
}

/**
 * Render the printable prompt appendix (deterministic, zero emojis).
 */
export function renderDialogueContext(context) {
  if (!context || typeof context !== 'object' || !Array.isArray(context.references)) {
    throw new TypeError('renderDialogueContext: expected a buildDialogueContext() result');
  }
  const lines = [];
  const c = context.character;
  lines.push(`DIALOGUE CONTEXT — ${c.name}${c.domain ? ` (${c.domain})` : ''}`);

  const v = context.voice;
  lines.push(`VOICE: register ${v.register}${v.dominant ? `, dominant ${v.dominant.label}` : ''}` +
    `${v.coherent !== null ? `, tonality ${v.coherent ? 'coherent' : 'mixed'}` : ''}`);
  if (v.traits.length > 0) lines.push(`   traits: ${v.traits.join(', ')}`);

  const voc = context.vocabulary;
  const vocabParts = [];
  if (voc.era.length > 0) vocabParts.push(`era cues: ${voc.era.join(', ')}`);
  if (voc.place !== null) vocabParts.push(`place cue: ${voc.place}`);
  if (voc.topics.length > 0) vocabParts.push(`topic words: ${voc.topics.join(', ')}`);
  lines.push(vocabParts.length > 0
    ? `VOCABULARY: ${vocabParts.join('; ')}`
    : 'VOCABULARY: none proven beyond the references');

  lines.push('CONFIRMED REFERENCES (the character may cite ONLY these):');
  if (context.references.length === 0) {
    lines.push('   (none proven — the character defers on all cultural claims)');
  } else {
    for (const ref of context.references) {
      lines.push(`   - ${ref.name} (${ref.domain ?? 'unknown domain'}${ref.affinityPercent !== null ? `, ${ref.affinityPercent}%` : ''})`);
    }
  }
  lines.push('RULES: cite only confirmed references; when unsure, deflect in character.');
  return lines.join('\n');
}

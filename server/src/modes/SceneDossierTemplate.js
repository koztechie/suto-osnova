/**
 * SceneDossierTemplate (task 83) — the OUTPUT TEMPLATE of Mode 1: the
 * deterministic transformation of a WorldbuilderMode bundle into the
 * structured, print-ready Mise-en-Scene Dossier the PRD promises
 * (docs/02_PRD_SCOPE.md 3.1).
 *
 * THE FIVE SECTIONS (the frozen contract, in reading order):
 *   1. character  — the anchor rendered as a character/scene brief:
 *                   identity, seed classification, the dominant
 *                   tonality axis with support, taste markers;
 *   2. sound      — the SOUND BACKGROUND: artists, albums and genre
 *                   markers (sound layer + music-domain ranked picks);
 *   3. literature — LITERATURE ON THE SHELF: verified texts and their
 *                   authors (literary layer, correlation gate intact);
 *   4. wardrobe   — the WARDROBE: clothing styles, objects and fabric
 *                   textures (material layer; architecture is scene,
 *                   not wardrobe — deliberately excluded);
 *   5. menu       — MENU & DRINKS: drinks, traditions, venue types
 *                   and venues (gastronomy layer).
 *
 * HONESTY RULES (the project-wide discipline, tasks 56-70):
 *   - an item's NAME may come ONLY from the bundle — the template
 *     never invents, embellishes or paraphrases proper nouns (the
 *     anti-hallucination pin: server/test/sceneDossierTemplate.test.js
 *     asserts every emitted name exists in the source bundle);
 *   - notes are EVIDENCE LINES (affinity %, correlation, popularity),
 *     never prose inventions; a missing score stays missing;
 *   - an empty section states its emptiness EXPLICITLY with the
 *     layer's coverage/failure counts — silence is not a strategy;
 *   - no clocks, no RNG: identical bundle -> byte-identical template
 *     and rendered text.
 *
 * SURFACES: buildSceneDossier(bundle, options) -> frozen structured
 * template; renderSceneDossier(template) -> the print-ready plain-text
 * document; SCENE_SECTIONS / SCENE_TEMPLATE_VERSION as the exported
 * template contracts.
 */

/** The section registry (reading order) — the template contract. */
export const SCENE_SECTIONS = Object.freeze([
  'character',
  'sound',
  'literature',
  'wardrobe',
  'menu',
]);

/** Template version — bumped on any contract change. */
export const SCENE_TEMPLATE_VERSION = 1;

/** Section titles (exported tuning contract for renderers). */
export const SCENE_SECTION_TITLES = Object.freeze({
  character: 'CHARACTER',
  sound: 'SOUND BACKGROUND',
  literature: 'LITERATURE ON THE SHELF',
  wardrobe: 'WARDROBE',
  menu: 'MENU & DRINKS',
});

/** Documented defaults (exported tuning contract). */
export const SCENE_DEFAULTS = Object.freeze({
  sectionLimit: 8,
});

const NO_DATA = 'No verified data — the source layer reported no usable signal.';

const roundPct = (value) => Math.round(value * 100);

/** Deterministic evidence line for one item (never invented prose). */
const evidenceNote = (item) => {
  if (typeof item?.affinity === 'number') return `affinity ${roundPct(item.affinity)}%`;
  if (typeof item?.correlation === 'number') return `correlation ${item.correlation}`;
  if (typeof item?.weight === 'number') return `weight ${item.weight}`;
  return 'signal present';
};

const toItem = (kind, item) => Object.freeze({
  kind,
  name: String(item?.name ?? ''),
  note: evidenceNote(item),
  signals: Object.freeze({
    affinity: typeof item?.affinity === 'number' ? item.affinity : null,
    correlation: typeof item?.correlation === 'number' ? item.correlation : null,
    popularity: typeof item?.popularity === 'number' ? item.popularity : null,
  }),
});

const named = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x.name === 'string' && x.name.length > 0) : []);

/** One section: deduplicated by name, capped, honestly summarized. */
const buildSection = (key, groups, layer, sectionLimit) => {
  const items = [];
  const seen = new Set();
  for (const { kind, list } of groups) {
    for (const item of named(list)) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      items.push(toItem(kind, item));
      if (items.length >= sectionLimit) break;
    }
    if (items.length >= sectionLimit) break;
  }
  const layerFailures = Array.isArray(layer?.failures) ? layer.failures.length : 0;
  return Object.freeze({
    key,
    title: SCENE_SECTION_TITLES[key],
    summary: items.length > 0
      ? `${items.length} verified pick(s).`
      : `${NO_DATA}${layerFailures > 0 ? ` (${layerFailures} leg failure(s))` : ''}`,
    items: Object.freeze(items),
    source: Object.freeze({
      layer: layer ? key : null,
      coverage: layer?.coverage ? Object.freeze({ ...layer.coverage }) : null,
      failures: layerFailures,
    }),
  });
};

const dominantAxis = (tonality) => {
  const axes = tonality?.centroid?.axes;
  if (!axes || typeof axes !== 'object') return null;
  let best = null;
  for (const [axis, value] of Object.entries(axes)) {
    if (typeof value !== 'number') continue;
    if (best === null || Math.abs(value) > Math.abs(best.value)
      || (Math.abs(value) === Math.abs(best.value) && axis < best.axis)) {
      best = { axis, value };
    }
  }
  return best === null ? null : Object.freeze({ axis: best.axis, direction: best.value >= 0 ? 'positive' : 'negative' });
};

/**
 * Build the structured scene-dossier template from a mode bundle.
 *
 * @param {object} bundle the frozen runWorldbuilder() result.
 * @param {object} [options] { sectionLimit } (default 8, clamped 1..50).
 * @returns {Readonly<object>} the frozen template.
 */
export function buildSceneDossier(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || !bundle.entity
    || typeof bundle.entity.name !== 'string') {
    throw new TypeError('buildSceneDossier: bundle must carry a named entity');
  }
  const rawLimit = options.sectionLimit ?? SCENE_DEFAULTS.sectionLimit;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    throw new TypeError('buildSceneDossier: sectionLimit must be an integer in 1..50');
  }

  const entity = bundle.entity;
  const layers = bundle.layers ?? {};
  const ranked = Array.isArray(bundle.ranked) ? bundle.ranked : [];
  const rankedBy = (domain) => ranked.filter((entry) => entry?.domain === domain);

  // 1. CHARACTER — the anchor as a brief, evidence only.
  const markers = rankedBy(entity.category)
    .flatMap((entry) => named(entry?.tags).map((tag) => tag.name));
  const character = Object.freeze({
    name: entity.name,
    domain: entity.category ?? null,
    seed: bundle.seed
      ? Object.freeze({ format: bundle.seed.format, confidence: bundle.seed.confidence })
      : null,
    tone: Object.freeze({
      coherent: bundle.tonality?.coherent ?? null,
      axis: dominantAxis(bundle.tonality),
      support: bundle.tonality?.centroid?.support ?? null,
      contradictions: Array.isArray(bundle.tonality?.contradictions)
        ? bundle.tonality.contradictions.length : 0,
    }),
    markers: Object.freeze([...new Set(markers)].slice(0, rawLimit)),
  });

  const sections = Object.freeze([
    // The character brief assembles from bundle-level facts (entity,
    // tonality, ranked markers) — not from one extraction layer.
    buildSection('character', [
      { kind: 'anchor', list: [entity] },
      { kind: 'marker', list: character.markers.map((name) => ({ name })) },
    ], null, rawLimit),
    buildSection('sound', [
      { kind: 'artist', list: layers.sound?.artists },
      { kind: 'album', list: layers.sound?.albums },
      { kind: 'genre', list: layers.sound?.genres },
      { kind: 'music_pick', list: rankedBy('music') },
    ], layers.sound, rawLimit),
    buildSection('literature', [
      { kind: 'text', list: layers.literary?.texts },
      { kind: 'author', list: layers.literary?.authors },
      { kind: 'essayist', list: layers.literary?.essayists },
      { kind: 'books_pick', list: rankedBy('books') },
    ], layers.literary, rawLimit),
    buildSection('wardrobe', [
      { kind: 'style', list: layers.material?.clothingStyles },
      { kind: 'object', list: layers.material?.objects },
      { kind: 'texture', list: layers.material?.textures },
      { kind: 'fashion_pick', list: rankedBy('fashion') },
    ], layers.material, rawLimit),
    buildSection('menu', [
      { kind: 'drink', list: layers.gastronomy?.drinks },
      { kind: 'tradition', list: layers.gastronomy?.traditions },
      { kind: 'venue_type', list: layers.gastronomy?.venueTypes },
      { kind: 'venue', list: layers.gastronomy?.venues },
      { kind: 'dining_pick', list: rankedBy('dining') },
    ], layers.gastronomy, rawLimit),
  ]);

  return Object.freeze({
    version: SCENE_TEMPLATE_VERSION,
    title: 'SUTO OSNOVA — MISE-EN-SCENE DOSSIER',
    anchor: Object.freeze({
      name: entity.name,
      domain: entity.category ?? null,
      format: bundle.seed?.format ?? null,
      confidence: bundle.seed?.confidence ?? null,
    }),
    tonality: character.tone,
    sections,
    provenance: Object.freeze({
      mode: bundle.mode ?? null,
      requestId: bundle.requestId ?? null,
      entity: Object.freeze({ id: entity.id ?? null, name: entity.name }),
      ranked: ranked.length,
      failures: Array.isArray(bundle.failures) ? bundle.failures.length : 0,
    }),
  });
}

/**
 * Render the template to the print-ready plain-text dossier.
 * Deterministic: identical template -> byte-identical document.
 */
export function renderSceneDossier(template) {
  if (!template || typeof template !== 'object' || !Array.isArray(template.sections)) {
    throw new TypeError('renderSceneDossier: expected a buildSceneDossier() template');
  }

  const lines = [];
  const a = template.anchor;
  lines.push(template.title);
  lines.push(
    `Anchor: ${a.name}${a.domain ? ` (${a.domain})` : ''}` +
      `${a.format ? ` — ${a.format}${a.confidence ? `, ${a.confidence} confidence` : ''}` : ''}`
  );
  const t = template.tonality;
  if (t && t.coherent !== null) {
    const axis = t.axis ? `${t.axis.axis}/${t.axis.direction}` : 'unclassified';
    lines.push(
      `Tonality: ${t.coherent ? 'coherent' : 'mixed'}` +
        `${t.axis ? ` (axis ${axis}${t.support !== null ? `, support ${t.support}` : ''})` : ''}` +
        `${t.contradictions > 0 ? ` — ${t.contradictions} contradiction(s)` : ''}`
    );
  }
  lines.push('');

  template.sections.forEach((section, index) => {
    lines.push(`${index + 1}. ${section.title}`);
    lines.push(`   ${section.summary}`);
    for (const item of section.items) {
      lines.push(`   - [${item.kind}] ${item.name} (${item.note})`);
    }
    lines.push('');
  });

  const p = template.provenance;
  lines.push(
    `PROVENANCE: mode=${p.mode ?? 'unknown'} request=${p.requestId ?? 'unknown'} ` +
      `entity=${p.entity?.id ?? 'unknown'} ranked=${p.ranked} failures=${p.failures} ` +
      `template=v${template.version}`
  );
  return lines.join('\n');
}

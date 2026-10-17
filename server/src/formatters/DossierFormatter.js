/**
 * DossierFormatter (task 101) — the UNIFIED OUTPUT DOCUMENT
 * generator: turns any mode's frozen bundle (worldbuilder /
 * activation / antithesis) into ONE coherent, print-ready document
 * plus a machine-readable section index.
 *
 * THE UNIFICATION PROBLEM IT SOLVES: the pipeline grew a render
 * function per block (scene dossier, materials spec, dialogue,
 * resonance, audience, curation lists, food zones, afterparty,
 * blindspot). A consumer (HTTP/MCP/UI) should not have to know
 * which blocks a given mode carries nor call twelve functions — the
 * formatter DETECTS what the bundle holds and assembles the
 * sections in one DOCUMENTED layout order (exported LAYOUTS).
 *
 * DESIGN DISCIPLINES:
 *   - ADAPTIVE, NOT INVENTIVE: a section appears only when its
 *     underlying data is present (the registry's `present` guard);
 *     absent blocks are silently skipped, never faked;
 *   - PER-SECTION FAILURE ISOLATION: one optional block that cannot
 *     be built degrades to an honest inline note
 *     "(<section> unavailable: <reason>)" and is ledgered in
 *     stats.sectionFailures — the unified document never dies
 *     because one optional block failed (the same allSettled
 *     discipline the modes use for layers);
 *   - ZERO HALLUCINATION: sections reuse the EXISTING render*
 *     functions verbatim (one source of truth per block); the
 *     formatter only adds the title block, the section rules and
 *     the footer;
 *   - DETERMINISTIC: no clocks, no RNG, a fixed layout order.
 *
 * Pure module (the render* functions it calls are pure): no I/O.
 * Surfaces: formatDossier(bundle, options) -> frozen {version,
 * mode, output, title, sections, document, stats};
 * SECTION_REGISTRY / LAYOUTS as the exported tuning contract.
 * Pinned by server/test/dossierFormatter.test.js.
 */

import { MODES } from '../engine/ModeDispatcher.js';
import { renderSceneDossier, buildSceneDossier } from '../modes/SceneDossierTemplate.js';
import { renderMaterialsSpec, buildMaterialsSpec } from '../modes/MaterialsSpec.js';
import { renderDialogueContext, buildDialogueContext } from '../modes/DialogueContext.js';
import { renderResonance } from '../modes/ResonanceIndex.js';
import { renderFoodCuration } from '../modes/FoodCuration.js';
import { renderAfterpartyEcosystem } from '../modes/AfterpartyEcosystem.js';
import { renderAntithesisReport } from '../modes/AntithesisMode.js';

/** Module version. */
export const DOSSIER_FORMATTER_VERSION = 1;

/** The document rule (a fixed, emoji-free horizontal divider). */
export const DOC_RULE = Object.freeze('='.repeat(60));

/** Inline renderers for the raw lists that ride the bundles. */
const renderCurationList = (title, items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return `${title}: none`;
  }
  const lines = [`${title}:`];
  for (const item of items) {
    lines.push(
      `   - ${item?.name ?? 'unknown'}` +
        `${item?.affinityPercent !== null && item?.affinityPercent !== undefined
          ? ` (${item.affinityPercent}% affinity)` : ''}` +
        `${item?.evidence ? ` [${item.evidence}]` : ''}`
    );
  }
  return lines.join('\n');
};

const renderAudience = (audience) => {
  if (!audience || audience.available !== true) {
    return `AUDIENCE INSIGHTS: unavailable${audience?.error ? ` (${audience.error})` : ''}`;
  }
  const top = Array.isArray(audience.top) ? audience.top : [];
  if (top.length === 0) return `AUDIENCE INSIGHTS: ${audience.count ?? 0} row(s), none ranked`;
  const lines = [`AUDIENCE INSIGHTS: ${audience.count ?? top.length} row(s)`];
  for (const row of top) {
    lines.push(
      `   - ${row?.name ?? 'unknown'}` +
        `${row?.affinityPercent !== null && row?.affinityPercent !== undefined
          ? ` (${row.affinityPercent}%)` : ''}`
    );
  }
  return lines.join('\n');
};

const renderTopList = (bundle) => {
  const ranked = Array.isArray(bundle.ranked) ? bundle.ranked : [];
  if (ranked.length === 0) return 'TOP AFFINITIES: none';
  const lines = ['TOP AFFINITIES:'];
  for (const entry of ranked) {
    lines.push(
      `   - ${entry?.name ?? 'unknown'} (${entry?.domain ?? 'unknown'})`
    );
  }
  return lines.join('\n');
};

const renderNarrative = (bundle) => {
  const text = bundle.synthesis?.text;
  return typeof text === 'string' && text.length > 0
    ? text
    : 'NARRATIVE: not available';
};

/**
 * The SECTION REGISTRY (exported tuning contract): each entry knows
 * its id, its document title, whether the bundle carries it, and
 * how to render the section body from the bundle.
 */
export const SECTION_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'top', title: 'TOP AFFINITIES',
    present: (b) => Array.isArray(b.ranked) && b.ranked.length > 0,
    render: (b) => renderTopList(b),
  }),
  Object.freeze({
    id: 'scene', title: 'SCENE DOSSIER',
    present: (b) => Boolean(b.layers) && Boolean(b.entity),
    render: (b) => renderSceneDossier(buildSceneDossier(b)),
  }),
  Object.freeze({
    id: 'materials', title: 'MATERIALS SPEC',
    present: (b) => Boolean(b.layers?.material),
    render: (b) => renderMaterialsSpec(buildMaterialsSpec(b)),
  }),
  Object.freeze({
    id: 'dialogue', title: 'DIALOGUE CONTEXT',
    present: (b) => Boolean(b.layers?.sound) && Boolean(b.entity),
    render: (b) => renderDialogueContext(buildDialogueContext(b)),
  }),
  Object.freeze({
    id: 'resonance', title: 'EVENT RESONANCE INDEX',
    present: (b) => Boolean(b.resonance),
    render: (b) => renderResonance(b.resonance),
  }),
  Object.freeze({
    id: 'audience', title: 'AUDIENCE INSIGHTS',
    present: (b) => Boolean(b.audience),
    render: (b) => renderAudience(b.audience),
  }),
  Object.freeze({
    id: 'opening_acts', title: 'OPENING ACTS',
    present: (b) => Array.isArray(b.curation?.openingActs) && b.curation.openingActs.length > 0,
    render: (b) => renderCurationList('OPENING ACTS', b.curation.openingActs),
  }),
  Object.freeze({
    id: 'sponsors', title: 'SPONSORS',
    present: (b) => Array.isArray(b.curation?.sponsors) && b.curation.sponsors.length > 0,
    render: (b) => renderCurationList('SPONSORS', b.curation.sponsors),
  }),
  Object.freeze({
    id: 'vendors', title: 'F&B VENDORS',
    present: (b) => Array.isArray(b.curation?.vendors) && b.curation.vendors.length > 0,
    render: (b) => renderCurationList('F&B VENDORS', b.curation.vendors),
  }),
  Object.freeze({
    id: 'food_zones', title: 'F&B ZONE MAP',
    present: (b) => Boolean(b.foodZones),
    render: (b) => renderFoodCuration(b.foodZones),
  }),
  Object.freeze({
    id: 'afterparty', title: 'AFTERPARTY ECOSYSTEM',
    present: (b) => Boolean(b.afterparty),
    render: (b) => renderAfterpartyEcosystem(b.afterparty),
  }),
  Object.freeze({
    id: 'blindspot', title: 'CULTURAL BLINDSPOT',
    present: (b) => Boolean(b.antithesis),
    render: (b) => renderAntithesisReport(b.antithesis),
  }),
  Object.freeze({
    id: 'narrative', title: 'NARRATIVE',
    present: (b) => Boolean(b.synthesis),
    render: (b) => renderNarrative(b),
  }),
]);

/** The documented layout order per mode (exported tuning contract). */
export const LAYOUTS = Object.freeze({
  worldbuilder: Object.freeze([
    'top', 'scene', 'materials', 'dialogue', 'narrative',
  ]),
  activation: Object.freeze([
    'resonance', 'audience', 'opening_acts', 'sponsors', 'vendors',
    'food_zones', 'afterparty', 'narrative',
  ]),
  antithesis: Object.freeze(['blindspot', 'narrative']),
});

const byId = new Map(SECTION_REGISTRY.map((section) => [section.id, section]));

/**
 * Format any mode's bundle into one unified output document.
 *
 * @param {object} bundle a frozen runWorldbuilder / runExperiential
 *        / runAntithesis result.
 * @param {object} [options] { sections } an explicit id order
 *        override (validated against the registry).
 * @returns {Readonly<object>} the frozen document record.
 */
export function formatDossier(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.mode !== 'string') {
    throw new TypeError('formatDossier: bundle must carry a string `mode`');
  }
  const layout = options.sections ?? LAYOUTS[bundle.mode] ?? null;
  if (layout !== null && !Array.isArray(layout)) {
    throw new TypeError('formatDossier: options.sections must be an array of section ids');
  }
  if (Array.isArray(layout)) {
    for (const id of layout) {
      if (!byId.has(id)) {
        throw new TypeError(`formatDossier: unknown section id "${id}"`);
      }
    }
  }

  const entity = bundle.entity ?? {};
  const label = MODES[bundle.mode]?.label ?? bundle.mode;
  const title = `DOSSIER — ${label}`;
  const subtitle =
    `ANCHOR: ${entity.name ?? 'unknown'}${entity.category ? ` (${entity.category})` : ''}` +
    `${bundle.requestId ? `  |  REQUEST: ${bundle.requestId}` : ''}`;

  const sections = [];
  const failures = [];
  for (const id of (layout ?? [])) {
    const section = byId.get(id);
    if (!section.present(bundle)) continue; // absent blocks are skipped, never faked
    let body;
    try {
      body = section.render(bundle);
    } catch (error) {
      // One optional block must not kill the unified document —
      // degrade to an honest note and ledger the failure.
      body = `(${section.title.toLowerCase()} unavailable: ${String(error?.message ?? error).slice(0, 200)})`;
      failures.push(Object.freeze({ id, message: String(error?.message ?? error).slice(0, 300) }));
    }
    sections.push(Object.freeze({ id, title: section.title, body }));
  }

  // Assemble the document: title block, then each section under its
  // own rule, deterministic order, zero emojis.
  const parts = [title, subtitle, DOC_RULE];
  for (const section of sections) {
    parts.push(section.title, section.body, DOC_RULE);
  }
  parts.push(
    `FOOTER: ${sections.length} section(s)` +
      `${failures.length > 0 ? `, ${failures.length} unavailable` : ''}` +
      `${bundle.stats ? `  |  mode stats: ${JSON.stringify(bundle.stats)}` : ''}`
  );
  const document = parts.join('\n');

  return Object.freeze({
    version: DOSSIER_FORMATTER_VERSION,
    mode: bundle.mode,
    output: MODES[bundle.mode]?.output ?? null,
    title,
    subtitle,
    // The run-identity block the printed title block fixes (task
    // 105): the request id, the normalized input, the stable entity
    // identity, the scene context and the persisted session id (null
    // when the run was not persisted — reported, never faked).
    meta: Object.freeze({
      requestId: bundle.requestId ?? null,
      seed: bundle.seed ?? null,
      entity: Object.freeze({
        id: entity.id ?? null,
        name: entity.name ?? null,
        category: entity.category ?? null,
      }),
      scene: bundle.scene ?? null,
      session: bundle.session?.id ?? null,
    }),
    sections: Object.freeze(sections),
    sectionIndex: Object.freeze(sections.map((s) => s.id)),
    document,
    stats: Object.freeze({
      sections: sections.length,
      unavailable: failures.length,
      sectionFailures: Object.freeze(failures),
      characters: document.length,
    }),
  });
}

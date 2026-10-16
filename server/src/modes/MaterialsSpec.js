/**
 * MaterialsSpec (task 85) — the MATERIALS SPECIFICATION for production
 * designers: concrete fabrics, metals and lighting derived from the
 * dossier's extracted taste markers.
 *
 * THE HONESTY CHAIN (the project-wide discipline): a production
 * designer must know WHY a material is on the sheet. Every spec item
 * therefore carries its SOURCE MARKER and the derivation kind:
 *   - direct  — the marker IS a material vocabulary word ("chrome",
 *               "velvet", "neon") and passes through verbatim;
 *   - mapped  — a STYLE marker ("gothic", "brutalist") translates
 *               through the EXPORTED, DOCUMENTED MATERIAL_MAP table —
 *               deterministic design knowledge, never prose
 *               invention; the table is the tuning contract and is
 *               pinned entry-by-entry by tests.
 * Item NAMES come only from the two tables — the module invents
 * nothing; markers come only from the bundle (material + visual
 * layers and ranked-entry tags).
 *
 * THE THREE FAMILIES (the task contract, frozen order):
 *   fabrics  — textures, clothing styles and fabric-marker tags;
 *   metals   — object/architecture metal markers and style maps;
 *   lighting — cinematography/color markers and style maps (the
 *              light plot a gaffer can actually order).
 *
 * Matching is deterministic: markers normalize (lowercase, NFC,
 * whitespace/dash collapse), DIRECT keywords match as substrings,
 * MAP keys match as exact normalized tokens — no stemming, no fuzzy
 * guessing (documented limitation: Qloo's canonical tag vocabulary
 * supplies the singular forms).
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * buildMaterialsSpec(bundle, options) -> frozen spec;
 * renderMaterialsSpec(spec) -> the printable block that
 * renderSceneDossier appends before the provenance footer.
 */

/** The family registry (frozen order — the task contract). */
export const MATERIAL_FAMILIES = Object.freeze(['fabrics', 'metals', 'lighting']);

/** Template version of the spec sheet. */
export const MATERIALS_SPEC_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const MATERIALS_DEFAULTS = Object.freeze({
  familyLimit: 8,
});

/**
 * DIRECT material vocabulary: a marker containing the keyword IS the
 * material. Exported as the tuning contract (pinned per entry).
 */
export const DIRECT_MATERIALS = Object.freeze({
  fabrics: Object.freeze([
    'velvet', 'lace', 'silk', 'leather', 'denim', 'wool', 'cotton',
    'canvas', 'satin', 'tweed', 'latex', 'chiffon', 'fur', 'vinyl',
  ]),
  metals: Object.freeze([
    'steel', 'iron', 'brass', 'copper', 'chrome', 'aluminium',
    'aluminum', 'bronze', 'zinc', 'titanium', 'nickel',
  ]),
  lighting: Object.freeze([
    'neon', 'fluorescent', 'tungsten', 'halogen', 'candlelight',
    'gaslight', 'sodium', 'mercury', 'led', 'laser', 'strobe',
    'moonlight', 'daylight', 'amber',
  ]),
});

/**
 * STYLE-TO-MATERIAL map: exact normalized marker token -> concrete
 * materials per family. Each entry is documented design knowledge;
 * the test suite pins every entry (the tuning contract). Keys are
 * LOOKED UP THROUGH the same normalization ("post-punk" -> "post
 * punk"), so entries may be written in natural spelling.
 */
export const MATERIAL_MAP = Object.freeze({
  gothic: Object.freeze({
    fabrics: Object.freeze(['black velvet', 'lace']),
    metals: Object.freeze(['blackened iron']),
    lighting: Object.freeze(['candlelight']),
  }),
  'post-punk': Object.freeze({
    fabrics: Object.freeze(['rubber', 'mohair']),
    metals: Object.freeze(['chrome', 'steel']),
    lighting: Object.freeze(['fluorescent']),
  }),
  brutalist: Object.freeze({
    fabrics: Object.freeze(['raw canvas']),
    metals: Object.freeze(['exposed steel']),
    lighting: Object.freeze(['fluorescent']),
  }),
  monochrome: Object.freeze({
    fabrics: Object.freeze(['matte black wool', 'raw white cotton']),
    metals: Object.freeze(['brushed aluminium']),
    lighting: Object.freeze(['hard key light']),
  }),
  horror: Object.freeze({
    fabrics: Object.freeze([]),
    metals: Object.freeze([]),
    lighting: Object.freeze(['low-key lighting']),
  }),
  noir: Object.freeze({
    fabrics: Object.freeze(['wool', 'felt']),
    metals: Object.freeze([]),
    lighting: Object.freeze(['venetian-blind shadow', 'single hard key']),
  }),
  'art deco': Object.freeze({
    fabrics: Object.freeze(['silk', 'georgette']),
    metals: Object.freeze(['brass', 'chrome']),
    lighting: Object.freeze(['amber sconces']),
  }),
  bauhaus: Object.freeze({
    fabrics: Object.freeze(['raw cotton canvas']),
    metals: Object.freeze(['tubular steel']),
    lighting: Object.freeze(['diffused daylight']),
  }),
  cyberpunk: Object.freeze({
    fabrics: Object.freeze(['latex', 'PVC']),
    metals: Object.freeze(['anodized aluminium']),
    lighting: Object.freeze(['neon', 'LED strips']),
  }),
  steampunk: Object.freeze({
    fabrics: Object.freeze(['leather', 'brocade']),
    metals: Object.freeze(['brass', 'copper']),
    lighting: Object.freeze(['gaslight', 'tungsten']),
  }),
  baroque: Object.freeze({
    fabrics: Object.freeze(['brocade', 'velvet']),
    metals: Object.freeze(['gilded bronze']),
    lighting: Object.freeze(['candlelight']),
  }),
  minimalist: Object.freeze({
    fabrics: Object.freeze(['raw linen']),
    metals: Object.freeze(['matte steel']),
    lighting: Object.freeze(['diffused daylight']),
  }),
});

const normalizeToken = (value) =>
  value.normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** The map pre-indexed by normalized key (deterministic lookup). */
const MAP_BY_TOKEN = new Map(
  Object.entries(MATERIAL_MAP).map(([key, value]) => [normalizeToken(key), value])
);

/** Collect (marker, layer) pairs from every dossier source. */
const collectMarkers = (bundle) => {
  const found = [];
  const add = (layer, list) => {
    for (const entry of Array.isArray(list) ? list : []) {
      if (entry && typeof entry.name === 'string' && entry.name.length > 0) {
        found.push({ marker: entry.name, layer });
      }
    }
  };
  add('material', bundle?.layers?.material?.textures);
  add('material', bundle?.layers?.material?.clothingStyles);
  add('material', bundle?.layers?.material?.objects);
  add('material', bundle?.layers?.material?.architecture);
  add('visual', bundle?.layers?.visual?.cinematography);
  add('visual', bundle?.layers?.visual?.colorSolutions);
  add('visual', bundle?.layers?.visual?.artSchools);
  for (const entry of Array.isArray(bundle?.ranked) ? bundle.ranked : []) {
    add('ranked', entry?.tags);
  }
  return found;
};

/**
 * Build the materials specification from a mode bundle.
 *
 * @param {object} bundle the frozen runWorldbuilder() result.
 * @param {object} [options] { familyLimit } (default 8, clamped 1..50).
 * @returns {Readonly<object>} frozen {version, families, stats}.
 */
export function buildMaterialsSpec(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('buildMaterialsSpec: expected a mode bundle object');
  }
  const limit = options.familyLimit ?? MATERIALS_DEFAULTS.familyLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('buildMaterialsSpec: familyLimit must be an integer in 1..50');
  }

  const markers = collectMarkers(bundle);
  const families = {};
  let mappedEntries = 0;

  for (const family of MATERIAL_FAMILIES) {
    const items = [];
    const seen = new Set();
    const push = (name, kind, marker, layer) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push(Object.freeze({
        name,
        family,
        source: Object.freeze({ kind, marker, layer }),
        note: kind === 'direct'
          ? `marker "${marker}" is material vocabulary`
          : `style marker "${marker}" via MATERIAL_MAP`,
      }));
    };

    for (const { marker, layer } of markers) {
      if (items.length >= limit) break;
      const token = normalizeToken(marker);
      // Direct pass-through: the marker IS a material word. Word
      // boundaries only — "monochrome" must NOT match "chrome".
      const direct = DIRECT_MATERIALS[family].find((keyword) =>
        new RegExp(`\\b${keyword}\\b`).test(token)
      );
      if (direct !== undefined) {
        push(direct, 'direct', marker, layer);
        continue;
      }
      // Style map: exact normalized token keys only (no fuzzy guessing).
      const mapped = MAP_BY_TOKEN.get(token);
      if (mapped !== undefined && Array.isArray(mapped[family])) {
        mappedEntries += 1;
        for (const name of mapped[family]) {
          if (items.length >= limit) break;
          push(name, 'mapped', marker, layer);
        }
      }
    }

    families[family] = Object.freeze({
      items: Object.freeze(items),
      summary: items.length > 0
        ? `${items.length} material(s) derived from the dossier's markers.`
        : 'No verified materials — no dossier marker mapped into this family.',
    });
  }

  return Object.freeze({
    version: MATERIALS_SPEC_VERSION,
    families: Object.freeze(families),
    stats: Object.freeze({
      markersScanned: markers.length,
      mappedEntries,
      total: MATERIAL_FAMILIES.reduce((sum, f) => sum + families[f].items.length, 0),
    }),
  });
}

const FAMILY_TITLES = Object.freeze({
  fabrics: 'FABRICS',
  metals: 'METALS',
  lighting: 'LIGHTING',
});

/**
 * Render the printable materials block (deterministic). Returns an
 * empty string for an all-empty spec so renderSceneDossier can skip
 * the section entirely.
 */
export function renderMaterialsSpec(spec) {
  if (!spec || typeof spec !== 'object' || !spec.families) {
    throw new TypeError('renderMaterialsSpec: expected a buildMaterialsSpec() result');
  }
  const lines = [];
  for (const family of MATERIAL_FAMILIES) {
    const block = spec.families[family];
    if (block.items.length > 0) {
      lines.push(`${FAMILY_TITLES[family]}:`);
      for (const item of block.items) {
        lines.push(`   - ${item.name} [${item.source.kind} via "${item.source.marker}"]`);
      }
    }
  }
  if (lines.length === 0) return '';
  return ['MATERIALS SPEC (for the production designer)', ...lines].join('\n');
}

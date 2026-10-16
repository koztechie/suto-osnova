/**
 * BrandPartners (task 91) — PARTNER BRAND SELECTION for sponsorship
 * zones and merchandise, driven by the attendees' fashion tastes.
 *
 * TWO OUTPUTS:
 *   1. BRANDS — the partner shortlist scored on the audience's own
 *      evidence:
 *        - AUDIENCE signal — the brand's affinity in the Qloo
 *          audience-insights top list (the attendees' demonstrated
 *          taste, the strongest sponsorship argument);
 *        - GRAPH signal — the fashion-domain ranked pick (taste-graph
 *          confirmation of the headliner's expansion);
 *        - STYLE signal — rarity-weighted tag kinship (task 59,
 *          reused) between the brand's tags and the attendees' style
 *          markers (material clothing styles + fashion tag words).
 *      The score is the renormalized weighted sum (default audience
 *      0.50 / graph 0.35 / style 0.15) over AVAILABLE signals only
 *      (task-48 discipline); a candidate with nothing measurable is
 *      rejected (no_evidence), never silently zeroed. Tiers record
 *      the evidence shape: dual (audience AND graph) >
 *      audience_brand > graph_brand; `brandVerified` marks the Qloo
 *      subtype check (urn:entity:brand) — an audience row WITHOUT a
 *      subtype is honestly unverified, never claimed a brand.
 *   2. MERCH — the merchandise direction mapped from the STYLE
 *      MARKERS through the exported MERCH_MAP table (deterministic
 *      design knowledge, pinned entry-by-entry); a documented
 *      BASELINE set (event tee/cap/poster/tote) exists but ships
 *      ONLY on explicit request (options.baseline) — generic merch
 *      without taste evidence is not a finding.
 *
 * Gates: no_evidence, below_min_score (options.minScore, default 0 =
 * the gate is OFF by default). Deterministic: score round to 12dp,
 * name tie-breaks, pure, no clocks. Surfaces: selectBrandPartners,
 * piecesFromActivationBundle (adapter over a runExperiential bundle),
 * renderBrandPartners. Pinned by server/test/brandPartners.test.js.
 */

import { tagKinship } from '../engine/AffinityScorer.js';
import { connectionScoreOf } from '../engine/ScoreNormalizer.js';

/** Module version. */
export const BRAND_PARTNERS_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const BRAND_PARTNERS_DEFAULTS = Object.freeze({
  maxBrands: 6,
  merchLimit: 8,
  minScore: 0,
  weights: Object.freeze({ audience: 0.5, graph: 0.35, style: 0.15 }),
});

/** Machine-readable rejection reasons. */
export const BRAND_REASONS = Object.freeze({
  NO_EVIDENCE: 'no_evidence',
  BELOW_MIN_SCORE: 'below_min_score',
});

/** Evidence tiers (ordered strongest first). */
export const BRAND_TIERS = Object.freeze({
  DUAL: 'dual',
  AUDIENCE: 'audience_brand',
  GRAPH: 'graph_brand',
});

/**
 * STYLE MARKER -> MERCHANDISE map (the exported tuning contract,
 * pinned entry by entry). Keys match through the same NFC/space
 * normalization as the marker stream.
 */
export const MERCH_MAP = Object.freeze({
  'post-punk': Object.freeze(['enamel pins', 'screen-printed tees', 'silver chains']),
  gothic: Object.freeze(['black tees', 'silver rings', 'velvet pouches']),
  brutalist: Object.freeze(['concrete-grey hoodies', 'steel keychains']),
  monochrome: Object.freeze(['two-tone caps', 'mono tote bags']),
  cyberpunk: Object.freeze(['reflective windbreakers', 'LED patches']),
  steampunk: Object.freeze(['brass goggles', 'leather wristbands']),
  'art deco': Object.freeze(['gold-trim notebooks', 'deco posters']),
  bauhaus: Object.freeze(['primary-color tees', 'geometric prints']),
  noir: Object.freeze(['fedora pins', 'noir print scarves']),
  minimalist: Object.freeze(['blank heavyweight tees', 'matte stickers']),
});

/** The documented baseline (explicit request only). */
export const BASELINE_MERCH = Object.freeze([
  'event tee', 'cap', 'poster', 'tote bag',
]);

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeToken = (value) =>
  value.normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

const MERCH_BY_TOKEN = new Map(
  Object.entries(MERCH_MAP).map(([key, value]) => [normalizeToken(key), value])
);

const isBrandSubtype = (subtype) =>
  typeof subtype === 'string' && subtype.toLowerCase().includes('brand');

/**
 * Select partner brands + the merch direction.
 *
 * @param {object} pieces { graphBrands, audienceRows, styleMarkers }.
 * @param {object} [options] { maxBrands, merchLimit, minScore,
 *        weights, baseline }.
 * @returns {Readonly<object>} the frozen block.
 */
export function selectBrandPartners(pieces, options = {}) {
  if (!pieces || typeof pieces !== 'object') {
    throw new TypeError('selectBrandPartners: pieces must be an object');
  }
  const graphBrands = Array.isArray(pieces.graphBrands) ? pieces.graphBrands : [];
  const audienceRows = Array.isArray(pieces.audienceRows) ? pieces.audienceRows : [];
  const styleMarkers = Array.isArray(pieces.styleMarkers) ? pieces.styleMarkers : [];

  const maxBrands = options.maxBrands ?? BRAND_PARTNERS_DEFAULTS.maxBrands;
  const merchLimit = options.merchLimit ?? BRAND_PARTNERS_DEFAULTS.merchLimit;
  if (!Number.isInteger(maxBrands) || maxBrands < 1 || maxBrands > 50) {
    throw new TypeError('selectBrandPartners: maxBrands must be an integer in 1..50');
  }
  if (!Number.isInteger(merchLimit) || merchLimit < 1 || merchLimit > 50) {
    throw new TypeError('selectBrandPartners: merchLimit must be an integer in 1..50');
  }
  const minScore = options.minScore ?? BRAND_PARTNERS_DEFAULTS.minScore;
  if (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new TypeError('selectBrandPartners: minScore must be in 0..1');
  }
  const weights = { ...BRAND_PARTNERS_DEFAULTS.weights, ...(options.weights ?? {}) };
  for (const [key, value] of Object.entries(weights)) {
    if (!['audience', 'graph', 'style'].includes(key)) {
      throw new TypeError(`selectBrandPartners: unknown weight "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`selectBrandPartners: weights.${key} must be a finite number >= 0`);
    }
  }
  if (weights.audience + weights.graph + weights.style <= 0) {
    throw new TypeError('selectBrandPartners: at least one weight must be positive');
  }

  const styleTags = styleMarkers
    .filter((marker) => typeof marker === 'string' && marker.length > 0)
    .map((marker) => ({ name: marker }));

  // One candidate record per NAME across both evidence lists.
  const candidates = new Map();
  for (const row of audienceRows) {
    if (!row || typeof row.name !== 'string' || row.name.length === 0) continue;
    const record = candidates.get(row.name) ?? { name: row.name };
    record.audience = finite(row.affinity);
    if (isBrandSubtype(row.subtype)) record.brandVerified = true;
    candidates.set(row.name, record);
  }
  for (const entry of graphBrands) {
    if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) continue;
    const record = candidates.get(entry.name) ?? { name: entry.name };
    record.graph = connectionScoreOf(entry);
    record.id = entry.id ?? record.id ?? null;
    record.tags = Array.isArray(entry.tags) ? entry.tags : (record.tags ?? []);
    if (isBrandSubtype(entry.subtype)) record.brandVerified = true;
    candidates.set(entry.name, record);
  }

  const brands = [];
  const rejected = [];
  let dual = 0;
  for (const record of candidates.values()) {
    const audience = finite(record.audience);
    const graph = finite(record.graph);
    const style = record.tags && record.tags.length > 0 && styleTags.length > 0
      ? (tagKinship({ tags: styleTags }, { tags: record.tags })?.value ?? null)
      : null;

    const components = { audience, graph, style };
    const active = Object.entries(components).filter(([, value]) => value !== null);
    if (active.length === 0) {
      rejected.push(Object.freeze({ name: record.name, reason: BRAND_REASONS.NO_EVIDENCE }));
      continue;
    }
    const weightSum = active.reduce((sum, [key]) => sum + weights[key], 0);
    if (weightSum <= 0) {
      // Every available component carries zero weight (the caller
      // zeroed exactly this candidate's signals) — no evidence under
      // the active weighting, honestly rejected.
      rejected.push(Object.freeze({ name: record.name, reason: BRAND_REASONS.NO_EVIDENCE }));
      continue;
    }
    const score = round12(
      active.reduce((sum, [key, value]) => sum + weights[key] * value, 0) / weightSum
    );
    if (score < minScore) {
      rejected.push(Object.freeze({
        name: record.name, reason: BRAND_REASONS.BELOW_MIN_SCORE, score,
      }));
      continue;
    }

    const tier = audience !== null && graph !== null
      ? BRAND_TIERS.DUAL
      : (audience !== null ? BRAND_TIERS.AUDIENCE : BRAND_TIERS.GRAPH);
    if (tier === BRAND_TIERS.DUAL) dual += 1;

    brands.push(Object.freeze({
      name: record.name,
      id: record.id ?? null,
      tier,
      brandVerified: record.brandVerified === true,
      score,
      components: Object.freeze({ audience, graph, style }),
      affinityPercent: graph !== null ? Math.round(graph * 100)
        : (audience !== null ? Math.round(audience * 100) : null),
      pitch: `audience-tested partner (${tier.replace('_', ' ')})` +
        `${graph !== null ? ` at ${Math.round(graph * 100)}% graph affinity` : ''}`,
    }));
  }

  brands.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // MERCH: marker-mapped products, deduplicated, honest provenance.
  const merchItems = [];
  const seen = new Set();
  const markersUsed = [];
  for (const marker of styleMarkers) {
    if (typeof marker !== 'string' || marker.length === 0) continue;
    const mapped = MERCH_BY_TOKEN.get(normalizeToken(marker));
    if (mapped === undefined) continue;
    markersUsed.push(marker);
    for (const name of mapped) {
      if (merchItems.length >= merchLimit) break;
      if (seen.has(name)) continue;
      seen.add(name);
      merchItems.push(Object.freeze({
        name,
        source: Object.freeze({ kind: 'mapped', marker }),
      }));
    }
  }
  if (options.baseline === true) {
    for (const name of BASELINE_MERCH) {
      if (merchItems.length >= merchLimit) break;
      if (seen.has(name)) continue;
      seen.add(name);
      merchItems.push(Object.freeze({
        name,
        source: Object.freeze({ kind: 'baseline', marker: null }),
      }));
    }
  }

  return Object.freeze({
    version: BRAND_PARTNERS_VERSION,
    weights: Object.freeze({ ...weights }),
    brands: Object.freeze(brands.slice(0, maxBrands)),
    rejected: Object.freeze(rejected),
    merch: Object.freeze({
      items: Object.freeze(merchItems),
      markersUsed: Object.freeze(markersUsed),
      summary: merchItems.length > 0
        ? `${merchItems.length} merch line(s) from ${markersUsed.length} style marker(s).`
        : 'No style marker mapped into merchandise — the merch line stays generic.',
    }),
    stats: Object.freeze({
      candidates: candidates.size,
      selected: Math.min(brands.length, maxBrands),
      dual,
      verified: brands.filter((b) => b.brandVerified).length,
      rejected: rejected.length,
      merchItems: merchItems.length,
    }),
  });
}

/**
 * Adapter: a runExperiential() bundle into brand-partner pieces.
 * Graph brands = the fashion-domain ranked picks (Qloo subtype kept
 * as the brandVerified evidence); audience rows = the audience top
 * list (no subtype at this layer — honestly unverified); style
 * markers = material clothing styles + fashion tag words.
 */
export function piecesFromActivationBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.entity
    || typeof bundle.entity.name !== 'string') {
    throw new TypeError('piecesFromActivationBundle: bundle must carry a named entity');
  }
  const ranked = Array.isArray(bundle.ranked) ? bundle.ranked : [];
  const material = bundle.layers?.material ?? null;

  const styleMarkers = [];
  const seenMarkers = new Set();
  const addMarker = (marker) => {
    if (typeof marker !== 'string' || marker.length === 0) return;
    if (seenMarkers.has(marker)) return;
    seenMarkers.add(marker);
    styleMarkers.push(marker);
  };
  for (const style of Array.isArray(material?.clothingStyles) ? material.clothingStyles : []) {
    addMarker(style?.name);
  }
  for (const entry of ranked.filter((row) => row?.domain === 'fashion')) {
    for (const tag of Array.isArray(entry.tags) ? entry.tags : []) addMarker(tag?.name);
  }

  return Object.freeze({
    graphBrands: Object.freeze(ranked.filter((row) => row?.domain === 'fashion')
      .map((entry) => Object.freeze({
        id: entry.id ?? null,
        name: entry.name,
        subtype: entry.subtype ?? null,
        affinity: finite(entry.affinity),
        popularity: finite(entry.popularity),
        tags: Array.isArray(entry.tags) ? entry.tags : [],
      }))),
    audienceRows: Object.freeze(
      (bundle.audience?.top ?? []).map((row) => Object.freeze({
        name: row?.name ?? '',
        affinity: row?.affinityPercent !== null && row?.affinityPercent !== undefined
          ? row.affinityPercent / 100 : null,
        subtype: null, // the task-88 row carries no subtype — honestly unverified
      }))
    ),
    styleMarkers: Object.freeze(styleMarkers),
  });
}

/**
 * Render the printable brand-partners block (deterministic, zero
 * emojis).
 */
export function renderBrandPartners(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.brands)) {
    throw new TypeError('renderBrandPartners: expected a selectBrandPartners() block');
  }
  const lines = [];
  lines.push('BRAND PARTNERS (sponsorship & merch)');
  if (block.brands.length === 0) {
    lines.push('   (no brand with measurable audience evidence)');
  }
  for (const brand of block.brands) {
    lines.push(
      `   - ${brand.name} [${brand.tier}${brand.brandVerified ? ', verified brand' : ''}]` +
        `${brand.affinityPercent !== null ? ` — ${brand.affinityPercent}%` : ''}`
    );
  }
  if (block.merch.items.length > 0) {
    lines.push('MERCH DIRECTION:');
    for (const item of block.merch.items) {
      lines.push(
        `   - ${item.name}${item.source.kind === 'mapped' ? ` (from marker "${item.source.marker}")` : ' (baseline)'}`
      );
    }
  } else {
    lines.push(block.merch.summary);
  }
  return lines.join('\n');
}

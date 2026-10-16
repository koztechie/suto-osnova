/**
 * ConnectionNotes (task 65) — explanatory notes for EVERY cultural
 * connection in the dossier: "why fans of this cinema choose exactly
 * this sound".
 *
 * TWO PRODUCTS PER CONNECTION, both deterministic:
 *   1. EVIDENCE — the machine-readable proof record behind the note:
 *      the domain bridge, the connection score (task-60 percent when
 *      supplied, else the task-60 reader over the target's fields),
 *      SHARED MARKERS (tag-name/tag-urn intersection of the two
 *      sides), RARITY (task-57 uniqueness coefficient of the target's
 *      popularity) and SPECIFICITY (task-56 excess: relevance beyond
 *      fame);
 *   2. NOTE — a bounded template string assembled from those facts,
 *      with an honesty clause: a connection the data cannot explain
 *      says so explicitly ("mechanism unverified — Qloo reports the
 *      correlation; the dossier does not invent a cause") instead of
 *      fabricating a causal story. This is the tasks-63
 *      anti-hallucination contract applied to EXPLANATION: notes
 *      interpret evidence, never manufacture it. Templates are English
 *      (engine convention); the synthesis LLM re-renders notes in the
 *      request language using the evidence payload.
 *
 * Confidence is derived, not asserted: `evidence_backed` requires at
 * least one of (shared markers, positive excess, long-tail rarity);
 * otherwise the note is marked `data_only`.
 *
 * Batch form annotateConnections(connections) preserves order, carries
 * stats and is fully frozen. Pure engine module: reuses the sibling
 * metric modules; no I/O, no clocks, no RNG.
 */

import { connectionScoreOf, toPercent } from './ScoreNormalizer.js';
import { excessAffinity } from './LongTailFilter.js';
import { uniquenessCoefficient } from './UniquenessCoefficient.js';

/** Confidence ladder (exported). */
export const NOTE_CONFIDENCE = Object.freeze({
  EVIDENCE_BACKED: 'evidence_backed',
  DATA_ONLY: 'data_only',
});

/** Thresholds (exported tuning contract). */
export const NOTE_DEFAULTS = Object.freeze({
  specificityFloor: 0.05,
  rarityFloor: 0.35,
});

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const normalizeName = (value) =>
  (typeof value === 'string' ? value : '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Tag key -> display name of one side, normalized and deduped. */
function tagNames(side) {
  const names = new Map();
  for (const tag of Array.isArray(side?.tags) ? side.tags : []) {
    if (!tag || typeof tag !== 'object') continue;
    const key =
      (typeof tag.id === 'string' && tag.id.length > 0 ? tag.id : null) ??
      normalizeName(tag.name);
    const display = typeof tag.name === 'string' && tag.name.trim().length > 0
      ? tag.name.trim()
      : key;
    if (key && display) names.set(key, display);
  }
  return names;
}

const isDomain = (value) => typeof value === 'string' && value.length > 0;

/**
 * Builds the evidence record + deterministic note for ONE connection.
 *
 * @param {{source: object, target: object, percent?: number}} connection
 *        — source/target carry {name, domain?|category?, tags?,
 *        affinity?|correlation?|weight?, popularity?}; percent is the
 *        task-60 normalized score when already computed.
 * @param {object} [options] NOTE_DEFAULTS overrides.
 * @returns {Readonly<{evidence, note, confidence}>} frozen.
 * @throws {TypeError} on non-object connections (programmer error).
 */
export function explainConnection(connection, options = {}) {
  if (!connection || typeof connection !== 'object') {
    throw new TypeError('explainConnection: connection must be an object');
  }
  const { specificityFloor, rarityFloor } = { ...NOTE_DEFAULTS, ...options };
  const { source = {}, target = {} } = connection;

  const sourceName = typeof source.name === 'string' ? source.name : 'the anchor';
  const targetName = typeof target.name === 'string' ? target.name : 'this pick';

  const percent =
    finiteNumber(connection.percent) !== null
      ? toPercent(connection.percent / 100)
      : toPercent(connectionScoreOf(target));
  const excess = excessAffinity(target);
  const rarity = uniquenessCoefficient(target.popularity ?? null);
  const excessPoints = excess !== null && excess > 0 ? round6(excess * 100) : 0;

  // Shared markers: display names common to both sides.
  const sourceTags = tagNames(source);
  const targetTags = tagNames(target);
  const sharedMarkers = [];
  for (const [key, display] of sourceTags) {
    if (targetTags.has(key)) sharedMarkers.push(display);
  }

  const sourceDomain = source.domain ?? source.category ?? null;
  const targetDomain = target.domain ?? target.category ?? null;
  const bridge = isDomain(sourceDomain) && isDomain(targetDomain) && sourceDomain !== targetDomain;

  const longTail = rarity.coefficient !== null && rarity.coefficient >= rarityFloor;
  const specific = excess !== null && excess > specificityFloor;
  const confidence =
    sharedMarkers.length > 0 || longTail || specific
      ? NOTE_CONFIDENCE.EVIDENCE_BACKED
      : NOTE_CONFIDENCE.DATA_ONLY;

  // Deterministic template (English; the LLM re-renders per language).
  const parts = [
    `Why fans of ${sourceName} choose ${targetName}: ` +
      (percent !== null
        ? `Qloo reports ${percent}% affinity`
        : 'Qloo reports a correlation without a normalized score') +
      (bridge ? ` across the ${sourceDomain} -> ${targetDomain} bridge` : '') +
      '.',
  ];
  if (sharedMarkers.length > 0) {
    parts.push(`Shared markers: ${sharedMarkers.join(', ')}.`);
  }
  if (longTail) {
    parts.push(
      `Long-tail pick: uniqueness ${rarity.coefficient * 100}% ` +
        `(${rarity.tier}) — rare in the Qloo sample.`
    );
  }
  if (specific) {
    parts.push(
      `Specificity: the correlation outpaces the target's fame by ` +
        `${excessPoints} points — a confirmed non-obvious link.`
    );
  }
  if (confidence === NOTE_CONFIDENCE.DATA_ONLY) {
    parts.push(
      'Mechanism unverified: Qloo reports the correlation; the ' +
        'dossier does not invent a cause.'
    );
  }

  return Object.freeze({
    evidence: Object.freeze({
      sourceName,
      sourceDomain,
      targetName,
      targetDomain,
      bridge,
      percent,
      sharedMarkers: Object.freeze([...sharedMarkers]),
      excess,
      excessPoints,
      rarity: Object.freeze({
        coefficient: rarity.coefficient,
        tier: rarity.tier,
      }),
      longTail,
      specific,
    }),
    note: parts.join(' '),
    confidence,
  });
}

/**
 * Annotates a batch of connections (order-preserving).
 *
 * @returns {Readonly<{entries, stats}>} frozen: entries carry
 *          {...connection, note, evidence, confidence}; stats
 *          {count, backed, dataOnly, meanPercent} (percent over
 *          measured entries, null when none).
 */
export function annotateConnections(connections, options = {}) {
  const list = Array.isArray(connections)
    ? connections.filter((c) => c && typeof c === 'object')
    : [];

  const entries = [];
  let backed = 0;
  let measured = 0;
  let percentSum = 0;

  for (const connection of list) {
    const explained = explainConnection(connection, options);
    if (explained.confidence === NOTE_CONFIDENCE.EVIDENCE_BACKED) backed += 1;
    if (explained.evidence.percent !== null) {
      measured += 1;
      percentSum += explained.evidence.percent;
    }
    entries.push(
      Object.freeze({
        ...connection,
        note: explained.note,
        evidence: explained.evidence,
        confidence: explained.confidence,
      })
    );
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    stats: Object.freeze({
      count: list.length,
      backed,
      dataOnly: list.length - backed,
      meanPercent: measured > 0 ? Math.round((percentSum / measured) * 10) / 10 : null,
    }),
  });
}

const connectionNotes = {
  explainConnection,
  annotateConnections,
  NOTE_CONFIDENCE,
  NOTE_DEFAULTS,
};

export default connectionNotes;

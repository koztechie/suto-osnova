/**
 * ProvenanceTable (task 106) — the DATA SOURCES table: every entity
 * the dossier surfaced, WITH ITS DIRECT QLOO IDENTIFIER, so a
 * reviewer can verify each pick against the Qloo database and
 * confirm the absence of LLM hallucinations (PRD user story 3).
 *
 * THE VERIFIABILITY RULE: a Qloo ENTITY is addressable by a UUID
 * (live-verified contract: entity ids are UUIDs, hex only). Tags and
 * places carry `urn:` ids and are NOT entity references — so the
 * collector ONLY records an object when it has BOTH a string `name`
 * AND a UUID-shaped `id`. An entity the dossier names but cannot
 * attach a UUID to (a curation/audience row that survived with only
 * a name) is listed as `unverified` — honestly reported, never
 * given a fabricated id.
 *
 * COLLECTION: the anchor (bundle.entity) plus a bounded scan of the
 * payload sections (ranked, layers, curation, audience, antithesis,
 * resonance, foodZones, afterparty, connections, graph, tonality,
 * weights). A second pass recovers NAME-ONLY references (curation
 * picks, audience rows) by joining to an already-collected UUID by
 * name, or marks them unverified. One row per distinct entity name;
 * the `sources` set records every bundle section that surfaced it.
 *
 * The table is FULL by default (no cap) — "full verifiability" is
 * the point. Pure module: no I/O, no clocks, no RNG.
 *
 * Surfaces: buildProvenanceTable(bundle) -> the frozen table;
 * renderProvenanceTable(table) -> the plain-text body;
 * renderProvenanceTableHtml(table) -> the semantic <table> (all
 * values escaped). Pinned by server/test/provenanceTable.test.js.
 */

/** Module version. */
export const PROVENANCE_VERSION = 1;

/** A Qloo entity id is a UUID (hex only); urn: tags/places are not. */
export const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The payload sections scanned for entity references. */
export const SCAN_KEYS = Object.freeze([
  'ranked', 'layers', 'curation', 'audience', 'antithesis', 'resonance',
  'foodZones', 'afterparty', 'connections', 'graph', 'tonality', 'weights',
]);

/** Name-only reference lists (recovered by name, or unverified). */
const nameOnlyLists = (bundle) => [
  ...(Array.isArray(bundle.curation?.openingActs)
    ? bundle.curation.openingActs.map((r) => ({ row: r, source: 'curation' })) : []),
  ...(Array.isArray(bundle.curation?.sponsors)
    ? bundle.curation.sponsors.map((r) => ({ row: r, source: 'curation' })) : []),
  ...(Array.isArray(bundle.curation?.vendors)
    ? bundle.curation.vendors.map((r) => ({ row: r, source: 'curation' })) : []),
  ...(Array.isArray(bundle.audience?.top)
    ? bundle.audience.top.map((r) => ({ row: r, source: 'audience' })) : []),
];

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Build the DATA SOURCES table for a mode bundle.
 *
 * @param {object} bundle a frozen mode result.
 * @returns {Readonly<object>} { version, entities, stats, summary }.
 */
export function buildProvenanceTable(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('buildProvenanceTable: bundle must be an object');
  }
  const entities = new Map(); // name -> record
  const add = (id, name, domain, source) => {
    if (typeof name !== 'string' || name.length === 0) return;
    let record = entities.get(name);
    if (!record) {
      record = { name, id: null, domain: null, sources: new Set() };
      entities.set(name, record);
    }
    if (record.id === null && typeof id === 'string' && ENTITY_ID.test(id)) {
      record.id = id;
    }
    if (record.domain === null && typeof domain === 'string' && domain !== '') {
      record.domain = domain;
    }
    record.sources.add(source);
  };

  // The anchor.
  const anchor = bundle.entity;
  if (anchor && typeof anchor === 'object') {
    add(anchor.id, anchor.name, anchor.category ?? null, 'anchor');
  }
  // Bounded recursive scan of the payload sections (UUID guard keeps
  // urn: tags/places out — only real entities are collected).
  const scan = (value, source) => {
    if (Array.isArray(value)) { for (const item of value) scan(item, source); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && ENTITY_ID.test(value.id)
      && typeof value.name === 'string') {
      add(value.id, value.name, value.domain ?? value.category ?? null, source);
    }
    for (const child of Object.values(value)) scan(child, source);
  };
  for (const key of SCAN_KEYS) {
    if (bundle[key] !== undefined) scan(bundle[key], key);
  }
  // Name-only references: recover the UUID by name, else unverified.
  for (const { row, source } of nameOnlyLists(bundle)) {
    add(null, row?.name, row?.domain ?? null, source);
  }

  const list = [...entities.values()]
    .map((record) => Object.freeze({
      name: record.name,
      id: record.id,
      domain: record.domain,
      verifiable: record.id !== null,
      sources: Object.freeze([...record.sources].sort()),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const verified = list.filter((row) => row.verifiable).length;

  return Object.freeze({
    version: PROVENANCE_VERSION,
    entities: Object.freeze(list),
    stats: Object.freeze({
      total: list.length,
      verified,
      unverified: list.length - verified,
    }),
    summary: list.length > 0
      ? `DATA SOURCES: ${list.length} entity reference(s), ${verified} verified against Qloo.`
      : 'DATA SOURCES: none — no entity reference carried a Qloo id.',
  });
}

/** The plain-text table body (one source of truth for the section). */
export function renderProvenanceTable(table) {
  if (!table || typeof table !== 'object' || !Array.isArray(table.entities)) {
    throw new TypeError('renderProvenanceTable: expected a buildProvenanceTable() table');
  }
  const lines = [table.summary];
  for (const row of table.entities) {
    lines.push(
      `   - ${row.name} | ${row.id ?? '(no qloo id)'} | ${row.domain ?? 'unknown'}` +
        ` | ${row.sources.join(', ')}${row.verifiable ? '' : ' [unverified]'}`
    );
  }
  return lines.join('\n');
}

/** The semantic <table> fragment for the print template (escaped). */
export function renderProvenanceTableHtml(table) {
  if (!table || typeof table !== 'object' || !Array.isArray(table.entities)) {
    throw new TypeError('renderProvenanceTableHtml: expected a buildProvenanceTable() table');
  }
  const out = [
    `<p class="sources-summary">${esc(table.summary)}</p>`,
    '<table class="sources">',
    '<thead><tr><th>Entity</th><th>Qloo ID</th><th>Domain</th><th>Source</th></tr></thead>',
    '<tbody>',
  ];
  for (const row of table.entities) {
    out.push(
      `<tr><td>${esc(row.name)}</td>` +
        `<td${row.verifiable ? '' : ' class="unverified"'}>${esc(row.id ?? '(no qloo id)')}</td>` +
        `<td>${esc(row.domain ?? 'unknown')}</td>` +
        `<td>${esc(row.sources.join(', '))}</td></tr>`
    );
  }
  out.push('</tbody>', '</table>');
  return out.join('\n');
}

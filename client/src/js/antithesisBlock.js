/**
 * SUTO OSNOVA — the Cultural Antipode block (task 145).
 * A SPECIAL display block for the Taste Antithesis data, accented with
 * the palette's OXIDE token (--rust — the frozen oxide value; the
 * exact mapping is pinned by tests/antithesisBlock.test.js).
 *
 * Data contract (the real JSON envelope): dossier.data.antithesis =
 * {matrix: [{domain, count, entries}], conflictDrivers, ...} — every
 * matrix entry carries {name, divergencePercent, ...} (the backend's
 * TasteInverter measured the divergence; percent already 0-100). The
 * block DISPLAYS what the backend measured; it never re-derives. An
 * entry without a finite percent or a name is honestly skipped; a
 * domain with NO surviving entries stays visible with "no measured
 * antipode" — mirroring the server contract that empty domains remain
 * visible (count 0), never silently dropped.
 *
 * Presentation contracts:
 *   - the OXIDE ACCENT: the block rule, the title and the divergence
 *     percentages use var(--rust) — which RESOLVES to the exact
 *     frozen oxide value through the token chain (pinned by the
 *     gate); rust on the slate panel clears WCAG AA for normal text
 *     (the pinned error-channel precedent in tests/contrast.test.js);
 *   - NEVER COLOUR-ONLY: each divergence is TEXT in a role="meter"
 *     span with aria-valuenow/min/max;
 *   - the block hides itself when the envelope carries no antithesis
 *     data (Modes 1/2 outputs);
 *   - renders via createElement/textContent only; import-safe in Node.
 */

/** Pure: extract the per-domain antipode data, or null when absent. */
export function extractAntithesis(payload) {
  const block = payload?.dossier?.data?.antithesis;
  if (!block || !Array.isArray(block.matrix)) return null;
  const domains = [];
  for (const zone of block.matrix) {
    if (!zone || typeof zone.domain !== 'string') continue;
    const entries = [];
    for (const entry of (Array.isArray(zone.entries) ? zone.entries : [])) {
      if (!entry || typeof entry !== 'object') continue;
      const name = typeof entry.name === 'string' && entry.name.trim() !== ''
        ? entry.name
        : null;
      const percent = entry.divergencePercent;
      if (!name || !Number.isFinite(percent)) continue;
      entries.push({ name, percent: Math.min(100, Math.max(0, percent)) });
    }
    domains.push({ domain: zone.domain, entries });
  }
  return domains.length > 0 ? { domains } : null;
}

/** Render the oxide-accented block (hidden without data). */
export function renderAntithesisBlock(container, data, doc) {
  container.textContent = '';
  if (!data) {
    container.hidden = true;
    return;
  }

  const title = doc.createElement('span');
  title.className = 'antithesis-title';
  title.textContent = 'Cultural Antipode';
  container.appendChild(title);

  for (const zone of data.domains) {
    const label = doc.createElement('span');
    label.className = 'antithesis-domain';
    label.textContent = zone.domain;
    container.appendChild(label);

    if (zone.entries.length === 0) {
      const empty = doc.createElement('span');
      empty.className = 'antithesis-empty';
      empty.textContent = 'no measured antipode';
      container.appendChild(empty);
      continue;
    }

    for (const { name, percent } of zone.entries) {
      const row = doc.createElement('div');
      row.className = 'antithesis-row';

      const antipode = doc.createElement('span');
      antipode.className = 'antithesis-name';
      antipode.textContent = name;

      const value = doc.createElement('span');
      value.className = 'antithesis-divergence';
      value.setAttribute('role', 'meter');
      value.setAttribute('aria-valuemin', '0');
      value.setAttribute('aria-valuemax', '100');
      value.setAttribute('aria-valuenow', String(Math.round(percent)));
      value.setAttribute('aria-label', `Divergence: ${Math.round(percent)}%`);
      value.textContent = `${percent}%`; // the MEASURED value, verbatim

      row.appendChild(antipode);
      row.appendChild(value);
      container.appendChild(row);
    }
  }

  container.hidden = false;
}

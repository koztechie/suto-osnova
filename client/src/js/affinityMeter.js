/**
 * SUTO OSNOVA — affinity strength widget (task 144).
 * MONOCHROME DISCRETE progress bars with a percentage value, showing
 * the connection strength the backend measured for the ranked picks.
 *
 * Data contract (the real JSON envelope): every entry of
 * dossier.data.ranked carries {name, connection: {score, percent,
 * scale}} — `percent` is ALREADY normalized 0-100 by the server's
 * ScoreNormalizer. The widget DISPLAYS what the backend measured; it
 * never re-derives or invents a value. Unmeasured entries (percent
 * null) and nameless entries are honestly SKIPPED.
 *
 * Presentation contracts:
 *   - MONOCHROME: one accent hue (the lifted gold) for filled cells
 *     over the neutral muted empties — no red/green traffic-light
 *     semantics anywhere;
 *   - DISCRETE: exactly AFFINITY_CELLS blocks per bar (10% steps),
 *     pure CSS cells (no glyph tricks);
 *   - NEVER COLOUR-ONLY: the percentage is TEXT in a role="meter"
 *     element carrying aria-valuenow/min/max — screen readers get the
 *     number, sighted users get bar AND number;
 *   - the widget hides itself when there is nothing to measure;
 *   - renders via createElement/textContent only; import-safe in Node.
 */

/** How many discrete cells a bar holds (10% steps). */
export const AFFINITY_CELLS = 10;

/** Pure: a 0-100 percent -> a filled-cell count (clamped, discrete). */
export function affinityCells(percent, cells = AFFINITY_CELLS) {
  if (!Number.isFinite(percent)) return 0;
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.round((clamped / 100) * cells);
}

/** Pure: extract [{label, percent}] from the REAL dossier contract. */
export function extractAffinities(payload) {
  const ranked = payload?.dossier?.data?.ranked;
  if (!Array.isArray(ranked)) return [];
  const out = [];
  for (const entry of ranked) {
    if (!entry || typeof entry !== 'object') continue;
    const label = typeof entry.name === 'string' && entry.name.trim() !== ''
      ? entry.name
      : (typeof entry.entity?.name === 'string' ? entry.entity.name : null);
    const percent = entry.connection?.percent;
    if (!label || !Number.isFinite(percent)) continue;
    out.push({ label, percent: Math.min(100, Math.max(0, percent)) });
  }
  return out;
}

/** Render the meter rows into a container (hidden when empty). */
export function renderAffinityWidget(container, entries, doc) {
  container.textContent = '';
  for (const { label, percent } of entries) {
    const row = doc.createElement('div');
    row.className = 'affinity-row';

    const name = doc.createElement('span');
    name.className = 'affinity-label';
    name.textContent = label;

    const bar = doc.createElement('span');
    bar.className = 'affinity-bar';
    bar.setAttribute('aria-hidden', 'true');
    const filled = affinityCells(percent);
    for (let index = 0; index < AFFINITY_CELLS; index += 1) {
      const cell = doc.createElement('span');
      cell.className = index < filled
        ? 'affinity-cell affinity-cell-filled'
        : 'affinity-cell';
      bar.appendChild(cell);
    }

    const value = doc.createElement('span');
    value.className = 'affinity-value';
    value.setAttribute('role', 'meter');
    value.setAttribute('aria-valuemin', '0');
    value.setAttribute('aria-valuemax', '100');
    value.setAttribute('aria-valuenow', String(Math.round(percent)));
    value.setAttribute('aria-label', `Affinity: ${Math.round(percent)}%`);
    value.textContent = `${Math.round(percent)}%`;

    row.appendChild(name);
    row.appendChild(bar);
    row.appendChild(value);
    container.appendChild(row);
  }
  container.hidden = entries.length === 0;
}

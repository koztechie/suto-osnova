/**
 * HtmlPrintFormatter (task 104) — the PRINT-READY HTML layout of the
 * dossier, built for browser PDF export (window.print() -> Save as
 * PDF, or a served route the user prints).
 *
 * THREE HARD DISCIPLINES:
 *   1. ARCHIVAL IRON PALETTE (AGENTS.md): the stylesheet uses ONLY
 *      the six sanctioned hex codes (via custom properties) — no
 *      other color value may appear, in screen or print. The print
 *      rule sets `print-color-adjust: exact` so the dark archival
 *      theme survives into the PDF (browsers otherwise drop
 *      backgrounds).
 *   2. OUTPUT ENCODING SAFETY (XSS): every dynamic string — the
 *      title, the anchor line, section titles and BODIES (Qloo
 *      entity names, LLM narrative) — is HTML-escaped. The content
 *      is UNTRUSTED; this document is served over the API, so an
 *      entity named `<script>...` must never execute.
 *   3. SEMANTIC + PAGINATION: H1/H2 hierarchy, <section> per block,
 *      <ul>/<li> for the list bodies, `@page A4` + `break-inside:
 *      avoid` so sections do not split across PDF pages.
 *
 * The section CONTENT is the existing plain-text render* output
 * (one source of truth, reused verbatim and escaped); this module
 * owns only the HTML/CSS shell. Deterministic: no clocks, no RNG.
 *
 * Surfaces: exportHtml(dossierOrBundle, options) -> the HTML
 * document; bodyToHtml(body) (the escaped body converter);
 * ARCHIVAL_CSS (the exported palette-locked stylesheet). Pinned by
 * server/test/htmlPrintFormatter.test.js.
 */

import { formatDossier } from './DossierFormatter.js';

/** Module version. */
export const HTML_EXPORTER_VERSION = 1;

/** The six sanctioned hex codes (AGENTS.md — nothing else). */
export const PALETTE = Object.freeze({
  bg: '#101114', surface: '#1F2326', muted: '#96A2A8',
  gold: '#D4A853', rust: '#E06338', text: '#F4EFE6',
});

/**
 * The palette-locked stylesheet (exported): ONLY the six hex codes,
 * `@page A4`, and print rules that keep sections whole across pages.
 */
export const ARCHIVAL_CSS = `
:root {
  --bg: ${PALETTE.bg};
  --surface: ${PALETTE.surface};
  --muted: ${PALETTE.muted};
  --gold: ${PALETTE.gold};
  --rust: ${PALETTE.rust};
  --text: ${PALETTE.text};
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}
.dossier { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem; }
header h1 { color: var(--gold); font-size: 1.6rem; margin: 0 0 0.25rem; }
.anchor { color: var(--muted); font-size: 0.85rem; margin: 0; }
section { margin: 1.75rem 0; }
section h2 {
  color: var(--gold);
  font-size: 1.05rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--surface);
  padding-bottom: 0.35rem;
}
.body { background: var(--surface); border-radius: 6px; padding: 1rem 1.1rem; }
.body p { margin: 0.35rem 0; }
.body strong { color: var(--gold); }
.body ul { margin: 0.4rem 0; padding-left: 1.1rem; }
.body li { margin: 0.15rem 0; }
.body li::marker { color: var(--rust); }
footer {
  color: var(--muted);
  font-size: 0.8rem;
  border-top: 1px solid var(--surface);
  padding-top: 0.75rem;
  margin-top: 2rem;
}
@page { size: A4; margin: 16mm 14mm; }
@media print {
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .dossier { padding: 0; max-width: none; }
  section { break-inside: avoid; page-break-inside: avoid; }
  section h2 { break-after: avoid; page-break-after: avoid; }
}
`.trim();

/** HTML-escape an UNTRUSTED string (& first, then the rest). */
export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * Convert one plain-text section body into escaped, semantic HTML:
 * bullets -> <ul>/<li>, the ALL-CAPS lead label -> <strong>, every
 * other line -> <p>. Content is escaped, never interpreted.
 */
export function bodyToHtml(body) {
  const lines = String(body ?? '').split('\n');
  const out = [];
  let inList = false;
  let leadDone = false;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const trimmed = line.trim();
    if (!leadDone) {
      leadDone = true;
      const lead = trimmed.match(/^([A-Z][A-Z0-9 &/()'.-]+?)(:| —)(\s*.*)$/);
      if (lead) {
        out.push(
          `<p class="lead"><strong>${escapeHtml(lead[1] + lead[2])}</strong>` +
            `${escapeHtml(lead[3])}</p>`
        );
        continue;
      }
    }
    out.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

const isDossierResult = (value) =>
  typeof value?.title === 'string' && Array.isArray(value?.sections);

/**
 * Export a dossier (or a mode bundle) as a print-ready, PDF-capable
 * HTML document.
 *
 * @param {object} dossierOrBundle a formatDossier() result or a
 *        mode bundle.
 * @returns {string} the complete HTML document.
 */
export function exportHtml(dossierOrBundle) {
  const dossier = isDossierResult(dossierOrBundle)
    ? dossierOrBundle
    : (dossierOrBundle && typeof dossierOrBundle.mode === 'string'
      ? formatDossier(dossierOrBundle)
      : null);
  if (dossier === null) {
    throw new TypeError('exportHtml: expected a dossier result or a mode bundle');
  }
  if (typeof dossier.title !== 'string' || !Array.isArray(dossier.sections)) {
    throw new TypeError('exportHtml: the resolved dossier lacks a title/sections');
  }

  const stats = dossier.stats ?? {};
  const footerText =
    `${stats.sections ?? dossier.sections.length} section(s)` +
    `${stats.unavailable ? `, ${stats.unavailable} unavailable` : ''}`;

  const parts = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(dossier.title)}</title>`,
    '<style>',
    ARCHIVAL_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<article class="dossier">',
    '<header>',
    `<h1>${escapeHtml(dossier.title)}</h1>`,
    ...(dossier.subtitle
      ? [`<p class="anchor">${escapeHtml(dossier.subtitle)}</p>`] : []),
    '</header>',
  ];
  for (const section of dossier.sections) {
    parts.push(
      '<section>',
      `<h2>${escapeHtml(section.title)}</h2>`,
      `<div class="body">\n${bodyToHtml(section.body)}\n</div>`,
      '</section>'
    );
  }
  parts.push(`<footer>${escapeHtml(footerText)}</footer>`);
  parts.push('</article>', '</body>', '</html>');
  return `${parts.join('\n')}\n`;
}

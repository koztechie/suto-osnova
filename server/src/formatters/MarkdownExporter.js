/**
 * MarkdownExporter (task 102) — SEMANTIC MARKDOWN export of the
 * generated dossier (the task-101 unified document).
 *
 * WHAT IT CONVERTS: the plain-text section bodies come from the
 * EXISTING render* functions (one source of truth for CONTENT — no
 * prose is re-implemented here); this exporter owns the MARKUP layer
 * and upgrades the ASCII layout to clean, semantic Markdown:
 *   - the dossier title -> an H1 (`#`), the anchor/request line ->
 *     a blockquote (`>`);
 *   - the 60-char ASCII rule -> a Markdown horizontal rule (`---`);
 *   - each section title -> an H2 (`##`);
 *   - an ALL-CAPS lead label -> bold (`**LABEL:** rest`);
 *   - `   - ` / `      - ` bullets -> real Markdown list items with
 *     ONE preserved nesting level (indent >= 6 -> `  - `), so
 *     zone/domain sub-entries stay structured.
 *
 * SAFETY DISCIPLINE (no prose mangling): only ALL-CAPS lead labels
 * are bolded (free narrative text never matches that shape, so the
 * `narrative` section passes through verbatim); only bullet lines
 * are re-indented. Everything else is emitted as-is — the exporter
 * never rewrites content, it only marks it up.
 *
 * An optional YAML FRONT MATTER (`options.frontMatter`) emits
 * `mode` / `output` for static-site and MCP consumers. The input is
 * EITHER a formatDossier() result (has `sections` + `title`) or a
 * mode bundle (has `mode`) — the latter is formatted first.
 *
 * DETERMINISTIC: no clocks, no RNG, a fixed transform. Surfaces:
 * exportMarkdown(dossierOrBundle, options) -> the Markdown string;
 * markdownFromBundle(bundle, options) (the explicit one-call form).
 * Pinned by server/test/markdownExporter.test.js.
 */

import { formatDossier } from './DossierFormatter.js';

/** Module version. */
export const MARKDOWN_EXPORTER_VERSION = 1;

/** The single preserved nesting indent for Markdown list items. */
const NEST_INDENT = '  ';

const isDossierResult = (value) =>
  typeof value?.title === 'string' && Array.isArray(value?.sections);

/**
 * Normalize one plain-text section body into Markdown: bold an
 * ALL-CAPS lead label, convert `   - ` bullets into real list items
 * (one nesting level preserved: top-level at column 0, nested at 2
 * spaces — never 4, which CommonMark reads as a code block), pass
 * everything else through.
 */
export function bodyToMarkdown(body) {
  const lines = String(body ?? '').split('\n');
  const out = [];
  let leadDone = false;
  for (const line of lines) {
    if (line.trim() === '') { out.push(''); continue; }
    const indent = line.length - line.trimStart().length;
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      out.push(`${indent >= 6 ? NEST_INDENT : ''}- ${bullet[1]}`);
      continue;
    }
    const trimmed = line.trim();
    if (!leadDone) {
      leadDone = true;
      // Safe heuristic: ONLY an ALL-CAPS lead label is bolded; free
      // narrative prose never matches this shape.
      const lead = trimmed.match(/^([A-Z][A-Z0-9 &/()'.-]+?)(:| —)(\s*.*)$/);
      if (lead) { out.push(`**${lead[1]}${lead[2]}**${lead[3]}`); continue; }
    }
    out.push(trimmed);
  }
  return out.join('\n').replace(/\s+$/gm, '').trim();
}

/**
 * Export a dossier (or a mode bundle) as semantic Markdown.
 *
 * @param {object} dossierOrBundle a formatDossier() result or a
 *        mode bundle.
 * @param {object} [options] { frontMatter } (default false).
 * @returns {string} the Markdown document.
 */
export function exportMarkdown(dossierOrBundle, options = {}) {
  if (!dossierOrBundle || typeof dossierOrBundle !== 'object') {
    throw new TypeError('exportMarkdown: expected a dossier result or a mode bundle');
  }
  const dossier = isDossierResult(dossierOrBundle)
    ? dossierOrBundle
    : (typeof dossierOrBundle.mode === 'string'
      ? formatDossier(dossierOrBundle)
      : null);
  if (dossier === null) {
    throw new TypeError('exportMarkdown: expected a dossier result or a mode bundle');
  }
  if (typeof dossier.title !== 'string' || !Array.isArray(dossier.sections)) {
    throw new TypeError('exportMarkdown: the resolved dossier lacks a title/sections');
  }

  const parts = [];
  if (options.frontMatter === true) {
    parts.push('---', `mode: ${dossier.mode}`, `output: ${dossier.output ?? 'null'}`, '---');
  }
  parts.push(`# ${dossier.title}`);
  if (typeof dossier.subtitle === 'string' && dossier.subtitle.length > 0) {
    parts.push(`> ${dossier.subtitle}`);
  }
  for (const section of dossier.sections) {
    parts.push('---', `## ${section.title}`, bodyToMarkdown(section.body));
  }
  const stats = dossier.stats ?? null;
  parts.push('---');
  parts.push(
    `**FOOTER** — ${stats?.sections ?? dossier.sections.length} section(s)` +
      `${stats?.unavailable ? `, ${stats.unavailable} unavailable` : ''}`
  );
  return `${parts.join('\n')}\n`;
}

/** The explicit one-call form: format the bundle, then export. */
export function markdownFromBundle(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || typeof bundle.mode !== 'string') {
    throw new TypeError('markdownFromBundle: bundle must carry a string `mode`');
  }
  return exportMarkdown(formatDossier(bundle), options);
}

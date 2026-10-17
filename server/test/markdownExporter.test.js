/**
 * MarkdownExporter gate (task 102) — semantic Markdown export:
 *   - the document scaffolding (H1 title, blockquote anchor, `---`
 *     rules, H2 section headings, the footer);
 *   - the body normalization (ALL-CAPS lead -> bold; `   - ` ->
 *     `- `; `      - ` -> `  - ` nested — never a 4-space code
 *     block); narrative prose passes through VERBATIM;
 *   - the front-matter option; the bundle-accepting convenience;
 *   - the TypeError matrix, determinism, zero emojis, no trailing
 *     whitespace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'markdown-exporter-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  exportMarkdown, markdownFromBundle, bodyToMarkdown,
} = await import('../src/formatters/MarkdownExporter.js');
const { formatDossier } = await import('../src/formatters/DossierFormatter.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const shared = () => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: tagsStub,
  synthesis: false,
});

test('document scaffolding: H1, blockquote anchor, rules, H2 sections, footer', async () => {
  const bundle = await runWorldbuilder('Static Ash Live', shared());
  const md = markdownFromBundle(bundle);

  assert.match(md, /^# DOSSIER — Worldbuilder \(Character & Scene Dossier\)$/m);
  assert.match(md, /^> ANCHOR: Midsommar \(film\)  \|  REQUEST: wb-/m,
    'the anchor line carries the RESOLVED entity + the request id');
  assert.match(md, /^## TOP AFFINITIES$/m);
  assert.match(md, /^---$/m, 'Markdown horizontal rules separate the sections');
  assert.match(md, /\*\*FOOTER\*\* — \d+ section\(s\)/, 'the footer is a bold label');
  assert.ok(md.endsWith('\n'), 'the document ends with a newline');
  assert.ok(!/={4,}/.test(md), 'the 60-char ASCII rule is replaced by ---');
  for (const line of md.split('\n')) {
    assert.ok(!/\s$/.test(line), `no trailing whitespace: "${line}"`);
  }
  assert.ok(!/\p{Extended_Pictographic}/u.test(md), 'zero emojis');
});

test('body normalization: bold lead, top-level and nested bullets', () => {
  const body = [
    'F&B ZONE MAP — Static Ash Live (music)',
    '1 F&B zone(s) with 1 stall(s) around Berlin.',
    '   [cafe] Cafe Court — 1 stall(s)',
    '      - Basilica Coffee (90% affinity), audience-tested',
    '   - Iron Skillet (80% affinity)',
    'BEVERAGE DIRECTION: Coffee',
  ].join('\n');
  const md = bodyToMarkdown(body);
  const lines = md.split('\n');

  assert.equal(lines[0], '**F&B ZONE MAP —** Static Ash Live (music)',
    'the ALL-CAPS lead label is bolded');
  assert.equal(lines[1], '1 F&B zone(s) with 1 stall(s) around Berlin.',
    'prose passes through verbatim');
  assert.equal(lines[3], '  - Basilica Coffee (90% affinity), audience-tested',
    'a 6-space bullet nests at 2 spaces');
  assert.equal(lines[4], '- Iron Skillet (80% affinity)',
    'a 3-space bullet becomes a top-level item at column 0');
  assert.ok(!lines.some((l) => l.startsWith('    - ')),
    'never 4 spaces — that would be a CommonMark code block');
});

test('narrative prose is never mangled', () => {
  const prose = 'Static Ash Live was a movement rooted in the industrial north.\nIt began in 1979 and rejected polish.';
  assert.equal(bodyToMarkdown(prose), prose,
    'free prose (with colons/case) passes through unchanged');
});

test('front matter and the bundle-accepting convenience', async () => {
  const activation = await runExperiential('Static Ash Live', shared());
  const withFm = markdownFromBundle(activation, { frontMatter: true });
  assert.match(withFm, /^---\nmode: activation\noutput: activation_curation\n---\n/m,
    'YAML front matter for static-site / MCP consumers');
  assert.match(withFm, /^## AUDIENCE INSIGHTS$/m);

  // exportMarkdown() accepts a bundle directly and matches the
  // explicit one-call form.
  assert.equal(exportMarkdown(activation), markdownFromBundle(activation));
});

test('the TypeError matrix', async () => {
  for (const bad of [null, {}, 42]) {
    assert.throws(() => exportMarkdown(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => exportMarkdown({ title: 'x' }), TypeError,
    'a title without sections is not a dossier');
  assert.throws(() => markdownFromBundle({}), TypeError, 'a bundle needs a mode');
  assert.throws(() => markdownFromBundle(null), TypeError);

  // A formatter result formats cleanly too.
  const bundle = await runWorldbuilder('Static Ash Live', shared());
  const dossier = formatDossier(bundle);
  assert.equal(exportMarkdown(dossier), markdownFromBundle(bundle));
});

test('determinism', async () => {
  const bundle = await runWorldbuilder('Static Ash Live', shared());
  assert.equal(markdownFromBundle(bundle), markdownFromBundle(bundle));
});

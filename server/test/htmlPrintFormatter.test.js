/**
 * HtmlPrintFormatter gate (task 104) — the print-ready HTML layout:
 *   - the ARCHIVAL IRON PALETTE gate (every hex code in the document
 *     is one of the six sanctioned values — nothing else, screen or
 *     print);
 *   - PDF readiness (@page A4, @media print, print-color-adjust
 *     exact, break-inside avoid);
 *   - OUTPUT ENCODING SAFETY (XSS): untrusted entity names / LLM
 *     prose are escaped, never executed;
 *   - the semantic body conversion (bullets -> <ul>/<li>, ALLCAPS
 *     lead -> <strong>, prose -> <p>);
 *   - the TypeError matrix, determinism, zero emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'html-print-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  exportHtml, bodyToHtml, escapeHtml, PALETTE, ARCHIVAL_CSS,
} = await import('../src/formatters/HtmlPrintFormatter.js');
const { formatDossier } = await import('../src/formatters/DossierFormatter.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const ALLOWED = new Set(Object.values(PALETTE).map((h) => h.toLowerCase()));
const hexes = (s) => (s.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase());

test('palette gate: only the six sanctioned hex codes, screen and print', async () => {
  const bundle = await runWorldbuilder('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  const html = exportHtml(bundle);

  const found = hexes(html);
  assert.ok(found.length >= 6, 'the palette custom properties are emitted');
  for (const h of found) {
    assert.ok(ALLOWED.has(h), `banned color in the document: ${h}`);
  }
  for (const [name, hex] of Object.entries(PALETTE)) {
    assert.ok(html.includes(`--${name}: ${hex};`), `the ${name} var is defined`);
  }
});

test('PDF readiness: @page A4, print rules, background kept, sections whole', async () => {
  const bundle = await runWorldbuilder('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  const html = exportHtml(bundle);

  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.trimEnd().endsWith('</html>'));
  assert.match(html, /@page \{ size: A4; margin: 16mm 14mm; \}/);
  assert.match(html, /@media print \{/);
  assert.match(html, /print-color-adjust: exact/, 'the dark theme survives into the PDF');
  assert.match(html, /break-inside: avoid/, 'sections do not split across pages');
  assert.match(html, /<title>DOSSIER — Worldbuilder \(Character &amp; Scene Dossier\)<\/title>/,
    'the title is escaped');
  assert.match(html, /<h1>DOSSIER — Worldbuilder \(Character &amp; Scene Dossier\)<\/h1>/);
  assert.match(html, /<h2>TOP AFFINITIES<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>/);
  assert.ok(!/<script/i.test(html), 'the template ships no scripts');
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'zero emojis');
});

test('output encoding safety: untrusted names and prose are escaped', () => {
  const html = exportHtml({
    mode: 'activation',
    entity: { id: 'e1', name: '<script>alert(1)</script>', category: 'film' },
    audience: { available: true, count: 1, top: [{ name: 'A<b>&"\'', affinityPercent: 80 }] },
  });

  assert.ok(!/<script/i.test(html), 'an entity named <script> never executes');
  assert.ok(html.includes('&lt;script&gt;'), 'the angle brackets are escaped');
  assert.ok(html.includes('&amp;'), 'the ampersand is escaped');
  assert.ok(html.includes('&quot;'), 'the double quote is escaped');
  assert.ok(html.includes('&#39;'), 'the single quote is escaped');
  assert.ok(html.includes('A&lt;b&gt;&amp;&quot;&#39;'), 'the body bullet is escaped');
  assert.equal(escapeHtml('<x>'), '&lt;x&gt;');
});

test('semantic body conversion', () => {
  const body = [
    'AUDIENCE INSIGHTS: 1 row(s)',
    'plain prose line',
    '   - Iron Atelier (90% affinity) [dual]',
    '      - Nested Vendor (70% affinity)',
    'CULINARY TRADITIONS: Street Food',
  ].join('\n');
  const html = bodyToHtml(body);
  const lines = html.split('\n');

  assert.equal(lines[0],
    '<p class="lead"><strong>AUDIENCE INSIGHTS:</strong> 1 row(s)</p>',
    'the ALL-CAPS lead label becomes a bold lead paragraph');
  assert.equal(lines[1], '<p>plain prose line</p>');
  assert.equal(lines[2], '<ul>');
  assert.equal(lines[3], '<li>Iron Atelier (90% affinity) [dual]</li>');
  assert.equal(lines[4], '<li>Nested Vendor (70% affinity)</li>',
    'any-indent bullets join the same semantic list');
  assert.equal(lines[5], '</ul>');
  assert.equal(lines[6], '<p>CULINARY TRADITIONS: Street Food</p>');
});

test('the TypeError matrix and determinism', async () => {
  for (const bad of [null, {}, 42]) {
    assert.throws(() => exportHtml(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => exportHtml({ title: 'x' }), TypeError,
    'a title without sections is not a dossier');

  const bundle = await runWorldbuilder('Static Ash Live', {
    affinityFn: affinityStub,
    search: searchStub,
    searchFn: async () => ({ results: [] }),
    tagsFn: tagsStub,
    synthesis: false,
  });
  assert.equal(exportHtml(bundle), exportHtml(bundle), 'deterministic');
  assert.equal(exportHtml(bundle), exportHtml(formatDossier(bundle)),
    'a bundle and its dossier result produce the same document');
});

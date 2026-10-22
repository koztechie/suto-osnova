/**
 * CSS inlining rules (Lighthouse: render-blocking stylesheet, ~300 ms
 * off the critical path) — pins scripts/lib/inlineStylesheet.mjs, the
 * pure transform scripts/buildClient.mjs applies to dist/index.html
 * after the Vite build. The integration half of the contract (the REAL
 * build emits an inlined page whose <style> is byte-identical to the
 * emitted /assets bundle) is pinned by tests/clientBuild.test.js.
 *
 * Every ambiguity must THROW: a silent mismatch would ship an UNSTYLED
 * production page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractStylesheetHref, inlineStylesheet } = await import(
  '../../scripts/lib/inlineStylesheet.mjs'
);

/** A faithful sample of Vite's built <head> (the real markup shape). */
const BUILT_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>SUTO OSNOVA</title>',
  '  <link rel="stylesheet" crossorigin href="/assets/style-Ci6y6RKH.css">',
  '</head>',
  '<body><script type="module" crossorigin src="/assets/index-B3qhjQ4L.js"></script></body>',
  '</html>',
  '',
].join('\n');

const MINIFIED_CSS = ':root{--bg:#101114;--gold:#D4A853}.site-header{display:flex}';

test('the single stylesheet link becomes an inline <style> block, everything else intact', () => {
  const out = inlineStylesheet(BUILT_HTML, MINIFIED_CSS);
  assert.ok(!out.includes('rel="stylesheet"'), 'no stylesheet link survives');
  assert.ok(
    out.includes(`<style>${MINIFIED_CSS}</style>`),
    'the CSS ships inline, byte-identical',
  );
  // Position preserved (still inside <head>, before </head>).
  assert.ok(
    out.indexOf('<style>') < out.indexOf('</head>'),
    'the inline block stays in the head',
  );
  // Nothing else touched.
  assert.ok(out.includes('<meta charset="utf-8">'), 'other head content untouched');
  assert.ok(out.includes('/assets/index-B3qhjQ4L.js'), 'the module script is untouched');
  assert.ok(out.startsWith('<!doctype html>'), 'the doctype is untouched');
});

test('attribute order does not matter (rel before or after href)', () => {
  const reordered = BUILT_HTML.replace(
    '<link rel="stylesheet" crossorigin href="/assets/style-Ci6y6RKH.css">',
    '<link href="/assets/style-Ci6y6RKH.css" rel="stylesheet" crossorigin>',
  );
  assert.equal(extractStylesheetHref(reordered), '/assets/style-Ci6y6RKH.css');
  assert.ok(inlineStylesheet(reordered, MINIFIED_CSS).includes('<style>'));
});

test('extractStylesheetHref returns the built asset path', () => {
  assert.equal(extractStylesheetHref(BUILT_HTML), '/assets/style-Ci6y6RKH.css');
});

test('zero stylesheet links throw (a markup drift must fail the build, not ship unstyled)', () => {
  const noLink = BUILT_HTML.replace(/<link rel="stylesheet"[^>]*>\n/, '');
  assert.throws(() => extractStylesheetHref(noLink), /exactly ONE .* found 0/);
  assert.throws(() => inlineStylesheet(noLink, MINIFIED_CSS), /exactly ONE .* found 0/);
});

test('more than one stylesheet link throws (ambiguous inline target)', () => {
  const twoLinks = BUILT_HTML.replace(
    '</head>',
    '  <link rel="stylesheet" crossorigin href="/assets/print-1.css">\n</head>',
  );
  assert.throws(() => extractStylesheetHref(twoLinks), /found 2/);
  assert.throws(() => inlineStylesheet(twoLinks, MINIFIED_CSS), /found 2/);
});

test('an href-less stylesheet link throws', () => {
  const noHref = BUILT_HTML.replace(' href="/assets/style-Ci6y6RKH.css"', '');
  assert.throws(() => extractStylesheetHref(noHref), /no href/);
});

test('empty CSS throws', () => {
  assert.throws(() => inlineStylesheet(BUILT_HTML, ''), /empty stylesheet/);
  assert.throws(() => inlineStylesheet(BUILT_HTML, '   \n '), /empty stylesheet/);
});

test('CSS containing "</style" throws (it would terminate the block early)', () => {
  const evil = ':root{--x:1}</style><script>alert(1)</script>';
  assert.throws(() => inlineStylesheet(BUILT_HTML, evil), /<\/style/);
});

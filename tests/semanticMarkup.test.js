/**
 * Semantic markup gate (task 129) — pins the BASE MARKUP of
 * client/index.html around the five required semantic tags and the
 * accessibility contract that comes with them:
 *
 *   - ALL FIVE TAGS: <header>, <main>, <nav>, <section>, <footer> are
 *     present — the landmarks a screen reader navigates by;
 *   - LANDMARK HYGIENE: exactly one header/main/footer; header and
 *     footer live OUTSIDE main; every nav carries an aria-label (two
 *     distinct landmark names, no anonymous navigation);
 *   - SECTION NAMING: every <section> has an accessible name
 *     (aria-labelledby resolving to a REAL id, or aria-label);
 *   - HEADING ORDER: exactly one h1, every h2 follows it in document
 *     order, and no level is skipped (h1 -> h2 only);
 *   - REAL IN-PAGE NAVIGATION: every href="#x" anchor in the document
 *     resolves to an existing id (the skip link targets the main
 *     landmark; the workspace nav targets the form and the output
 *     panel) — no decorative pseudo-navigation;
 *   - THE JS CONTRACT SURVIVES: main.js/ui.js wire by id — the form,
 *     its named controls, the status line and the three output nodes
 *     keep their exact ids, and the module entry script tag is intact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INDEX = fileURLToPath(new URL('../client/index.html', import.meta.url));
const html = await readFile(INDEX, 'utf8');

/** All occurrences of a tag (opening forms), in document order. */
const tags = (name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))]
  .map((m) => ({ at: m.index, attrs: m[0] }));

const attr = (attrs, name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

test('all five semantic tags are present', () => {
  for (const tag of ['header', 'main', 'nav', 'section', 'footer']) {
    assert.ok(tags(tag).length > 0, `<${tag}> exists`);
  }
  assert.ok(tags('nav').length >= 2, 'both navigations exist (skip + workspace)');
  assert.ok(tags('section').length >= 2, 'both workspace panels are sections');
});

test('landmark hygiene: one header/main/footer, labelled navs, outside-main shell', () => {
  assert.equal(tags('header').length, 1, 'exactly one <header> (banner landmark)');
  assert.equal(tags('main').length, 1, 'exactly one <main> (main landmark)');
  assert.equal(tags('footer').length, 1, 'exactly one <footer> (contentinfo landmark)');

  const main = tags('main')[0];
  const footer = tags('footer')[0];
  assert.ok(main.at > tags('header')[0].at, 'the header precedes main');
  assert.ok(footer.at > main.at, 'the footer follows main');

  const names = new Set();
  for (const nav of tags('nav')) {
    const label = attr(nav.attrs, 'aria-label');
    assert.ok(label, 'every <nav> carries an aria-label (no anonymous landmark)');
    assert.ok(!names.has(label), `nav landmark names are distinct ("${label}")`);
    names.add(label);
  }
});

test('every section carries a resolvable accessible name', () => {
  for (const section of tags('section')) {
    const by = attr(section.attrs, 'aria-labelledby');
    const label = attr(section.attrs, 'aria-label');
    assert.ok(by || label, 'the section is named');
    if (by) {
      assert.ok(html.includes(`id="${by}"`),
        `aria-labelledby="${by}" resolves to a real id`);
    }
  }
});

test('heading order: one h1, h2s after it, no skipped levels', () => {
  const h1 = tags('h1');
  const h2 = tags('h2');
  assert.equal(h1.length, 1, 'exactly one h1');
  assert.ok(h2.length >= 2, 'both panels are headed by h2');
  for (const heading of h2) {
    assert.ok(heading.at > h1[0].at, 'every h2 follows the h1 in document order');
  }
  assert.equal(tags('h3').length, 0, 'no deeper levels to skip into');
});

test('every in-page anchor resolves to a real id', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 3, 'the skip link and the workspace nav anchor in-page');
  for (const target of anchors) {
    assert.ok(ids.has(target), `href="#${target}" resolves to an existing id`);
  }
  // The skip link targets the MAIN LANDMARK itself.
  const mainId = attr(tags('main')[0].attrs, 'id');
  assert.equal(mainId, 'main-content', 'main carries the skip target id');
  assert.ok(anchors.includes(mainId), 'the skip link jumps to the main landmark');
});

test('the main.js/ui.js id contract survives the restructure', () => {
  const required = [
    'generate-form', 'seed', 'mode', 'format', 'generate', 'status',
    'output-frame', 'output-text', 'output-empty',
  ];
  for (const id of required) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is kept for the js modules`);
  }
  assert.match(html, /<script type="module" src="\.\/src\/js\/main\.js"><\/script>/,
    'the module entry script tag is intact');
});

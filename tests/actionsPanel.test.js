/**
 * Actions panel gate (task 146) — pins the interactive actions:
 * Export Markdown / Download JSON / Print PDF Dossier.
 *
 *   - MARKUP: three buttons with the EXACT labels, all type="button"
 *     (they never submit), inside a labelled group; the PRINT FRAME
 *     exists hidden with sandbox="allow-modals" and WITHOUT
 *     allow-scripts — window.print works while server HTML can never
 *     execute code here (XSS-safe printing);
 *   - PURE FILENAMES: dossierFilename is deterministic and sanitised;
 *   - BEHAVIOUR (fakes): every action fetches the REAL document from
 *     the gateway in the needed format (the client never converts by
 *     itself); markdown saves a .md blob, json saves the pretty-printed
 *     envelope as .json, print feeds the HTML into the sandbox frame
 *     and prints on its load; an EMPTY anchor is a status error and
 *     never a request; a failed request reports and never throws;
 *     the object URL is revoked after the click;
 *   - WIRING + STYLE: main.js starts the panel with the ui status/busy
 *     callbacks; the chips follow the preset visual language; zero
 *     innerHTML anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { dossierFilename, saveText, printHtml, startActions } = await import(
  path.join(CLIENT, 'src', 'js', 'actions.js')
);

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'actions.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Fakes: buttons, form (seed input + mode radios), print frame, win. */
function fakeWorld(seed = 'A24 Psychological Horror', mode = 'worldbuilder') {
  const makeButton = () => ({
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    fire() { return this.listeners.get('click')?.(); },
  });
  const clicks = [];
  const win = {
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options?.type; } },
    URL: {
      createObjectURL: (blob) => { clicks.push({ blob }); return 'blob:fake-url'; },
      revokeObjectURL: (url) => { clicks.push({ revoked: url }); },
    },
  };
  // Memoised nodes: getElementById must return the SAME object per id
  // (the wiring and the test would otherwise hold different instances).
  const nodes = {
    'generate-form': { seed: { value: seed }, mode: { value: mode } },
    'print-frame': {
      srcdoc: '', onload: null,
      contentWindow: { print() { clicks.push({ printed: true }); } },
    },
    'action-markdown': makeButton(),
    'action-json': makeButton(),
    'action-print': makeButton(),
  };
  const doc = {
    body: { appendChild() {} },
    createElement: (tag) => ({
      tag, href: '', download: '',
      click() { clicks.push({ anchor: this.download }); },
      remove() {},
    }),
    getElementById: (id) => nodes[id] ?? null,
  };
  return { win, doc, clicks, docButtons: {
    markdown: nodes['action-markdown'],
    json: nodes['action-json'],
    print: nodes['action-print'],
  } };
}

test('markup: three never-submit buttons and a safe print frame', () => {
  const group = html.match(/<div class="actions" role="group" aria-label="Dossier actions">([\s\S]*?)\n\s*<\/div>/);
  assert.ok(group, 'the actions group exists');
  for (const [id, label] of [
    ['action-markdown', 'Export Markdown'],
    ['action-json', 'Download JSON'],
    ['action-print', 'Print PDF Dossier'],
  ]) {
    assert.match(group[1], new RegExp(`<button type="button" id="${id}" class="action">${label}</button>`),
      `the ${label} button is type=button with the exact label`);
  }
  const frame = html.match(/<iframe id="print-frame"[^>]*>/);
  assert.ok(frame, 'the print frame exists');
  assert.ok(frame[0].includes('hidden'), 'it is hidden at rest');
  assert.ok(frame[0].includes('sandbox="allow-modals"'),
    'printing is allowed (allow-modals)');
  assert.ok(!frame[0].includes('allow-scripts'),
    'scripts stay BLOCKED — server HTML can never execute here');
});

test('dossierFilename: deterministic and sanitised', () => {
  assert.equal(dossierFilename('worldbuilder', 'markdown'), 'suto-osnova-worldbuilder-dossier.md');
  assert.equal(dossierFilename('experiential', 'json'), 'suto-osnova-experiential-dossier.json');
  assert.equal(dossierFilename('../evil', 'json'), 'suto-osnova-evil-dossier.json',
    'path characters are stripped');
  assert.equal(dossierFilename(null, 'markdown'), 'suto-osnova-unknown-dossier.md',
    'a missing mode degrades honestly');
  assert.equal(dossierFilename('x', 'html'), 'suto-osnova-x-dossier.txt',
    'an unknown format falls back to txt');
});

test('behaviour: real documents, safe print, honest errors', async () => {
  const { win, doc, clicks, docButtons } = fakeWorld();
  const requests = [];
  const statuses = [];
  const stop = startActions({
    doc,
    win,
    generateImpl: async (params) => {
      requests.push(params);
      if (params.format === 'markdown') return { kind: 'markdown', payload: '# Dossier' };
      if (params.format === 'json') return { kind: 'json', payload: { status: 'ok' } };
      return { kind: 'html', payload: '<!doctype html><p>Print</p>' };
    },
    onStatus: (message, tone) => statuses.push({ message, tone }),
    onBusy() {},
  });

  await docButtons.markdown.fire();
  assert.deepEqual(requests[0], { seed: 'A24 Psychological Horror', mode: 'worldbuilder', format: 'markdown' },
    'markdown export fetches the REAL markdown document');
  const md = clicks.find((c) => c.anchor);
  assert.equal(md.anchor, 'suto-osnova-worldbuilder-dossier.md', 'saved under the pinned filename');
  assert.ok(clicks.some((c) => c.blob?.type === 'text/markdown'), 'as a markdown blob');
  assert.ok(clicks.some((c) => c.revoked === 'blob:fake-url'), 'the object URL is revoked');

  await docButtons.json.fire();
  const jsonClick = clicks.filter((c) => c.anchor)[1];
  assert.equal(jsonClick.anchor, 'suto-osnova-worldbuilder-dossier.json');
  const jsonBlob = clicks.filter((c) => c.blob?.type === 'application/json').pop();
  assert.equal(jsonBlob.blob.parts[0], JSON.stringify({ status: 'ok' }, null, 2),
    'the downloaded JSON is the pretty-printed envelope');

  await docButtons.print.fire();
  const frame = doc.getElementById('print-frame');
  assert.equal(frame.srcdoc, '<!doctype html><p>Print</p>', 'the print HTML feeds the sandbox frame');
  assert.ok(!clicks.some((c) => c.printed), 'printing waits for the frame load');
  frame.onload();
  assert.ok(clicks.some((c) => c.printed), 'the load event triggers window.print');

  // An empty anchor: a status error and NO request.
  stop();
  const empty = fakeWorld('   ');
  const emptyRequests = [];
  const emptyStatuses = [];
  startActions({
    doc: empty.doc,
    win: empty.win,
    generateImpl: async (params) => { emptyRequests.push(params); return { kind: 'json', payload: {} }; },
    onStatus: (message, tone) => emptyStatuses.push({ message, tone }),
    onBusy() {},
  });
  await empty.docButtons.json.fire();
  assert.equal(emptyRequests.length, 0, 'no request without an anchor');
  assert.equal(emptyStatuses[0].tone, 'error', 'and the status says so');

  // A failed request reports and never throws.
  const failing = fakeWorld();
  const failStatuses = [];
  startActions({
    doc: failing.doc,
    win: failing.win,
    generateImpl: async () => { throw new Error('gateway down'); },
    onStatus: (message, tone) => failStatuses.push({ message, tone }),
    onBusy() {},
  });
  await failing.docButtons.markdown.fire();
  assert.equal(failStatuses[0].tone, 'error', 'the failure lands on the status line');
});

test('wiring and style: started on boot, preset chip language', () => {
  assert.match(main, /startActions\(\{/, 'main.js starts the panel');
  assert.match(main, /onStatus:[\s\S]*setStatus/, 'with the ui status callback');
  assert.match(main, /onBusy:[\s\S]*setBusy/, 'and the busy callback');

  const chip = mainCss.match(/\.action\s*\{[^}]*\}/)[0];
  assert.match(chip, /background:\s*var\(--bg-page\);/, 'chips sit on the inset bed');
  assert.match(chip, /color:\s*var\(--muted-hi\);/, 'with the lifted secondary label');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module never touches innerHTML');
});

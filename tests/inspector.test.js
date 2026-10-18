/**
 * Raw API Call Inspector gate (task 148) — pins the judges' modal:
 *
 *   - CALL LOG: createCallLog is a bounded FIFO (record/list/clear,
 *     entries frozen, list returns a copy); formatCallRow renders
 *     exact human rows; the module singleton is what api.js writes
 *     into at the transport edge (source-pinned);
 *   - EVIDENCE SLOTS: noteHealth stores the last SUCCESSFUL health
 *     report; noteEnvelope extracts the envelope's meta ledger;
 *     inspectorData assembles calls + qloo + transport + provenance
 *     with honest nulls;
 *   - BEHAVIOUR (fake DOM): the trigger opens the dialog (unhidden,
 *     focus to Close), Close/Escape/backdrop close it and focus
 *     RETURNS to the trigger; the three sections render RAW values
 *     (calls as rows, qloo/provenance as JSON text) with the honest
 *     "not recorded yet" / "no calls recorded yet" empty states;
 *   - MARKUP: a real dialog (role/aria-modal/aria-labelledby), hidden
 *     at rest, a labelled trigger in the titlebar, three named
 *     sections; the "never rewritten" note is pinned;
 *   - WIRING: connectivity feeds noteHealth, ui.renderJson feeds
 *     noteEnvelope, main.js starts the modal; zero innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const {
  createCallLog, formatCallRow, noteHealth, noteEnvelope, inspectorData,
} = await import(path.join(CLIENT, 'src', 'js', 'inspector.js'));

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const main = await readFile(path.join(CLIENT, 'src', 'js', 'main.js'), 'utf8');
const api = await readFile(path.join(CLIENT, 'src', 'js', 'api.js'), 'utf8');
const connectivity = await readFile(path.join(CLIENT, 'src', 'js', 'connectivity.js'), 'utf8');
const ui = await readFile(path.join(CLIENT, 'src', 'js', 'ui.js'), 'utf8');
const source = await readFile(path.join(CLIENT, 'src', 'js', 'inspector.js'), 'utf8');
const mainCss = (await readFile(path.join(CLIENT, 'src', 'css', 'main.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Memoised fake DOM for the modal. */
function fakeDom() {
  const make = (id) => {
    const attrs = new Map();
    return {
      id, hidden: id === 'inspector', textContent: '', focused: 0, listeners: new Map(),
      attrs,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      addEventListener(type, fn) { this.listeners.set(type, fn); },
      removeEventListener(type) { this.listeners.delete(type); },
      focus() { this.focused += 1; },
      fire(type, event = {}) { return this.listeners.get(type)?.(event); },
    };
  };
  const ids = [
    'inspector', 'open-inspector', 'inspector-close', 'inspector-backdrop',
    'inspector-calls', 'inspector-qloo', 'inspector-provenance',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, make(id)]));
  const doc = { getElementById: (id) => nodes[id] ?? null };
  const winListeners = new Map();
  const win = {
    listeners: winListeners,
    addEventListener(type, fn) { winListeners.set(type, fn); },
    removeEventListener(type) { winListeners.delete(type); },
    fire(type, event) { return winListeners.get(type)?.(event); },
  };
  return { doc, win, nodes };
}

test('the call log: bounded, frozen, copy-on-read', () => {
  const log = createCallLog(2);
  log.record({ method: 'GET', path: '/api/health', status: 200, ok: true, ms: 3 });
  log.record({ method: 'POST', path: '/api/generate/worldbuilder', status: 200, ok: true, ms: 40 });
  log.record({ method: 'GET', path: '/api/categories', status: 200, ok: true, ms: 2 });
  assert.equal(log.list().length, 2, 'the log is bounded (FIFO)');
  assert.equal(log.list()[0].path, '/api/generate/worldbuilder', 'the oldest entry dropped');
  const snapshot = log.list();
  snapshot.pop();
  assert.equal(log.list().length, 2, 'list() returns a copy, not the store');
  log.clear();
  assert.deepEqual(log.list(), [], 'clear() empties the log');
  log.record(null);
  assert.equal(log.list().length, 0, 'garbage never records');
});

test('formatCallRow: exact rows, honest fallback', () => {
  assert.equal(
    formatCallRow({ method: 'POST', path: '/api/generate/antithesis', status: 200, ms: 41.4 }),
    'POST /api/generate/antithesis -> 200 (41ms)',
  );
  assert.equal(
    formatCallRow({ method: 'GET', path: '/api/health', status: 0, ms: 0 }),
    'GET /api/health -> 0 (0ms)',
  );
  assert.equal(formatCallRow(null), 'unknown call');
  assert.equal(formatCallRow('nope'), 'unknown call');
});

test('evidence slots: the last health report and the meta ledger', () => {
  noteHealth(null);
  noteEnvelope(null);
  let data = inspectorData(createCallLog(5));
  assert.equal(data.qloo, null, 'no probe yet -> honest null');
  assert.equal(data.provenance, null, 'no dossier yet -> honest null');

  noteHealth({ status: 'ok', qloo: { reachable: true, mode: 'live' }, transport: { cache: { hits: 3 } } });
  noteEnvelope({ dossier: { meta: { resolution: { id: 'x' } }, data: {} } });
  data = inspectorData(createCallLog(5));
  assert.deepEqual(data.qloo, { reachable: true, mode: 'live' }, 'the raw qloo block stores');
  assert.deepEqual(data.transport, { cache: { hits: 3 } }, 'the transport block stores');
  assert.deepEqual(data.provenance, { resolution: { id: 'x' } }, 'the envelope META ledger stores');
});

test('behaviour: open/close via trigger, Escape and backdrop, focus restores', async () => {
  const { startInspector } = await import(path.join(CLIENT, 'src', 'js', 'inspector.js'));
  const { doc, win, nodes } = fakeDom();
  const log = createCallLog(5);
  log.record({ method: 'GET', path: '/api/health', status: 200, ok: true, ms: 3 });
  noteHealth({ status: 'ok', qloo: { reachable: true } });
  noteEnvelope({ dossier: { meta: { chain: { measured: 4 } } } });
  const stop = startInspector({ doc, win, log });

  assert.equal(nodes.inspector.hidden, true, 'the modal is hidden at rest');

  nodes['open-inspector'].fire('click');
  assert.equal(nodes.inspector.hidden, false, 'the trigger opens the dialog');
  assert.equal(nodes['inspector-close'].focused, 1, 'focus moves to Close');
  assert.equal(nodes['inspector-calls'].textContent, 'GET /api/health -> 200 (3ms)',
    'the call log renders as rows');
  assert.equal(JSON.parse(nodes['inspector-qloo'].textContent).qloo.reachable, true,
    'the qloo evidence renders as RAW JSON text');
  assert.equal(JSON.parse(nodes['inspector-provenance'].textContent).chain.measured, 4,
    'the provenance ledger renders as RAW JSON text');

  nodes['inspector-close'].fire('click');
  assert.equal(nodes.inspector.hidden, true, 'Close hides the dialog');
  assert.equal(nodes['open-inspector'].focused, 1, 'focus RETURNS to the trigger');

  nodes['open-inspector'].fire('click');
  win.fire('keydown', { key: 'Escape' });
  assert.equal(nodes.inspector.hidden, true, 'Escape closes');

  nodes['open-inspector'].fire('click');
  nodes['inspector-backdrop'].fire('click');
  assert.equal(nodes.inspector.hidden, true, 'the backdrop closes');

  stop();
  assert.equal(win.listeners.size, 0, 'stop() detaches the key listener');
});

test('behaviour: honest empty states before any evidence exists', async () => {
  const { startInspector } = await import(path.join(CLIENT, 'src', 'js', 'inspector.js'));
  // The evidence slots are module-level (last-write-wins): reset them
  // so this test sees the TRUE initial state.
  noteHealth(null);
  noteEnvelope(null);
  const { doc, win, nodes } = fakeDom();
  const stop = startInspector({ doc, win, log: createCallLog(5) });
  nodes['open-inspector'].fire('click');
  assert.equal(nodes['inspector-calls'].textContent, 'no calls recorded yet',
    'an empty call log says so');
  assert.equal(nodes['inspector-qloo'].textContent, 'not recorded yet',
    'no probe -> the honest empty state');
  assert.equal(nodes['inspector-provenance'].textContent, 'not recorded yet',
    'no dossier -> the honest empty state');
  stop();
});

test('markup, wiring and style: a real dialog, fed by the transports', () => {
  const modal = html.match(/<div id="inspector" class="inspector" hidden role="dialog" aria-modal="true"\s+aria-labelledby="inspector-title">/);
  assert.ok(modal, 'the modal is a real dialog, hidden at rest');
  assert.match(html, /<button type="button" id="open-inspector" class="action inspector-trigger">API Inspector<\/button>/,
    'the labelled trigger lives in the titlebar');
  assert.match(html, /Raw values, never rewritten/,
    'the never-rewritten note is pinned');
  for (const [id, title] of [
    ['inspector-calls', 'Client call log'],
    ['inspector-qloo', 'Qloo connectivity (last successful probe)'],
    ['inspector-provenance', 'Provenance ledger (last dossier)'],
  ]) {
    assert.match(html, new RegExp(`<pre id="${id}" class="inspector-code"><\\/pre>`),
      `the ${title} section node exists`);
  }

  assert.match(api, /recordCall\(\{/ , 'api.js records every gateway call at the transport edge');
  assert.match(api, /ms: Date\.now\(\) - started/, 'with real timing');
  assert.match(connectivity, /if \(probe\.ok\) noteHealth\(probe\.payload\)/,
    'the connectivity monitor feeds the last successful health report');
  assert.match(ui, /noteEnvelope\(payload\)/, 'renderJson feeds the provenance ledger');
  assert.match(main, /startInspector\(\)/, 'main.js starts the modal');
  assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the inspector never touches innerHTML');

  const code = mainCss.match(/\.inspector-code\s*\{[^}]*\}/)[0];
  assert.match(code, /font-family:\s*var\(--font-mono\);/, 'evidence reads in the mono stack');
  assert.match(code, /white-space:\s*pre-wrap;/, 'raw JSON keeps its lines');
  const backdrop = mainCss.match(/\.inspector-backdrop\s*\{[^}]*\}/)[0];
  assert.match(backdrop, /background:\s*color-mix\(in srgb, var\(--bg\) 80%, transparent\);/,
    'the backdrop is a derived palette shade (no new literal)');
});

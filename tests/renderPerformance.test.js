/**
 * Render performance gate (task 153) — pins ZERO UNNECESSARY DOM
 * WRITES across the client's hot paths:
 *
 *   - THE GUARDS: setTextIfChanged / setAttrIfChanged write ONLY when
 *     the value differs (a counting node proves zero writes on a
 *     repeat; a missing node is a silent false);
 *   - PROGRESS: an element already showing the first frame costs ZERO
 *     writes on start; the motion-cap frame writes exactly once;
 *   - CONNECTIVITY: the 30s poll re-applies the same state most of
 *     the time — after the initial transition, further polls produce
 *     ZERO attribute/text writes (no live-region churn);
 *   - ANCHOR INPUT: typing within the same match set ("a" -> "al") is
 *     a ZERO-DOM-WORK keystroke (signature skip); arrow navigation
 *     touches only the two AFFECTED options (no querySelectorAll scan
 *     over N nodes, no N rewrites per key);
 *   - STATUS: an identical status repeat costs zero writes;
 *   - DISCIPLINE: every hot-path module imports the shared guard;
 *     zero innerHTML anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { setTextIfChanged, setAttrIfChanged } = await import(
  path.join(CLIENT, 'src', 'js', 'renderGuard.js')
);
const { progressFrame, startProgress } = await import(
  path.join(CLIENT, 'src', 'js', 'progress.js')
);
const { startAnchorInput } = await import(
  path.join(CLIENT, 'src', 'js', 'anchorInput.js')
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A node that COUNTS every text/attribute write. */
function countingNode() {
  const attrs = new Map();
  const node = {
    textWrites: 0, attrWrites: 0, _text: '', hidden: false, id: '', className: '',
    value: '', focused: false,
    getAttribute(k) { return attrs.get(k) ?? null; },
    setAttribute(k, v) { node.attrWrites += 1; attrs.set(k, String(v)); },
    removeAttribute(k) { node.attrWrites += 1; attrs.delete(k); },
    hasAttribute(k) { return attrs.has(k); },
    addEventListener() {},
    removeEventListener() {},
    focus() { node.focused = true; },
    scrollIntoView() {},
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text; },
    set(v) { node.textWrites += 1; node._text = v; },
  });
  return node;
}

test('the guards: write only on change, never throw', () => {
  const node = countingNode();
  assert.equal(setTextIfChanged(node, 'hello'), true, 'a change writes');
  assert.equal(node.textWrites, 1, 'exactly once');
  assert.equal(setTextIfChanged(node, 'hello'), false, 'a repeat is skipped');
  assert.equal(node.textWrites, 1, 'still exactly once (zero DOM work)');

  assert.equal(setAttrIfChanged(node, 'data-tone', 'ok'), true, 'a new attribute writes');
  assert.equal(setAttrIfChanged(node, 'data-tone', 'ok'), false, 'the same value is skipped');
  assert.equal(node.attrWrites, 1, 'exactly one attribute write');
  assert.equal(setAttrIfChanged(node, 'data-tone', 'error'), true, 'a changed value writes');
  assert.equal(node.attrWrites, 2, 'and only the change cost a write');

  assert.equal(setTextIfChanged(null, 'x'), false, 'a missing node is a silent false');
  assert.equal(setAttrIfChanged(null, 'a', 'b'), false, 'same for attributes');
});

test('progress: an already-showing frame costs zero writes', async () => {
  const element = countingNode();
  element.textContent = progressFrame(0); // the frame is ON SCREEN
  element.textWrites = 0;

  const stop = startProgress({ element, intervalMs: 10, maxDurationMs: 40 });
  assert.equal(element.textWrites, 0,
    'start() writes nothing when the first frame is already displayed');
  await sleep(70);
  assert.ok(element.textWrites >= 1, 'the motion cap eventually freezes the readout');
  const writesAtCap = element.textWrites;
  await sleep(30);
  assert.equal(element.textWrites, writesAtCap,
    'the capped static frame never rewrites itself');
  stop();
});

test('connectivity: unchanged polls produce zero writes', async () => {
  const { startConnectivityMonitor } = await import(
    path.join(CLIENT, 'src', 'js', 'connectivity.js')
  );
  const state = countingNode();
  const label = countingNode();
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => ({ connectivity: state, 'connectivity-label': label }[id] ?? null),
  };
  try {
    const stop = startConnectivityMonitor({
      intervalMs: 10,
      win: { addEventListener() {}, removeEventListener() {} },
      fetchImpl: async () => ({ status: 'ok' }),
    });
    await sleep(60); // several polls, all "online"
    const textWrites = label.textWrites;
    const attrWrites = state.attrWrites;
    assert.ok(textWrites <= 2 && attrWrites <= 2,
      `only the checking->online transition wrote (texts ${textWrites}, attrs ${attrWrites})`);
    await sleep(60); // more identical polls
    assert.equal(label.textWrites, textWrites, 'later identical polls write NO text');
    assert.equal(state.attrWrites, attrWrites, 'and NO attributes');
    stop();
  } finally {
    globalThis.document = previousDocument;
  }
});

test('anchor input: identical match sets and targeted highlights', async () => {
  const appends = [];
  let selectedWrites = 0;
  const make = (tag) => {
    const node = {
      tag, id: '', className: '', value: '', hidden: false, _text: '', children: [],
      attrs: new Map(), listeners: new Map(),
      getAttribute(k) { return attrs().get(k) ?? null; },
      setAttribute(k, v) {
        if (k === 'aria-selected') selectedWrites += 1;
        attrs().set(k, String(v));
      },
      removeAttribute(k) { attrs().delete(k); },
      addEventListener(type, fn) { this.listeners.set(type, fn); },
      removeEventListener(type) { this.listeners.delete(type); },
      appendChild(child) { this.children.push(child); appends.push(child); },
      focus() {}, scrollIntoView() {},
      fire(type, event) { return this.listeners.get(type)?.(event); },
    };
    const store = new Map();
    const attrs = () => store;
    Object.defineProperty(node, 'textContent', {
      get() { return node._text; },
      set(v) { node._text = v; if (v === '') node.children = []; },
    });
    return node;
  };
  const input = make('input');
  const list = make('ul');
  const doc = {
    getElementById: (id) => ({ seed: input, 'anchor-suggestions': list }[id] ?? null),
    createElement: (tag) => make(tag),
  };
  const stop = startAnchorInput({
    doc,
    fetchImpl: async () => ({
      categories: [
        { id: 'a', label: 'Alpha', aliases: [] },
        { id: 'b', label: 'Bravo', aliases: [] },
        { id: 'c', label: 'Charlie', aliases: [] },
      ],
    }),
  });

  input.value = 'a'; // matches all three
  input.fire('input');
  await sleep(5);
  assert.equal(appends.length, 3, 'three options render');

  selectedWrites = 0;
  input.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(selectedWrites, 1,
    'entering the first option writes ONE aria-selected (was: N rewrites + a full scan)');
  input.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(selectedWrites, 3,
    'the second move touches only the two AFFECTED options (leaving + entering)');

  input.value = 'al'; // narrows to Alpha -> a NEW signature, one append
  input.fire('input');
  await sleep(5);
  assert.equal(appends.length, 4, 'a changed match set re-renders');

  input.value = 'alp'; // SAME single-option set
  input.fire('input');
  await sleep(5);
  assert.equal(appends.length, 4,
    'typing within the same match set costs ZERO DOM work (signature skip)');
  stop();
});

test('status: an identical repeat costs zero writes', async () => {
  const { setStatus } = await import(path.join(CLIENT, 'src', 'js', 'ui.js'));
  const status = countingNode();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => (id === 'status' ? status : null) };
  try {
    setStatus('Running worldbuilder mode...');
    setStatus('Running worldbuilder mode...');
    assert.equal(status.textWrites, 1, 'the repeated message never rewrites');
    assert.equal(status.attrWrites, 0, 'the neutral tone never touches attributes');
    setStatus('dossier ready.', 'ok');
    setStatus('dossier ready.', 'ok');
    assert.equal(status.textWrites, 2, 'a changed message writes once');
    assert.equal(status.attrWrites, 1, 'the tone writes once, the repeat is skipped');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('discipline: every hot path uses the shared guard', async () => {
  for (const file of ['progress.js', 'connectivity.js', 'anchorInput.js', 'ui.js']) {
    const source = await readFile(path.join(CLIENT, 'src', 'js', file), 'utf8');
    assert.match(source, /from '\.\/renderGuard\.js'/,
      `${file} imports the shared guard`);
    assert.ok(!/innerHTML/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      `${file} never touches innerHTML`);
  }
});

/**
 * System tokens pin (task 123) — freezes the six semantic design tokens
 * of the client to their Archival Iron values:
 *
 *   --bg: #101114   --surface: #1F2326   --muted: #96A2A8
 *   --gold: #D4A853 --rust: #E06338      --text: #F4EFE6
 *
 * The gate resolves each token through the token chain (Layer 1 alias
 * -> Layer 0 palette value) and asserts the FINAL hex is byte-exact, so
 * repointing --bg at any other palette entry — or at a derived shade —
 * fails even though every individual file stays palette-legal.
 *
 * It additionally pins the architecture around the mapping:
 *   - SERVER PARITY: the same six values exist in the server's print
 *     formatter PALETTE (one palette, two renderers — drift fails);
 *   - LAYER DISCIPLINE: Layer 1 references ONLY Layer 0, Layer 2 derives
 *     ONLY from Layer 1 (no shortcuts, no literals below Layer 0);
 *   - CONSUMPTION: every pinned token is actually used by main.css
 *     (a dead semantic token is a stale contract, not a feature).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The server-parity gate imports the server formatter, whose import
// chain loads config/env.js — which EXITS on an invalid environment.
// Provide a test key before the (dynamic) import; no network is ever
// made (the formatter is pure).
process.env.QLOO_API_KEY = 'system-tokens-key';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const TOKENS_CSS = path.join(CLIENT, 'src', 'css', 'tokens.css');
const MAIN_CSS = path.join(CLIENT, 'src', 'css', 'main.css');

/** The frozen mapping (task 123). */
const SYSTEM_TOKENS = Object.freeze({
  '--bg': '#101114',
  '--surface': '#1F2326',
  '--muted': '#96A2A8',
  '--gold': '#D4A853',
  '--rust': '#E06338',
  '--text': '#F4EFE6',
});

const tokensCss = await readFile(TOKENS_CSS, 'utf8');
const mainCss = await readFile(MAIN_CSS, 'utf8');

/** Parse `--name: value;` declarations into a Map (last wins). */
function parseTokens(css) {
  const map = new Map();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

const tokens = parseTokens(tokensCss);

/** Resolve a token to its final hex through the var() chain (max 4 hops). */
function resolve(name) {
  let value = tokens.get(name);
  for (let hop = 0; hop < 4 && value; hop += 1) {
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    if (!ref) break;
    value = tokens.get(ref[1]);
  }
  return value ?? null;
}

test('the six system tokens resolve to their frozen values', () => {
  for (const [name, expected] of Object.entries(SYSTEM_TOKENS)) {
    const actual = resolve(name);
    assert.ok(actual, `${name} is declared in tokens.css`);
    assert.equal(actual.toLowerCase(), expected.toLowerCase(),
      `${name} must resolve to ${expected}, got ${actual}`);
  }
});

test('each system token maps to a DISTINCT palette entry', async () => {
  const targets = new Set();
  for (const name of Object.keys(SYSTEM_TOKENS)) {
    const value = tokens.get(name);
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    assert.ok(ref, `${name} is an alias reference, not a literal (layer discipline)`);
    targets.add(ref[1]);
  }
  assert.equal(targets.size, 6, 'the six aliases point at six distinct palette entries');
});

test('server parity: HtmlPrintFormatter PALETTE carries the same six values', async () => {
  const { PALETTE } = await import('../server/src/formatters/HtmlPrintFormatter.js');
  for (const [name, expected] of Object.entries(SYSTEM_TOKENS)) {
    const key = name.slice(2); // --bg -> bg
    assert.ok(key in PALETTE, `server PALETTE has a "${key}" entry`);
    assert.equal(String(PALETTE[key]).toLowerCase(), expected.toLowerCase(),
      `server PALETTE.${key} must equal the client ${name}`);
  }
});

test('layer discipline: L1 references L0, L2 derives only from L1', () => {
  for (const name of Object.keys(SYSTEM_TOKENS)) {
    const value = tokens.get(name);
    assert.match(value, /^var\(--palette-\w+\)$/,
      `${name} references exactly one Layer 0 token`);
  }
  const derived = ['--line', '--focus-ring', '--bg-page', '--gold-hi'];
  for (const name of derived) {
    const value = tokens.get(name);
    assert.ok(value, `${name} is declared`);
    assert.ok(!/^#[0-9a-fA-F]/.test(value), `${name} holds no hex literal`);
    for (const [, ref] of value.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(Object.keys(SYSTEM_TOKENS).includes(ref),
        `${name} derives from the semantic layer (${ref}), never straight from L0`);
    }
  }
});

test('every pinned token is consumed by main.css', () => {
  for (const name of Object.keys(SYSTEM_TOKENS)) {
    assert.ok(mainCss.includes(`var(${name})`),
      `main.css styles against ${name} (no dead semantic token)`);
  }
});

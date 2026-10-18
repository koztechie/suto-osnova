/**
 * Status titlebar gate (task 132) — pins the top titlebar contract:
 * the SUTO OSNOVA name, the logo, and the Qloo connectivity indicator.
 *
 *   - MARKUP: the titlebar carries the h1 with the EXACT name, a logo
 *     img (real local asset, decorative alt="" — the h1 carries the
 *     name for assistive tech, explicit width/height so the load never
 *     shifts the layout), and the indicator node with its live-region
 *     contract (role="status", aria-live, data-state="checking") plus
 *     the decorative dot (aria-hidden) and the label span;
 *   - FOUR HONEST STATES: checking / online / degraded / offline —
 *     "degraded" separates "backend up, Qloo down" (HTTP 503) from
 *     "everything down" (transport failure), and a payload WITHOUT an
 *     explicit ok status is never claimed online;
 *   - PURE MAPPING: stateFromProbe is a total function (garbage in ->
 *     a safe state, never a throw); probeHealth NEVER rejects;
 *   - NO SPAM: the poll cadence is a real interval (>= 10s), and the
 *     indicator writes via textContent/setAttribute only (XSS-safe);
 *   - WIRING: api.js exports fetchHealth against the LOCAL /health
 *     gateway route, and main.js starts the monitor on boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const JS_DIR = path.join(CLIENT, 'src', 'js');

const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');
const { CONNECTIVITY_STATES, CONNECTIVITY_LABELS, POLL_INTERVAL_MS, stateFromProbe, probeHealth }
  = await import(path.join(JS_DIR, 'connectivity.js'));
const api = await readFile(path.join(JS_DIR, 'api.js'), 'utf8');
const main = await readFile(path.join(JS_DIR, 'main.js'), 'utf8');
const connectivity = await readFile(path.join(JS_DIR, 'connectivity.js'), 'utf8');

test('the titlebar markup: name, logo, indicator live region', async () => {
  const titlebar = html.match(/<div class="titlebar">([\s\S]*?)<\/div>/);
  assert.ok(titlebar, 'the titlebar container exists in the header');
  const bar = titlebar[1];

  assert.match(bar, /<h1 class="brand">SUTO OSNOVA<\/h1>/,
    'the h1 carries the EXACT name SUTO OSNOVA');

  const logo = bar.match(/<img class="titlebar-logo" src="([^"]+)"\s+width="(\d+)" height="(\d+)" alt="">/);
  assert.ok(logo, 'the logo img is present with explicit dimensions and decorative alt');
  assert.equal(logo[1], './public/favicon.svg', 'the logo is the real local asset');
  assert.ok((await readFile(path.join(CLIENT, logo[1]))).length > 0, 'the logo file exists');

  const indicator = bar.match(/<p id="connectivity" class="connectivity" role="status" aria-live="polite"\s+data-state="checking">/);
  assert.ok(indicator, 'the indicator is a live region starting in the checking state');
  assert.match(bar, /<span class="connectivity-dot" aria-hidden="true"><\/span>/,
    'the state dot is decorative (aria-hidden)');
  assert.match(bar, /<span id="connectivity-label" class="connectivity-label">/,
    'the label span the monitor writes to exists');
});

test('four honest states with distinct labels', () => {
  assert.deepEqual([...CONNECTIVITY_STATES],
    ['checking', 'online', 'degraded', 'offline']);
  const labels = Object.values(CONNECTIVITY_LABELS);
  assert.equal(labels.length, 4, 'a label per state');
  assert.equal(new Set(labels).size, 4, 'all labels distinct (text, never colour-only)');
  for (const state of CONNECTIVITY_STATES) {
    assert.ok(CONNECTIVITY_LABELS[state], `state "${state}" has a label`);
  }
});

test('stateFromProbe is total and honest', () => {
  assert.equal(stateFromProbe({ ok: true, payload: { status: 'ok' } }), 'online');
  assert.equal(stateFromProbe({ ok: true, payload: { status: 'degraded' } }), 'degraded');
  // A payload WITHOUT an explicit ok status is never claimed online.
  assert.equal(stateFromProbe({ ok: true, payload: {} }), 'degraded');
  assert.equal(stateFromProbe({ ok: true, payload: null }), 'degraded');
  // An HTTP answer — even 503 — proves the BACKEND is up.
  assert.equal(stateFromProbe({ ok: false, error: { status: 503 } }), 'degraded');
  // Only a transport failure means the whole link is down.
  assert.equal(stateFromProbe({ ok: false, error: { code: 'NETWORK' } }), 'offline');
  assert.equal(stateFromProbe({ ok: false, error: {} }), 'offline');
  // Total: garbage never throws.
  assert.equal(stateFromProbe(null), 'offline');
  assert.equal(stateFromProbe(undefined), 'offline');
});

test('probeHealth never rejects', async () => {
  const okProbe = await probeHealth(async () => ({ status: 'ok' }));
  assert.deepEqual(okProbe, { ok: true, payload: { status: 'ok' } });
  const boom = new Error('network down');
  const failProbe = await probeHealth(async () => { throw boom; });
  assert.equal(failProbe.ok, false);
  assert.equal(failProbe.error, boom);
});

test('the monitor: no spam, XSS-safe writes, wired on boot', () => {
  assert.ok(Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS >= 10_000,
    `the poll cadence is a real interval (>= 10s), got ${POLL_INTERVAL_MS}`);
  // Strip comments first: the contract prose MENTIONS the forbidden
  // sink by name and must not trip the probe.
  const bare = connectivity.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML/.test(bare),
    'the monitor writes via textContent/setAttribute only (never innerHTML)');
  assert.match(main, /startConnectivityMonitor\(\)/, 'main.js starts the monitor on boot');
  assert.match(api, /return request\('\/health'\);/,
    'fetchHealth probes the LOCAL /health gateway route only');
});

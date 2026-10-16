/**
 * No-trackers compliance gate (task 77) — programmatically proves the
 * NO THIRD-PARTY TRACKERS rule across four layers:
 *   1. runtime dependency allowlist (package.json dependencies);
 *   2. production lockfile transitives + devDependencies vs the
 *      tracker package denylist;
 *   3. source scan of server/src (zero tracker patterns, URL literals
 *      inside the documented host allowlist, fetch() ONLY in the two
 *      sanctioned transports);
 *   4. RUNTIME PROBES with an instrumented global fetch: the full
 *      generation cycle performs ZERO outbound calls, and the two
 *      sanctioned transports reach ONLY allowlisted hosts with no
 *      telemetry-shaped headers (the Authorization/Bearer credential
 *      is authentication, not tracking — documented).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

process.env.QLOO_API_KEY = 'no-trackers-test-key';
process.env.MOCK_MODE = 'false';
// The probe asserts a REAL outbound call — the response cache would
// swallow it on the second run.
process.env.QLOO_CACHE_ENABLED = 'false';

import {
  auditDependencies,
  auditLockfile,
  auditDevPackages,
  auditSourceTree,
  RUNTIME_DEPENDENCY_ALLOWLIST,
  ALLOWED_URL_HOSTS,
  SANCTIONED_FETCH_FILES,
  TRACKER_SOURCE_PATTERNS,
} from '../../scripts/lib/trackerAudit.js';

// The shared cycle runner pulls env-dependent services — load AFTER env.
const { runFullCycle } = await import('../test-support/fullCycleRunner.js');
const { searchEntities } = await import('../src/services/entitySearchClient.js');
const { synthesizeDossier } = await import('../src/services/llmSynthesizer.js');
const { env } = await import('../src/config/env.js');

const root = process.cwd();

test('check 1: runtime dependencies are exactly the sanctioned set', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const audit = auditDependencies(pkg);

  assert.deepEqual(audit.deps.sort(), [...RUNTIME_DEPENDENCY_ALLOWLIST].sort(),
    'any new runtime dependency must consciously update the allowlist');
  assert.equal(audit.ok, true);
});

test('check 2: no tracker packages in the production tree or devDependencies', async () => {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const prod = auditLockfile(lock);
  assert.ok(prod.audited > 50, `the production tree is substantial (${prod.audited} packages)`);
  assert.deepEqual(prod.findings, [], 'production transitives are tracker-free');

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const dev = auditDevPackages(pkg);
  assert.deepEqual(dev.findings, [], 'dev tools are tracker-free too');
});

test('check 3: source scan — no tracker patterns, only allowlisted hosts, sanctioned fetch sites', async () => {
  const audit = await auditSourceTree(path.join(root, 'server/src'));

  assert.ok(audit.filesScanned > 30, `the scan is substantial (${audit.filesScanned} files)`);
  assert.deepEqual(audit.trackerHits, [], 'zero tracker patterns in server/src');
  assert.deepEqual(audit.badUrls, [], 'every URL host is in the documented allowlist');
  assert.deepEqual(
    audit.unsanctionedFetchSites, [],
    'fetch() lives only in the sanctioned transports'
  );
  assert.equal(audit.fetchSites.length, SANCTIONED_FETCH_FILES.length,
    'the allowlist matches reality: exactly the two sanctioned transports');

  // The audit's own patterns stay non-vacuous: each must match a probe.
  for (const probe of [
    'https://www.googletagmanager.com/gtm.js',
    'connect.facebook.net/en_US/fbevents.js',
    'https://e.mixpanel.com/api/v2/track',
    'https://o123.ingest.sentry.io/api/envelope',
    'navigator.sendBeacon(url, data)',
  ]) {
    const hit = TRACKER_SOURCE_PATTERNS.some((p) => p.re.test(probe));
    assert.ok(hit, `the denylist catches: ${probe}`);
  }
});

test('probe A: the full generation cycle makes ZERO outbound calls', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    throw new Error('outbound call attempted during an injected cycle');
  };

  const baseDir = await mkdtemp(path.join(tmpdir(), 'no-trackers-'));
  try {
    const cycle = await runFullCycle(baseDir);
    assert.ok(cycle.resolved.verified, 'the cycle completed through injected clients');
    assert.deepEqual(calls, [], 'a fully injected cycle must never touch the network');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }
});

test('probe B: qlooClient reaches only the sanctioned host, with clean headers', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, method: init?.method ?? 'GET' });
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, results: [] }),
    };
  };

  try {
    await searchEntities('NoTrackers Probe', 'film');
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }

  assert.equal(calls.length, 1, 'exactly one outbound request');
  const host = new URL(calls[0].url).host;
  assert.equal(host, new URL(env.QLOO_BASE_URL).host, 'the configured Qloo host only');
  assert.ok(host in ALLOWED_URL_HOSTS, 'host is in the allowlist');

  // Header hygiene: only transport/auth headers, nothing telemetry-shaped.
  const headerKeys = Object.keys(calls[0].headers).map((k) => k.toLowerCase());
  for (const key of headerKeys) {
    assert.ok(
      ['x-api-key', 'content-type', 'accept', 'accept-encoding', 'host', 'user-agent', 'connection', 'content-length'].includes(key),
      `unexpected outbound header: ${key}`
    );
  }
});

test('probe C: the LLM transport reaches only the sanctioned host', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return {
      ok: true, status: 200,
      json: async () => ({ model: 'stub', choices: [{ message: { content: 'ok' } }] }),
    };
  };

  try {
    await synthesizeDossier({ anchor: { name: 'Probe' } }, { apiKey: 'probe-key' });
  } finally {
    if (realFetch) globalThis.fetch = realFetch; else delete globalThis.fetch;
  }

  assert.equal(calls.length, 1);
  const host = new URL(calls[0].url).host;
  assert.equal(host, new URL(env.LLM_BASE_URL).host, 'the configured LLM host only');
  assert.ok(host in ALLOWED_URL_HOSTS);
  // Bearer is AUTHENTICATION for a sanctioned API — not a tracker.
  assert.equal(calls[0].headers.authorization, 'Bearer probe-key');
});

test('the allowlist itself stays documented and minimal', () => {
  assert.ok(Object.keys(ALLOWED_URL_HOSTS).length <= 8, 'no silent allowlist growth');
  for (const [host, reason] of Object.entries(ALLOWED_URL_HOSTS)) {
    assert.ok(typeof reason === 'string' && reason.length > 5, `${host} has a documented reason`);
  }
  assert.deepEqual([...SANCTIONED_FETCH_FILES].map((f) => f.split('/').pop()).sort(), [
    'llmSynthesizer.js', 'qlooClient.js',
  ]);
});

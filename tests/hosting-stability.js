/**
 * PUBLIC HOSTING STABILITY probe (task 193) — measures the LIVE deployed
 * site and reports PASS/FAIL for "full stability". Standalone, network-bound
 * and deliberately NOT part of the deterministic `npm test` suite.
 *
 * Usage:
 *   node tests/hosting-stability.js                    # production
 *   node tests/hosting-stability.js <base-url>         # any deployment
 *
 * WHAT A STABLE HOST MUST PASS (all checks, exit 0):
 *   1. TLS        — certificate authorized, not expiring within TLS_MIN_DAYS.
 *   2. Static CDN — GET / serves 200 100% of STATIC_SAMPLES with p95 <= STATIC_P95_MS.
 *   3. API health — GET /api/health serves 200 100% of API_SAMPLES with p95 <= API_P95_MS
 *                   (paced API_SPACING_MS so the probe NEVER trips the inbound
 *                   rate limit — 30 req / 60 s / client; an artificial 429
 *                   would be misreported as instability).
 *   4. Security headers actually served by the CDN (nosniff, DENY, referrer,
 *      permissions, CSP) + /assets/* immutable caching.
 *   5. Endpoint coverage — /api/categories 200 (non-empty) and the three
 *      PUBLIC demo presets (one per demo flow, the seeds real visitors
 *      click): stability = NEVER a 5xx/opaque answer. Each preset must
 *      yield either a full dossier (200, schema suto-osnova.dossier/v1,
 *      ranked>0) or a TYPED structured error envelope (a handled content
 *      outcome such as no_usable_signal — reported, not a crash), with at
 *      least PRESET_MIN_DOSSIERS shipping live dossiers.
 *
 * The first API call records COLD_START_MS separately (the free tier spins
 * the function down) so idle latency is reported, not hidden.
 * Exit code: 0 = stable, 1 = any instability (automation-safe).
 */
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://suto-osnova.netlify.app';
const TIMEOUT_MS = 30_000;          // > LLM budget (12 s) and <= function timeout (26 s)
const STATIC_SAMPLES = 12;
const API_SAMPLES = 6;
const API_SPACING_MS = 3000;        // keeps the probe well under 30 req / 60 s
const GENERATE_ATTEMPTS = 2;

// Stability bounds.
const STATIC_P95_MS = 2500;         // Netlify CDN edge
const API_P95_MS = 4000;            // warm serverless function
const GENERATE_MAX_MS = 26_000;     // the pinned function timeout budget
const TLS_MIN_DAYS = 7;             // Netlify rotates ~90 d; 7 d = early warning

// The three PUBLIC demo presets (client/index.html data-seed/data-mode) —
// exactly what a visitor's one-tap demo triggers.
const PRESETS = Object.freeze([
  { seed: 'David Lynch Noir', mode: 'worldbuilder' },
  { seed: 'Post-Punk Berlin', mode: 'worldbuilder' },
  { seed: 'Ambient Festival', mode: 'experiential' },
]);
const PRESET_MIN_DOSSIERS = 2;      // >= 2 of 3 must ship a live dossier

const HEADER_EXACT = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const HEADER_PRESENT = ['permissions-policy', 'content-security-policy'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const stats = (values) => ({
  n: values.length,
  min: Math.min(...values),
  avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  p95: pct(values, 95),
  max: Math.max(...values),
});

async function timedFetch(url, init = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    return {
      status: res.status,
      ms: Math.round(performance.now() - t0),
      headers: res.headers,
      text,
      ok: res.status >= 200 && res.status < 300,
    };
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code || err?.message || 'error');
    return { status: 0, ms: Math.round(performance.now() - t0), ok: false, error: reason, text: '' };
  }
}

function checkTLS(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = new Date(cert.valid_to);
      const days = Math.floor((validTo - Date.now()) / 86_400_000);
      const out = { authorized: socket.authorized, days, validTo: validTo.toISOString(), issuer: cert.issuer?.O ?? 'unknown' };
      socket.end();
      resolve(out);
    });
    socket.on('error', (err) => resolve({ authorized: false, days: -1, error: err.message }));
    socket.setTimeout(10_000, () => {
      socket.destroy();
      resolve({ authorized: false, days: -1, error: 'timeout' });
    });
  });
}

async function main() {
  const base = (process.argv[2] || DEFAULT_BASE).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  const checks = [];
  const record = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  };
  const row = (label, s, unit = 'ms') =>
    console.log(`      ${label.padEnd(14)} n=${s.n} min=${s.min}${unit} avg=${s.avg}${unit} p95=${s.p95}${unit} max=${s.max}${unit}`);

  console.log(`\nSUTO OSNOVA hosting stability probe — ${base} — ${new Date().toISOString()}\n`);

  // 1. TLS ---------------------------------------------------------------
  const tls = await checkTLS(host);
  record('TLS certificate', tls.authorized && tls.days >= TLS_MIN_DAYS,
    tls.error ? `unreachable: ${tls.error}`
      : `${tls.issuer}, valid to ${tls.validTo} (${tls.days} d left)`);
  if (tls.error) return finish(checks); // no point continuing if TLS is broken

  // 2. Cold start + static CDN sample ------------------------------------
  const warmup = await timedFetch(`${base}/api/health`);
  console.log(`      cold start     GET /api/health -> ${warmup.status} in ${warmup.ms} ms (idle spin-down)\n`);

  const staticLat = [];
  const staticStatuses = [];
  let indexHtml = '';
  let indexHeaders = null;
  for (let i = 0; i < STATIC_SAMPLES; i += 1) {
    const r = await timedFetch(`${base}/`);
    staticStatuses.push(r.status);
    staticLat.push(r.ms);
    if (!indexHtml && r.text) indexHtml = r.text;
    if (!indexHeaders && r.headers) indexHeaders = r.headers;
    await sleep(400);
  }
  const staticOk = staticStatuses.filter((s) => s === 200).length;
  const staticStats = stats(staticLat);
  row('static /', staticStats);
  record('Static CDN availability', staticOk === STATIC_SAMPLES, `${staticOk}/${STATIC_SAMPLES} responded 200`);
  record('Static CDN latency (p95)', staticStats.p95 <= STATIC_P95_MS, `p95 ${staticStats.p95} ms <= ${STATIC_P95_MS} ms`);

  // 3. API health sample (paced under the rate limit) ---------------------
  const apiLat = [];
  const apiStatuses = [];
  let healthPayload = null;
  for (let i = 0; i < API_SAMPLES; i += 1) {
    const r = await timedFetch(`${base}/api/health`);
    apiStatuses.push(r.status);
    apiLat.push(r.ms);
    if (r.ok && r.text) {
      try { healthPayload ??= JSON.parse(r.text); } catch { /* keep first parseable */ }
    }
    await sleep(API_SPACING_MS);
  }
  const apiOk = apiStatuses.filter((s) => s === 200).length;
  const apiStats = stats(apiLat);
  row('api /health', apiStats);
  record('API availability', apiOk === API_SAMPLES, `${apiOk}/${API_SAMPLES} responded 200 (no rate-limit 429)`);
  record('API latency (p95)', apiStats.p95 <= API_P95_MS, `p95 ${apiStats.p95} ms <= ${API_P95_MS} ms`);
  record('Health payload', !!healthPayload && healthPayload.status === 'ok',
    healthPayload ? `status=${healthPayload.status}, qloo=${healthPayload.qloo?.status ?? 'n/a'}, mode=${healthPayload.mode ?? 'n/a'}` : 'no parseable payload');

  // 4. Security + cache headers ------------------------------------------
  if (indexHeaders) {
    const missing = [];
    for (const [name, expected] of Object.entries(HEADER_EXACT)) {
      const got = indexHeaders.get(name);
      if (got !== expected) missing.push(`${name} (want "${expected}", got "${got ?? 'absent'}")`);
    }
    for (const name of HEADER_PRESENT) {
      if (!indexHeaders.get(name)) missing.push(`${name} (absent)`);
    }
    record('Security headers', missing.length === 0,
      missing.length ? missing.join('; ') : `${Object.keys(HEADER_EXACT).length} exact + ${HEADER_PRESENT.length} present (CSP/nosniff/DENY/referrer/permissions)`);
  } else {
    record('Security headers', false, 'no static response captured to inspect');
  }

  const assetMatch = indexHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/);
  if (assetMatch) {
    const asset = await timedFetch(`${base}${assetMatch[1]}`);
    const cache = asset.headers?.get('cache-control') ?? '';
    record('Asset immutable cache', asset.ok && cache.includes('immutable'),
      `${asset.status} ${assetMatch[1]} -> cache-control "${cache}"`);
  } else {
    record('Asset immutable cache', false, 'no /assets/* link found in index.html');
  }

  // 5. Endpoint coverage: categories + the three PUBLIC demo presets ------
  const cats = await timedFetch(`${base}/api/categories`);
  let catCount = 0;
  try { catCount = JSON.parse(cats.text)?.categories?.length ?? 0; } catch { /* counted below */ }
  record('GET /api/categories', cats.ok && catCount > 0, `${cats.status} in ${cats.ms} ms, ${catCount} categories`);

  // Stability bar: the function NEVER answers 5xx/opaque on the public
  // demo flows. A typed 4xx envelope (e.g. no_usable_signal when no search
  // candidate is a record Qloo accepts as a taste signal) is a HANDLED
  // content outcome — recorded, not counted as a crash.
  let dossiers = 0;
  let crashed = 0;
  for (const preset of PRESETS) {
    const gen = await timedFetch(`${base}/api/generate/${preset.mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: preset.seed, format: 'json' }),
    });
    let payload = null;
    try { payload = JSON.parse(gen.text); } catch { payload = null; }
    const ranked = payload?.dossier?.data?.ranked?.length ?? 0;
    const isDossier =
      gen.status === 200 && payload?.dossier?.schema === 'suto-osnova.dossier/v1' && ranked > 0;
    const isTyped =
      gen.status >= 400 && gen.status < 500 && payload?.status === 'error' &&
      typeof payload?.error?.code === 'string';
    const label = `preset ${JSON.stringify(preset.seed)} [${preset.mode}]`;
    if (isDossier) {
      dossiers += 1;
      const domains = payload.dossier.meta?.expansion;
      record(label, gen.ms <= GENERATE_MAX_MS,
        `dossier 200 in ${gen.ms} ms, ranked=${ranked}` +
          (domains ? `, domains=${domains.ok}/${domains.ok + domains.failed}` : ''));
    } else if (isTyped) {
      record(label, true,
        `typed ${gen.status} ${payload.error.code} in ${gen.ms} ms (handled content outcome, not a crash)`);
    } else {
      crashed += 1;
      record(label, false,
        `${gen.status || gen.error || 'malformed'} in ${gen.ms} ms — ${String(gen.text ?? '').slice(0, 160)}`);
    }
    if (gen.ms > GENERATE_MAX_MS) {
      record(`Generate budget ${JSON.stringify(preset.seed)}`, false, `${gen.ms} ms exceeds ${GENERATE_MAX_MS} ms`);
    }
    await sleep(API_SPACING_MS);
  }
  record('Public demo presets', crashed === 0 && dossiers >= PRESET_MIN_DOSSIERS,
    `${dossiers}/3 shipped a live dossier, ${crashed} crashed ` +
      `(criterion: 0 crashes and >= ${PRESET_MIN_DOSSIERS} dossiers)`);

  return finish(checks, base, { staticStats, apiStats, tls });
}

function finish(checks, base = '', extra = {}) {
  const failed = checks.filter((c) => !c.pass);
  const stable = failed.length === 0;
  console.log(`\n${'='.repeat(72)}`);
  if (base) {
    console.log(`RESULT: ${stable ? 'STABLE' : 'UNSTABLE'} — ${checks.length - failed.length}/${checks.length} checks passed — ${base}`);
    if (extra.tls) console.log(`        TLS ${extra.tls.issuer} · ${extra.tls.days} d left`);
  } else {
    console.log(`RESULT: ${stable ? 'STABLE' : 'UNSTABLE'} — ${checks.length - failed.length}/${checks.length} checks passed`);
  }
  if (!stable) for (const c of failed) console.log(`  FAIL  ${c.name} — ${c.detail}`);
  console.log('='.repeat(72));
  return stable ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`probe crashed: ${err?.stack || err}`);
    process.exit(1);
  });
}

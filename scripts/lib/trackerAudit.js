/**
 * Tracker audit library (task 77) — the programmable proof of the
 * NO THIRD-PARTY TRACKERS rule. Shared by the CLI verifier
 * (scripts/verify_no_trackers.js) and the test gate
 * (server/test/noTrackers.test.js) so both speak one truth.
 *
 * FOUR CHECKS:
 *   1. runtime dependency allowlist — `dependencies` in package.json
 *      may contain NOTHING but the two sanctioned libraries
 *      (@modelcontextprotocol/sdk, zod); any new runtime dependency
 *      must consciously update this allowlist;
 *   2. production lockfile transitives — every non-dev package in
 *      package-lock.json is checked against a TRACKER PACKAGE
 *      DENYLIST (analytics, tag managers, session replay, error-SaaS,
 *      ad/fingerprinting SDKs); devDependencies get the same tracker
 *      ban (build-time phoning home is still phoning home), while the
 *      hackathon harness stays sanctioned;
 *   3. source scan — every JS file under server/src must contain ZERO
 *      tracker patterns and every http(s) URL literal must belong to
 *      the documented HOST ALLOWLIST (configured APIs, own deployment
 *      origins, fixture media, localhost); fetch() call sites must
 *      live ONLY in the two sanctioned transports (qlooClient,
 *      llmSynthesizer);
 *   4. runtime probe (performed by callers with an instrumented
 *      fetch) — outbound hosts during real code paths must be a
 *      subset of the same host allowlist; the generation cycle must
 *      perform ZERO fetches (everything injected).
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** The only libraries allowed in `dependencies` (sanctioned by the stack contract). */
export const RUNTIME_DEPENDENCY_ALLOWLIST = Object.freeze([
  '@modelcontextprotocol/sdk',
  'zod',
]);

/** Build-time tools that must also never appear (they phone home too). */
export const TRACKER_PACKAGE_DENYLIST = Object.freeze([
  /sentry/i,
  /bugsnag/i,
  /rollbar/i,
  /airbrake/i,
  /@?newrelic/i,
  /datadog/i,
  /posthog/i,
  /mixpanel/i,
  /segment(\/|$)/i,
  /amplitude/i,
  /heap-api/i,
  /fullstory/i,
  /hotjar/i,
  /mouseflow/i,
  /inspectlet/i,
  /crazyegg/i,
  /optimizely/i,
  /google.analytics|googletagmanager|ga4/i,
  /yandex.*(metrica|metrika)/i,
  /matomo|piwik/i,
  /clarity\.ms/i,
  /facebook.*(pixel|sdk)|connect\.facebook/i,
  /tiktok.*pixel/i,
  /twitter.*pixel/i,
  /linkedin.*insight/i,
  /fingerprintjs/i,
  /tracking|i-beacon/i,
]);

/** Live tracker-domain patterns (any occurrence in source is a finding). */
export const TRACKER_SOURCE_PATTERNS = Object.freeze([
  { name: 'google-tag-manager', re: /googletagmanager\.com|google-analytics\.com|analytics\.js\/analytics/i },
  { name: 'facebook-pixel', re: /connect\.facebook\.net|fbevents\.js/i },
  { name: 'session-replay', re: /hotjar\.com|fullstory\.com|clarity\.ms|mouseflow\.com|inspectlet\.com/i },
  { name: 'analytics-saas', re: /mixpanel\.com|segment\.(com|io)|api\.amplitude\.com|posthog\.com|api\.heap\.io/i },
  { name: 'error-saas', re: /sentry\.io|o[0-9]+\.ingest\.sentry|bugsnag\.com|newrelic\.com|datadoghq\.com/i },
  { name: 'metrica', re: /mc\.yandex\.ru|metrika\.yandex|matomo|piwik/i },
  { name: 'ad-pixel', re: /doubleclick\.net|adservice\.google|facebook\.com\/tr\(/i },
  { name: 'beacon-word', re: /\b(sendBeacon|navigator\.beacon)\s*\(/i },
]);

/**
 * The ONLY hosts source code may mention. Each entry is documented —
 * an audit update requires a reason, not just a name.
 */
export const ALLOWED_URL_HOSTS = Object.freeze({
  'hackathon.api.qloo.com': 'the Qloo API (config default, QLOO_BASE_URL)',
  'api.openai.com': 'the OpenAI-compatible LLM endpoint (config default, LLM_BASE_URL)',
  'images.qloo.com': 'Qloo fixture media (MOCK fixtures only)',
  localhost: 'local dev/CORS origins',
  '127.0.0.1': 'local dev/CORS origins',
  'suto-osnova.koztechie.pp.ua': 'the project deployment origin (CORS allowlist)',
  'koztechie.pp.ua': 'the project deployment origin (CORS allowlist)',
  internal: 'URL-parsing base in app.js (never a destination)',
});

/** The only source files allowed to perform fetch(). */
export const SANCTIONED_FETCH_FILES = Object.freeze([
  'server/src/services/qlooClient.js',
  'server/src/services/llmSynthesizer.js',
]);

const URL_LITERAL = /https?:\/\/([A-Za-z0-9.-]+)/g;

/** Check 1: runtime dependencies vs the allowlist. */
export function auditDependencies(pkg) {
  const deps = Object.keys(pkg?.dependencies ?? {});
  const unexpected = deps.filter(
    (name) => !RUNTIME_DEPENDENCY_ALLOWLIST.includes(name)
  );
  return {
    ok: unexpected.length === 0,
    deps,
    unexpected,
  };
}

/** Check 2: production lockfile packages vs the tracker denylist. */
export function auditLockfile(lock) {
  const findings = [];
  let audited = 0;
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === '') continue; // the root project itself
    if (entry?.dev === true) continue; // dev tree checked separately
    const name = key.split('node_modules/').pop();
    audited += 1;
    for (const pattern of TRACKER_PACKAGE_DENYLIST) {
      if (pattern.test(name)) {
        findings.push({ package: name, pattern: String(pattern) });
      }
    }
  }
  return { ok: findings.length === 0, audited, findings };
}

/** Dev-side tracker ban (hackathon harness and generic tooling are fine). */
export function auditDevPackages(pkg) {
  const findings = [];
  for (const name of Object.keys(pkg?.devDependencies ?? {})) {
    for (const pattern of TRACKER_PACKAGE_DENYLIST) {
      if (pattern.test(name)) {
        findings.push({ package: name, pattern: String(pattern) });
      }
    }
  }
  return { ok: findings.length === 0, findings };
}

/** Per-file source facts: URLs, fetch sites, tracker hits. */
export function scanSource(text, file) {
  const urls = [];
  for (const match of text.matchAll(URL_LITERAL)) {
    urls.push({ file, host: match[1], url: match[0] });
  }
  const trackerHits = TRACKER_SOURCE_PATTERNS.filter((p) => p.re.test(text)).map(
    (p) => ({ file, pattern: p.name })
  );
  const usesFetch = /\bfetch\s*\(/.test(text);
  return { file, urls, trackerHits, usesFetch };
}

/** Check 3: walk server/src and audit every .js file. */
export async function auditSourceTree(rootDir) {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  await walk(rootDir);

  const scans = [];
  for (const file of files.sort()) {
    scans.push(scanSource(await readFile(file, 'utf8'), file));
  }

  const trackerHits = scans.flatMap((s) => s.trackerHits);
  const badUrls = scans
    .flatMap((s) => s.urls)
    .filter((u) => !(u.host in ALLOWED_URL_HOSTS));
  const fetchSites = scans
    .filter((s) => s.usesFetch)
    .map((s) => s.file.replace(`${process.cwd()}${path.sep}`, ''));

  const unsanctionedFetchSites = fetchSites.filter(
    (file) => !SANCTIONED_FETCH_FILES.some((allowed) => file.endsWith(allowed))
  );

  return {
    ok: trackerHits.length === 0 && badUrls.length === 0 && unsanctionedFetchSites.length === 0,
    filesScanned: scans.length,
    trackerHits,
    badUrls,
    fetchSites,
    unsanctionedFetchSites,
  };
}

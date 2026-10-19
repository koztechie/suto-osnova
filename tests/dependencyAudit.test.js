/**
 * DEPENDENCY AUDIT gate (task 169) — pins the security invariant behind
 * the `npm audit` run so a vulnerable dependency can never slip in
 * unnoticed.
 *
 * THE AUDIT RESULT (recorded in PLAN_STATE): `npm audit` reports 4
 * advisories (2 moderate, 2 high) — ALL inside the DEV-ONLY harness
 * chain `@qloo/qloo-harness` -> `@earendil-works/pi-coding-agent` ->
 * `undici` / `brace-expansion`. `npm audit fix` (non-force) makes NO
 * change (verified: lockfile untouched, still 4) because the undici /
 * pi-coding-agent chain has no upstream fix. CRITICALLY, the
 * PRODUCTION-ONLY audit `npm audit --omit=dev` reports **0
 * vulnerabilities** — the two shipped dependencies
 * (`@modelcontextprotocol/sdk`, `zod`) are clean, and the harness is
 * never deployed (Vercel ships only `dependencies`).
 *
 * WHY THIS GATE: a naive "npm audit must be clean" check would be
 * PERMANENTLY RED for an unfixable, non-shipped dev advisory — a loud
 * but useless signal. The meaningful, STABLE invariant is:
 *   1. the PRODUCTION dependency set is exactly the audited-clean set
 *      (any new prod dependency forces a human to run `npm audit` and
 *      consciously extend the pin);
 *   2. the unfixable harness stays a DEV dependency (it can never be
 *      promoted to production);
 *   3. the lockfile classifies them correctly (a drift that promotes
 *      the harness to prod would be caught — note npm omits the `dev`
 *      flag for production packages and sets `dev: true` only for
 *      dev-only ones);
 *   4. a LIVE `npm audit --omit=dev` still confirms the production tree
 *      is clean whenever the registry is reachable (skipped offline,
 *      where the offline layers above still hold the line).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const pkg = JSON.parse(await readFile(`${ROOT}/package.json`, 'utf8'));
const lock = JSON.parse(await readFile(`${ROOT}/package-lock.json`, 'utf8'));

// The PRODUCTION dependency set as it stood under a clean
// `npm audit --omit=dev`. Adding a prod dependency means updating THIS
// list — a deliberate, reviewed act, not an accident.
const AUDITED_CLEAN_PROD = ['@modelcontextprotocol/sdk', 'zod'];

test('production dependency set is exactly the audited-clean set', () => {
  const prod = Object.keys(pkg.dependencies ?? {}).sort();
  assert.deepEqual(
    prod,
    [...AUDITED_CLEAN_PROD].sort(),
    'a NEW production dependency was added — run `npm audit` and extend AUDITED_CLEAN_PROD consciously'
  );
});

test('the unfixable harness chain stays a DEV dependency (never ships)', () => {
  assert.ok(
    pkg.devDependencies && '@qloo/qloo-harness' in pkg.devDependencies,
    '@qloo/qloo-harness must remain a devDependency'
  );
  assert.ok(
    !('@qloo/qloo-harness' in (pkg.dependencies ?? {})),
    '@qloo/qloo-harness carries unfixable advisories and must never be a production dependency'
  );
});

test('the lockfile classifies prod as non-dev and the harness as dev:true', () => {
  // npm's lockfile only sets `dev: true` for DEV-ONLY packages; a
  // production package OMITS the field (undefined). So "production"
  // means the flag is absent/falsy, never literally `false`.
  for (const name of AUDITED_CLEAN_PROD) {
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.ok(entry, `${name} is pinned in the lockfile`);
    assert.ok(!entry.dev, `${name} must be a production package (no dev flag)`);
  }
  const harness = lock.packages?.['node_modules/@qloo/qloo-harness'];
  assert.ok(harness, 'the harness is pinned in the lockfile');
  assert.equal(harness.dev, true, 'the harness is classified as dev-only');
});

test('LIVE: npm audit --omit=dev reports zero production vulnerabilities', async (t) => {
  let stdout = '';
  try {
    ({ stdout } = await run('npm', ['audit', '--omit=dev', '--json'], {
      cwd: ROOT,
      timeout: 30000,
      // npm writes progress to stderr; capture stdout only (the JSON).
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    // npm audit exits 1 when it FINDS vulnerabilities — parse stdout
    // anyway. A network failure (offline registry) has no JSON: skip.
    stdout = String(error.stdout ?? '');
    if (!stdout.trim().startsWith('{')) {
      t.skip('registry unreachable (offline) — the offline layers still guarantee the prod set');
      return;
    }
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    t.skip('npm audit produced no parseable JSON (offline) — offline layers still hold');
    return;
  }

  const totals = report.metadata?.vulnerabilities ?? {};
  assert.equal(
    totals.total,
    0,
    `production dependencies gained vulnerabilities: ${JSON.stringify(totals)}`
  );
  assert.deepEqual(report.vulnerabilities ?? {}, {}, 'no vulnerable production package');
});

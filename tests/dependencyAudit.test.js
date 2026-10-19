/**
 * DEPENDENCY AUDIT gate (tasks 169-170) — pins the security invariant
 * behind the `npm audit` run so a vulnerable dependency can never slip
 * in unnoticed.
 *
 * THE AUDIT RESULT + REMEDIATION (recorded in PLAN_STATE): the initial
 * `npm audit` reported 4 advisories (2 moderate, 2 high) — ALL inside
 * the DEV-ONLY harness chain `@qloo/qloo-harness` ->
 * `@earendil-works/pi-coding-agent` -> `undici` / `brace-expansion`.
 * The PRODUCTION-ONLY audit `npm audit --omit=dev` reports **0
 * vulnerabilities** (the shipped deps `@modelcontextprotocol/sdk`,
 * `zod` are clean; the harness is never deployed).
 *
 * REMEDIATION (task 170): an npm `overrides` pin of
 * `@earendil-works/pi-coding-agent` to `0.86.0` — the LOWEST version
 * whose DIRECT deps carry the fixed `undici@8.10.2` — durably removed
 * 3 of the 4 advisories (the undici HIGH + the two "via undici"
 * moderates). Verified: undici resolves to 8.10.2, harness compat
 * stays PASS. npm 10.9.7 REFUSES to apply leaf overrides to nested
 * transitive exact-pins, so bumping the declaring parent is the only
 * lever that works.
 *
 * THE ONE RESIDUAL: `brace-expansion@5.0.9` (1 high) cannot be fixed
 * without REGRESSING the harness. The only versions that declare the
 * fixed `brace-expansion@5.0.12` directly are pi-coding-agent 1.0.1+,
 * a MAJOR bump that BREAKS the pinned `@qloo/qloo-harness@0.1.26`
 * (verified: mcp:verify times out, the compat gate fails; there is no
 * newer harness). It is accepted as a DEV-ONLY, non-reachable DoS
 * (brace-expansion parses glob patterns inside the verify tooling; no
 * attacker controls them). Unblock path: a future qloo-harness release
 * supporting pi-coding-agent 1.x — then raise the override to it.
 *
 * WHY THIS GATE: a naive "npm audit must be clean" check would be
 * PERMANENTLY RED for that accepted dev advisory — a loud but useless
 * signal. The meaningful, STABLE invariants are:
 *   1. the PRODUCTION dependency set is exactly the audited-clean set
 *      (any new prod dependency forces a human to run `npm audit` and
 *      consciously extend the pin);
 *   2. the harness stays a DEV dependency (never promoted to production);
 *   3. the lockfile classifies them correctly (note npm omits the `dev`
 *      flag for production packages and sets `dev: true` only for
 *      dev-only ones);
 *   4. the undici FIX is durable: its resolved version is >= 8.10.2 (a
 *      regression back to the vulnerable 8.9.0 is caught);
 *   5. a LIVE `npm audit --omit=dev` still confirms the production tree
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

test('the undici remediation is durable: resolved version is >= 8.10.2', () => {
  // Task 170: the overrides pin of pi-coding-agent@0.86.0 carries the
  // fixed undici. Guard against a regression back to the vulnerable
  // 8.9.0 (the vulnerable range is 8.0.0 - 8.10.1).
  const undiciEntry = Object.entries(lock.packages ?? {})
    .find(([path]) => /\/undici$/.test(path));
  assert.ok(undiciEntry, 'undici is in the lockfile');
  const [, meta] = undiciEntry;
  const [major, minor, patch] = meta.version.split('.').map(Number);
  const fixed = major > 8 || (major === 8 && (minor > 10 || (minor === 10 && patch >= 2)));
  assert.ok(fixed, `undici must be >= 8.10.2 (the fix); resolved ${meta.version}`);

  // The remediation mechanism is declared: the pi-coding-agent override.
  const overrides = pkg.overrides ?? {};
  assert.ok(
    '@earendil-works/pi-coding-agent' in overrides,
    'the pi-coding-agent override that carries the undici fix is present'
  );
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

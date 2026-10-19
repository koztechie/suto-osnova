/**
 * SECRETS AUDIT gate (task 168) — pins, as a permanent check, the
 * `grep` security audit that the PRODUCTION Qloo API key never appears
 * in the FRONTEND.
 *
 * WHY THIS GATE (the gap it closes): the pre-existing
 * tests/clientStructure.test.js check asserted the client files do not
 * contain the IDENTIFIER `QLOO_API_KEY` or the domain `api.qloo.com` —
 * but never the key's actual VALUE. A hardcoded secret would have
 * slipped past it. This gate verifies the VALUE itself (via the exact
 * `grep -rIl -F` audit the task mandates) plus a false-positive-free
 * pattern detector that works even when `.env` is absent.
 *
 * LAYERS (each independent):
 *   1. `.env` is gitignored — the secret cannot be committed;
 *   2. the literal key VALUE appears in ZERO files under client/;
 *   3. the task's literal command — `grep -rIl -F "$KEY" client/` —
 *      returns no file (spawned, output asserted empty);
 *   4. structural: no `QLOO_API_KEY` identifier, no `api.qloo.com`,
 *      and no `X-Api-Key` header construction anywhere in the frontend
 *      (the credential is server-only by architecture);
 *   5. pattern: no hardcoded key-shaped token (>= 20 alphanumerics
 *      inside a 32+ char run) — this holds even WITHOUT `.env`, and
 *      the alnum floor excludes the CSS dash-runs that are the only
 *      long tokens in the client;
 *   6. belt-and-braces: the key value is absent from every GIT-TRACKED
 *      file (`.env` is ignored, so it is the only place it may live).
 *
 * Value-specific checks (2, 3, 6) run as HARD assertions when `.env`
 * is present; when it is absent (a CI without secrets) they report a
 * skip while the structural (4) and pattern (5) layers still provide a
 * real guarantee — the suite never goes vacuously green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT = path.join(ROOT, 'client');

/** The live key value, or null when no `.env` is present. */
async function readLiveKey() {
  try {
    const env = await readFile(path.join(ROOT, '.env'), 'utf8');
    const match = env.match(/^QLOO_API_KEY=(.*)$/m);
    const value = match?.[1]?.trim() ?? '';
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Every file under client/ (recursive), as repo-relative paths. */
async function listClientFiles(dir = CLIENT) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listClientFiles(full));
    } else {
      files.push(path.relative(ROOT, full));
    }
  }
  return files;
}

test('the secret cannot be committed: .env is gitignored', async () => {
  const gitignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  const lines = gitignore.split('\n').map((l) => l.trim());
  assert.ok(
    lines.includes('.env') || lines.includes('/.env'),
    '.gitignore must ignore .env (the API key lives there and nowhere else)'
  );
});

test('the literal key VALUE appears in ZERO frontend files', async (t) => {
  const key = await readLiveKey();
  if (key === null) {
    t.skip('no .env present — the pattern layer below still guarantees no hardcoded key');
    return;
  }
  const files = await listClientFiles();
  const leaked = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    if (text.includes(key)) leaked.push(file);
  }
  assert.deepEqual(leaked, [], `the API key value leaked into: ${leaked.join(', ')}`);
  assert.ok(files.length > 10, `the scan covered the real frontend (${files.length} files)`);
});

test("the task's literal `grep -rIl -F \"$KEY\" client/` returns no file", async (t) => {
  const key = await readLiveKey();
  if (key === null) {
    t.skip('no .env present — cannot run the value grep');
    return;
  }
  // -I skips binaries, -l lists filenames only, -F is a FIXED string
  // (the key is literal, never a regex). grep exits 1 on ZERO matches —
  // the CLEAN case — so an empty stdout (from either exit 0 or 1) means
  // no leak; only a non-empty stdout is a failure.
  let stdout = '';
  try {
    ({ stdout } = await run('grep', ['-rIl', '-F', key, 'client/'], { cwd: ROOT }));
  } catch (error) {
    // Exit code 1 = no matches (clean). Any other code, or a match, fails.
    stdout = String(error.stdout ?? '');
    assert.equal(error.code, 1, `grep failed unexpectedly: ${error.message}`);
  }
  assert.equal(
    stdout.trim(),
    '',
    `grep found the key in: ${stdout.trim().split('\n').filter(Boolean).join(', ')}`
  );
});

test('structural: no key identifier, qloo domain, or X-Api-Key header in the frontend', async () => {
  const files = await listClientFiles();
  const forbidden = /QLOO_API_KEY|api\.qloo\.com|X-Api-Key|x-api-key/i;
  const offenders = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    const match = text.match(forbidden);
    if (match) offenders.push(`${file} -> ${match[0]}`);
  }
  assert.deepEqual(offenders, [],
    'the credential is server-only: the frontend must never name it, the Qloo host, or the header');
});

test('pattern: no hardcoded key-shaped token in the frontend (works without .env)', async () => {
  const files = await listClientFiles();
  // A key-shaped token: a 32+ char run containing >= 20 ALPHANUMERICS.
  // The alnum floor excludes the CSS dash-separators (0 alnum) that are
  // the only long runs in the client, so this cannot false-positive.
  const keyShaped = /[A-Za-z0-9_-]{32,}/g;
  const offenders = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(keyShaped)) {
      const token = match[0];
      const alnum = token.replace(/[^A-Za-z0-9]/g, '');
      if (alnum.length >= 20) offenders.push(`${file} -> ${token.slice(0, 12)}…`);
    }
  }
  assert.deepEqual(offenders, [],
    'a key-shaped literal in the frontend would be a hardcoded secret');
});

test('belt-and-braces: the key value is in no GIT-TRACKED file', async (t) => {
  const key = await readLiveKey();
  if (key === null) {
    t.skip('no .env present — cannot grep for the value');
    return;
  }
  // git grep -IF: fixed-string, include-binary-safe, across tracked files.
  // `.env` is ignored so it is never tracked; any hit is a real leak.
  try {
    const { stdout } = await run('git', ['grep', '-IF', key, '--', '.'], { cwd: ROOT });
    assert.equal(stdout.trim(), '', `the key is tracked in: ${stdout.trim()}`);
  } catch (error) {
    // `git grep` exits 1 when there are NO matches — the clean case.
    assert.ok(
      error.code === 1 && !String(error.stdout ?? '').trim(),
      `git grep errored unexpectedly: ${error.message}`
    );
  }
});

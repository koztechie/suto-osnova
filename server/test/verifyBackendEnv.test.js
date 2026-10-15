import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '../../scripts/verify_backend_env.js');

// node:test files are ESM; mkdtemp via imports (no require).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const cacheDir = await mkdtemp(path.join(tmpdir(), 'env-verify-'));

function runEnv(overrides, args = []) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      QLOO_API_KEY: 'verify-key-12345678',
      QLOO_CACHE_DIR: cacheDir,
      ...overrides,
    },
  });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

test('valid environment: exit 0 with a full PASS report', () => {
  const { status, out } = runEnv({ MOCK_MODE: 'true' });
  assert.equal(status, 0, out);
  assert.match(out, /PASS env schema/);
  assert.match(out, /PASS QLOO_API_KEY — set \(19 chars, value not shown\)/);
  assert.match(out, /PASS QLOO_CACHE_DIR — writable/);
  assert.match(out, /PASS gitignore — \.env is ignored by git/);
  assert.match(out, /PASS MOCK_MODE — true — requests served from recorded fixtures/);
  assert.match(out, /PASS qloo probe — skipped/);
  assert.match(out, /CONFIGURATION: PASS \(0 failure\(s\), 0 warning\(s\)\)/);
  assert.ok(!out.includes('verify-key-12345678'), 'key value never printed');
});

test('placeholder key is a FAILURE, not a pass', () => {
  const { status, out } = runEnv({ QLOO_API_KEY: 'your_qloo_hackathon_api_key_here' });
  assert.equal(status, 1);
  assert.match(out, /FAIL QLOO_API_KEY — still the \.env\.example placeholder/);
  assert.match(out, /CONFIGURATION: FAIL/);
});

test('whitespace inside the key is a FAILURE', () => {
  const { status, out } = runEnv({ QLOO_API_KEY: 'abc\ndef' });
  assert.equal(status, 1);
  assert.match(out, /FAIL QLOO_API_KEY — contains whitespace/);
});

test('schema violations are reported per field with exit 1', () => {
  const bad = runEnv({ LOG_LEVEL: 'shout' });
  assert.equal(bad.status, 1);
  assert.match(bad.out, /FAIL env\.LOG_LEVEL/);

  const ttl = runEnv({ QLOO_CACHE_TTL_MS: '300000', QLOO_CACHE_TTL_ENTITIES_MS: '1000' });
  assert.equal(ttl.status, 1);
  assert.match(ttl.out, /FAIL env\.QLOO_CACHE_TTL_ENTITIES_MS — must be >= QLOO_CACHE_TTL_MS/);
  assert.match(ttl.out, /CONFIGURATION: FAIL/);
});

test('http base URL warns but does not fail', () => {
  const { status, out } = runEnv({
    MOCK_MODE: 'true',
    QLOO_BASE_URL: 'http://example.invalid',
  });
  assert.equal(status, 0, out);
  assert.match(out, /WARN QLOO_BASE_URL — not https/);
  assert.match(out, /CONFIGURATION: PASS \(0 failure\(s\), 1 warning\(s\)\)/);
});

test('out-of-range PORT is a FAILURE', () => {
  const { status, out } = runEnv({ PORT: '99999' });
  assert.equal(status, 1);
  assert.match(out, /FAIL PORT — 99999 outside the valid TCP port range/);
});

test('--probe verifies live credentials (unreachable host fails)', () => {
  const { status, out } = runEnv(
    { QLOO_BASE_URL: 'http://127.0.0.1:9' },
    ['--probe']
  );
  assert.equal(status, 1, out);
  assert.match(out, /FAIL qloo probe/);
  assert.match(out, /CONFIGURATION: FAIL/);
});

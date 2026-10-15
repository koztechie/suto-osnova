import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envModule = path.join(here, '../src/config/env.js');

/**
 * Spawns a fresh process that loads the real env schema with the given
 * overrides, so cross-field validation is tested end-to-end.
 */
function loadEnv(overrides) {
  const script =
    `import { env } from ${JSON.stringify(envModule)};` +
    `console.log(JSON.stringify(env));`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      QLOO_API_KEY: 'test-key',
      ...overrides,
    },
  });
}

test('entity TTL defaults to 24h and general TTL to 5min', () => {
  const res = loadEnv({});
  assert.equal(res.status, 0, res.stderr);

  const env = JSON.parse(res.stdout.trim().split('\n').at(-1));
  assert.equal(env.QLOO_CACHE_TTL_MS, 300_000);
  assert.equal(env.QLOO_CACHE_TTL_ENTITIES_MS, 86_400_000, 'exactly 24 hours');
});

test('rejects entity TTL shorter than the general TTL', () => {
  const res = loadEnv({
    QLOO_CACHE_TTL_MS: '300000',
    QLOO_CACHE_TTL_ENTITIES_MS: '1000',
  });

  assert.notEqual(res.status, 0, 'invalid TTL combination must exit non-zero');
  assert.match(res.stderr, /QLOO_CACHE_TTL_ENTITIES_MS/);
  assert.match(res.stderr, /must be >= QLOO_CACHE_TTL_MS/);
});

test('accepts a custom 24h-equivalent configuration', () => {
  const res = loadEnv({
    QLOO_CACHE_TTL_MS: '60000',
    QLOO_CACHE_TTL_ENTITIES_MS: '86400000',
  });

  assert.equal(res.status, 0, res.stderr);
  const env = JSON.parse(res.stdout.trim().split('\n').at(-1));
  assert.equal(env.QLOO_CACHE_TTL_ENTITIES_MS, 86_400_000);
});

test('rejects non-numeric or negative entity TTL values', () => {
  for (const bad of ['-1', 'abc', '1.5']) {
    const res = loadEnv({ QLOO_CACHE_TTL_ENTITIES_MS: bad });
    assert.notEqual(res.status, 0, `value ${bad} must be rejected`);
  }
});

/**
 * Repo hygiene rules (task 194) — pins the predicate behind
 * scripts/verifyRepoHygiene.mjs so the "no test screenshots/logs in the
 * repository" contract is enforced OFFLINE (the gate itself shells out to
 * git and stays standalone like stress-test.js; its RULES live here,
 * pure and deterministic).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isForbiddenArtifact, TRACKED_MEDIA_OK } = await import(
  '../../scripts/verifyRepoHygiene.mjs'
);

test('the app launch media is the only allowed tracked media', () => {
  assert.deepEqual([...TRACKED_MEDIA_OK].sort(), [
    'client/public/favicon.ico',
    'client/public/favicon.svg',
    'client/public/social-card.png',
  ]);
  for (const f of TRACKED_MEDIA_OK) {
    assert.equal(isForbiddenArtifact(f), false, `${f} must stay allowed`);
  }
  assert.equal(isForbiddenArtifact('client/public/robots.txt'), false, 'a text asset is fine');
});

test('test screenshots / recordings are forbidden outside client/public', () => {
  assert.equal(isForbiddenArtifact('screenshots/home-desktop.png'), true);
  assert.equal(isForbiddenArtifact('tests/verify.screen.png'), true);
  assert.equal(isForbiddenArtifact('artifacts/mobile-capture.jpeg'), true);
  assert.equal(isForbiddenArtifact('debug/frame.webp'), true);
  assert.equal(isForbiddenArtifact('session.mp4'), true);
});

test('logs of every flavour are forbidden', () => {
  assert.equal(isForbiddenArtifact('server.log'), true);
  assert.equal(isForbiddenArtifact('logs/netlify-deploy.log'), true);
  assert.equal(isForbiddenArtifact('npm-debug.log'), true);
  assert.equal(isForbiddenArtifact('packages/yarn-error.log'), true);
});

test('profiling / trace artifacts are forbidden', () => {
  for (const f of [
    'trace.har', 'prof.cpuprofile', 'mem.heapprofile', 'heap.heapsnapshot',
    'run.trace', 'coverage.lcov', 'build.out', 'scratch.tmp',
  ]) {
    assert.equal(isForbiddenArtifact(f), true, f);
  }
});

test('files under test-output directories are forbidden', () => {
  for (const f of [
    'coverage/lcov.info', 'test-results/report.json', 'playwright-report/index.html',
    'logs/run.txt', '.cache/qloo/abc.json', 'build/memory.json', 'dist/assets/app.js',
    '.netlify/functions-serve/api.mjs',
  ]) {
    assert.equal(isForbiddenArtifact(f), true, f);
  }
});

test('screenshot/debug NAMES are forbidden anywhere', () => {
  assert.equal(isForbiddenArtifact('docs/screenshot-of-bug.png'), true);
  assert.equal(isForbiddenArtifact('notes/screenshot.md'), true);
  assert.equal(isForbiddenArtifact('scripts/npm-debug-note.js'), true);
});

test('ordinary source/docs never trip the rules', () => {
  for (const f of [
    'server/src/app.js', 'server/test/generateRoute.test.js', 'client/src/js/api.js',
    'docs/HOSTING_STABILITY.md', 'tests/hosting-stability.js', 'PLAN_STATE.md',
    'netlify.toml', 'package.json', '.gitignore', 'scripts/verifyRepoHygiene.mjs',
  ]) {
    assert.equal(isForbiddenArtifact(f), false, f);
  }
});

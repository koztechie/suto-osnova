/**
 * REPO HYGIENE GATE (task 194) — fails when test screenshots, logs or
 * profiling artifacts are TRACKED anywhere in the repository. The only
 * tracked media are the app's own launch assets in client/public
 * (favicon.ico / favicon.svg / social-card.png).
 *
 * Standalone (like stress-test.js / hosting-stability.js) and CI-safe:
 *
 *   node scripts/verifyRepoHygiene.mjs     # exit 0 = clean, 1 = polluted
 *
 * It scans `git ls-files` (the repository proper — untracked local work
 * such as the user's dossiers in tests/results/ is out of scope by
 * design) and rejects:
 *   - media/video files outside the allow-list (screenshots, recordings);
 *   - any *.log (npm/yarn/pnpm-debug included);
 *   - profiling/trace artifacts (.har, .cpuprofile, .heapsnapshot, …);
 *   - files under test-output dirs (screenshots/, test-results/,
 *     playwright-report/, coverage/, logs/, .cache/, build/, dist/,
 *     .netlify/);
 *   - anything named like a screenshot/debug capture.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The ONLY media the repository is allowed to carry. */
export const TRACKED_MEDIA_OK = new Set([
  'client/public/favicon.ico',
  'client/public/favicon.svg',
  'client/public/social-card.png',
]);

const MEDIA = /\.(png|jpe?g|gif|webp|bmp|tiff?|webm|mp4|mov|avi|flac|wav)$/i;
const LOG = /[^/]*\.log$/i;
const PROFILING = /\.(har|cpuprofile|heapprofile|heapsnapshot|trace|lcov|out|tmp)$/i;
const DIRS = /(^|\/)(screenshots|test-results|playwright-report|coverage|logs|\.cache|build|dist|\.netlify)\//;
const NAMED = /(^|\/)(npm-debug|yarn-debug|yarn-error|pnpm-debug)[^/]*$|screenshot/i;

/**
 * Pure predicate: is this tracked path a forbidden test artifact?
 * Exported so the rules are unit-testable without git.
 */
export function isForbiddenArtifact(file) {
  if (TRACKED_MEDIA_OK.has(file)) return false;
  return MEDIA.test(file) || LOG.test(file) || PROFILING.test(file) ||
    DIRS.test(file) || NAMED.test(file);
}

/** Why a file was flagged (for the failure report). */
function reason(file) {
  if (LOG.test(file)) return 'log';
  if (MEDIA.test(file)) return 'media (outside client/public)';
  if (PROFILING.test(file)) return 'profiling/trace artifact';
  if (DIRS.test(file)) return 'test-output directory';
  if (NAMED.test(file)) return 'screenshot/debug name';
  return 'unknown';
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch (err) {
    console.error(`not a git repository (or git unavailable): ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const files = trackedFiles();
  const bad = files.filter((f) => isForbiddenArtifact(f));
  const allowedMedia = files.filter((f) => TRACKED_MEDIA_OK.has(f));

  console.log(`repo hygiene scan — ${files.length} tracked files`);
  console.log(`allowed app media (${allowedMedia.length}):`);
  for (const f of allowedMedia) console.log(`  keep  ${f}`);

  if (bad.length === 0) {
    console.log('CLEAN — no test screenshots, logs or profiling artifacts are tracked.');
    return 0;
  }
  console.log(`POLLUTED — ${bad.length} forbidden tracked file(s):`);
  for (const f of bad) console.log(`  ${reason(f).padEnd(30)} ${f}`);
  console.log('remove with `git rm --cached <file>` (and delete the artifact).');
  return 1;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());

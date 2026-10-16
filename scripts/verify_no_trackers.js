/**
 * CLI verifier: NO THIRD-PARTY TRACKERS (task 77) — prints one PASS
 * line per audit check and exits non-zero on any finding, matching the
 * repo's verify:* script conventions. The audit logic lives in
 * scripts/lib/trackerAudit.js (shared with server/test/noTrackers.test.js).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  auditDependencies,
  auditLockfile,
  auditDevPackages,
  auditSourceTree,
  RUNTIME_DEPENDENCY_ALLOWLIST,
  ALLOWED_URL_HOSTS,
  SANCTIONED_FETCH_FILES,
} from './lib/trackerAudit.js';

const root = process.cwd();
let failed = false;
const pass = (line) => console.log(`PASS ${line}`);
const fail = (line, detail) => {
  failed = true;
  console.error(`FAIL ${line}`);
  if (detail) console.error(JSON.stringify(detail, null, 2));
};

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

// Check 1: runtime dependencies.
const deps = auditDependencies(pkg);
if (deps.ok) {
  pass(`RUNTIME DEPENDENCIES — exactly the sanctioned set (${deps.deps.join(', ')})`);
} else {
  fail('RUNTIME DEPENDENCIES — unexpected entries', deps.unexpected);
}

// Check 2: production transitives + dev tooling.
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const prod = auditLockfile(lock);
if (prod.ok) {
  pass(`PRODUCTION TREE — ${prod.audited} packages, zero tracker SDKs`);
} else {
  fail('PRODUCTION TREE — tracker packages found', prod.findings);
}
const dev = auditDevPackages(pkg);
if (dev.ok) {
  pass('DEV TOOLING — zero tracker SDKs');
} else {
  fail('DEV TOOLING — tracker packages found', dev.findings);
}

// Check 3: source scan.
const source = await auditSourceTree(path.join(root, 'server/src'));
if (source.ok) {
  pass(
    `SOURCE SCAN — ${source.filesScanned} files, zero tracker patterns, ` +
      `all hosts allowlisted, fetch() only in ${SANCTIONED_FETCH_FILES.length} sanctioned transports`
  );
} else {
  if (source.trackerHits.length > 0) fail('SOURCE SCAN — tracker patterns', source.trackerHits);
  if (source.badUrls.length > 0) fail('SOURCE SCAN — non-allowlisted URL hosts', source.badUrls);
  if (source.unsanctionedFetchSites.length > 0) {
    fail('SOURCE SCAN — unsanctioned fetch() call sites', source.unsanctionedFetchSites);
  }
}

// The allowlist audit trail.
console.log(
  `INFO allowlisted hosts: ${Object.entries(ALLOWED_URL_HOSTS)
    .map(([host, reason]) => `${host} (${reason})`)
    .join('; ')}`
);

if (failed) {
  console.error('VERIFY: FAIL — third-party tracker compliance violated');
  process.exit(1);
}
console.log('VERIFY: PASS — no third-party trackers in dependencies, source or transports');

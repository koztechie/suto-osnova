/**
 * Package version reader — deliberately FREE of node:crypto (which the
 * contract checksum needs but a health report does not): importing
 * node:crypto costs ~2.8MB resident on first use (measured, task 38),
 * so the HTTP health path reads the version through this light module
 * (fs+path only, lazy-imported) instead of pulling the whole
 * contract.js graph.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let cached;

export function readVersion() {
  // Memoized: the health path runs this per poll; parsing package.json
  // every time is pure churn (task 38).
  if (cached !== undefined) return cached;
  try {
    cached =
      JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8'))
        .version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

export default readVersion;

#!/usr/bin/env node
/**
 * Backend configuration verifier (task 37).
 *
 * Run:  node scripts/verify_backend_env.js [--probe]
 *   or: npm run verify:env [-- --probe]
 *
 * Validates the backend environment in TWO layers:
 *   1. the exact zod schema the server boots with (envSchema.js — the
 *      pure module, so the verifier renders a FULL report of every
 *      problem instead of the runtime's exit-on-first-failure path);
 *   2. semantic checks the schema cannot express: placeholder keys,
 *      key hygiene, https transport, port range, cache-directory
 *      writability, .env gitignore coverage, runtime-mode summary.
 *
 * `--probe` additionally verifies the Qloo credential LIVE (documented
 * GET /, 5s bound) — opt-in so the default run is deterministic and
 * network-free (CI-safe).
 *
 * Output: one PASS/WARN/FAIL line per check on stdout, a summary, and
 * exit code 0 (no failures) / 1 (at least one failure). Prints NO
 * secret values — only lengths and shapes.
 */

import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envSchema } from '../server/src/config/envSchema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** The literal placeholder shipped in .env.example — never a real key. */
const PLACEHOLDER_KEY = 'your_qloo_hackathon_api_key_here';

const probeRequested = process.argv.includes('--probe');
const results = [];
const pass = (name, detail = '') => results.push({ level: 'PASS', name, detail });
const warn = (name, detail = '') => results.push({ level: 'WARN', name, detail });
const fail = (name, detail = '') => results.push({ level: 'FAIL', name, detail });

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// --- layer 1: the boot schema ------------------------------------------------

const parsed = envSchema.safeParse(process.env);
let cfg = null;

if (parsed.success) {
  cfg = parsed.data;
  pass('env schema', 'all fields valid (defaults applied where unset)');
  pass('ttl invariants', 'entity TTL >= general TTL');
} else {
  for (const issue of parsed.error.issues) {
    fail(`env.${issue.path.join('.') || '(root)'}`, issue.message);
  }
}

// --- layer 2: semantic checks ---------------------------------------------------

if (cfg) {
  // API key hygiene: value is never printed, only its shape.
  const key = cfg.QLOO_API_KEY;
  if (key === PLACEHOLDER_KEY) {
    fail(
      'QLOO_API_KEY',
      'still the .env.example placeholder — set the real hackathon key'
    );
  } else {
    pass('QLOO_API_KEY', `set (${key.length} chars, value not shown)`);
  }
  if (/\s/.test(key)) {
    fail('QLOO_API_KEY', 'contains whitespace/newlines — copy-paste artifact');
  }

  // Transport.
  if (cfg.QLOO_BASE_URL.startsWith('https://')) {
    pass('QLOO_BASE_URL', cfg.QLOO_BASE_URL);
  } else {
    warn(
      'QLOO_BASE_URL',
      `not https (${cfg.QLOO_BASE_URL}) — credentials travel unencrypted`
    );
  }

  // Port range (the schema coerces any number; the OS range is checked here).
  if (Number.isInteger(cfg.PORT) && cfg.PORT >= 1 && cfg.PORT <= 65535) {
    pass('PORT', String(cfg.PORT));
  } else {
    fail('PORT', `${cfg.PORT} outside the valid TCP port range 1..65535`);
  }

  // Cache directory: must be creatable AND writable at boot.
  try {
    await mkdir(cfg.QLOO_CACHE_DIR, { recursive: true });
    const probeFile = path.join(cfg.QLOO_CACHE_DIR, '.env-verify-probe');
    await writeFile(probeFile, 'ok');
    await rm(probeFile);
    pass('QLOO_CACHE_DIR', `writable (${cfg.QLOO_CACHE_DIR})`);
  } catch (err) {
    fail('QLOO_CACHE_DIR', `not writable: ${err.message}`.slice(0, 140));
  }

  // .env must never reach git.
  try {
    const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    const coversEnv = gitignore
      .split('\n')
      .some((line) => /^\/?\.env(\*|\.local)?$/.test(line.trim()));
    if (coversEnv) {
      pass('gitignore', '.env is ignored by git');
    } else {
      warn('gitignore', '.env is NOT listed in .gitignore — secrets could be committed');
    }
  } catch {
    warn('gitignore', '.gitignore not found — cannot confirm .env is ignored');
  }

  // Runtime-mode summary (informational clarity, not a defect).
  if (cfg.MOCK_MODE) {
    pass('MOCK_MODE', 'true — requests served from recorded fixtures, no key quota');
  } else {
    pass('MOCK_MODE', 'false — live Qloo traffic (rate limited, cached)');
  }
  pass('LOG_LEVEL', cfg.LOG_LEVEL);
  pass('NODE_ENV', cfg.NODE_ENV);

  // --- optional live credential probe ------------------------------------
  if (probeRequested) {
    const started = Date.now();
    try {
      const res = await fetch(new URL('/', cfg.QLOO_BASE_URL), {
        headers: { 'X-Api-Key': cfg.QLOO_API_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        pass('qloo probe', `HTTP ${res.status} in ${Date.now() - started}ms`);
      } else {
        fail('qloo probe', `HTTP ${res.status} ${res.statusText}`.slice(0, 140));
      }
    } catch (err) {
      fail('qloo probe', `${err.name}: ${err.message}`.slice(0, 140));
    }
  } else {
    pass('qloo probe', 'skipped — run with --probe to verify live credentials');
  }
}

// --- report ----------------------------------------------------------------------

for (const r of results) {
  process.stdout.write(
    `${r.level.padEnd(4)} ${r.name}${r.detail ? ` — ${r.detail}` : ''}\n`
  );
}

const failures = results.filter((r) => r.level === 'FAIL').length;
const warnings = results.filter((r) => r.level === 'WARN').length;
process.stdout.write(
  `\n${failures === 0 ? 'CONFIGURATION: PASS' : 'CONFIGURATION: FAIL'} ` +
    `(${failures} failure(s), ${warnings} warning(s))\n`
);
process.exit(failures === 0 ? 0 : 1);

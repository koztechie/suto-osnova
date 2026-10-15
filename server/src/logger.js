/**
 * System event logger: one laconic line per event, always on STDERR
 * (stdout stays reserved for protocol/machine output — MCP stdio
 * depends on this discipline, task 28).
 *
 * Format: `<ISO-ts> <LEVEL> [scope] message {json-fields}`
 *   2026-10-15T17:30:00.000Z WARN  [qloo] transient failure {...}
 *
 * SECRET REDACTION (the task's core guarantee): every line passes
 * scrubSecrets() before hitting the sink —
 *   - the configured QLOO_API_KEY value, wherever it appears;
 *   - `X-Api-Key: <value>` header-style occurrences;
 *   - `Bearer <token>` occurrences;
 *   - JSON fields named api_key/token/secret/password.
 * The key is read LAZILY from process.env at write time (no module
 * coupling: logger imports nothing from the project, so even env.js can
 * log during its own module initialization without cycles).
 *
 * Level: LOG_LEVEL = debug|info|warn|error|silent (default info;
 * invalid values fall back to info — the env schema validates the
 * canonical value separately). In NODE_ENV=test the default is 'error'
 * so test output stays quiet unless a test opts in.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  const raw = process.env.LOG_LEVEL;
  if (raw && Object.hasOwn(LEVELS, raw)) return LEVELS[raw];
  if (process.env.NODE_ENV === 'test') return LEVELS.error;
  return LEVELS.info;
}

const defaultSink = (line) => {
  process.stderr.write(line + '\n');
};
let sink = defaultSink;

/**
 * Manual UTC ISO-8601 timestamp (ms precision). `new Date().toISOString()`
 * lazily initializes ~1MB of date-formatting machinery on first use
 * (measured, task 38); plain arithmetic over Date.now() costs nothing
 * and this logger's format never leaves UTC.
 */
export function isoNow() {
  const d = Date.now();
  const t = new Date(d);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
    `T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}` +
    `.${p(t.getUTCMilliseconds(), 3)}Z`
  );
}

/** Test hook: capture lines instead of writing to stderr. */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : defaultSink;
}

/** Test hook: restore the default stderr sink. */
export function resetSink() {
  sink = defaultSink;
}

/**
 * Scrubs secrets from a log line. Exported for direct testing.
 */
export function scrubSecrets(line) {
  let out = String(line);

  // 1. The configured API key, wherever it was interpolated.
  const key = process.env.QLOO_API_KEY;
  if (key && key.length >= 8) {
    out = out.split(key).join('[REDACTED]');
  }
  // 2. Header-style occurrences.
  out = out.replace(/(x-api-key["':=\s]*)([^\s"',}]+)/gi, '$1[REDACTED]');
  out = out.replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]');
  // 3. JSON fields named like secrets — both plain ("token":"v") and
  //    escaped forms (when a JSON string was logged inside a field).
  out = out.replace(
    /(\\*"(?:api[_-]?key|apikey|token|secret|password)\\*"\s*:\s*\\*")((?:[^"\\]|\\.)+?)(\\*")/gi,
    '$1[REDACTED]$3'
  );
  return out;
}

function write(levelName, scope, message, fields) {
  if (LEVELS[levelName] < currentLevel()) return;

  let line =
    `${isoNow()} ${levelName.toUpperCase().padEnd(5)} ` +
    `[${scope}] ${message}`;
  if (fields !== undefined) {
    try {
      line += ` ${JSON.stringify(fields)}`;
    } catch {
      line += ' [unserializable fields]';
    }
  }
  sink(scrubSecrets(line));
}

/** Creates a scoped logger: `createLogger('qloo').warn(msg, fields)`. */
export function createLogger(scope) {
  const at = (level) => (message, fields) => write(level, scope, message, fields);
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

/** Root logger for quick use: `logger.info('...')`. */
export const logger = createLogger('app');

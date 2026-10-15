/**
 * Pure env schema — ZERO-DEPENDENCY validator with the exact zod-style
 * contract: `envSchema.safeParse(process.env)` ->
 *   { success: true, data }  |
 *   { success: false, error: { issues: [{ path, message }] } }.
 *
 * Why not zod here (task 38, measured on this project): zod classic
 * costs ~12MB of SETTLED RSS — bare http server 53.1MB + zod/env 65.2MB
 * — which alone blows the 60MB base-server budget; the zod/v4/mini
 * variant changes the API (not a drop-in) and saves only ~1.4MB. Zod
 * REMAINS a dependency and is still used by the MCP tool schemas
 * (server/src/mcp/tools.js — a separate process from the HTTP server).
 *
 * The contract is pinned by tests: server/test/envTtl.test.js (defaults,
 * cross-field TTL message), server/test/verifyBackendEnv.test.js (per-
 * field issue reporting), server/test/logger.test.js (failure path).
 */

const DEFAULTS = {
  QLOO_BASE_URL: 'https://hackathon.api.qloo.com',
  QLOO_RATE_LIMIT: 5,
  QLOO_RATE_WINDOW_MS: 1000,
  QLOO_MAX_CONCURRENCY: 2,
  QLOO_RATE_QUEUE_MAX: 50,
  QLOO_MAX_RETRIES: 2,
  QLOO_RETRY_BASE_MS: 500,
  QLOO_RETRY_MAX_MS: 30_000,
  QLOO_CACHE_ENABLED: 'true',
  QLOO_CACHE_TTL_MS: 300_000,
  QLOO_CACHE_TTL_ENTITIES_MS: 86_400_000,
  QLOO_CACHE_DIR: '.cache/qloo',
  QLOO_CACHE_MAX_ENTRIES: 500,
  MOCK_MODE: 'false',
  PORT: 3000,
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
};

function parseNumber(raw, { min, int, field, issues }) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    issues.push({ path: [field], message: 'Expected a finite number' });
    return undefined;
  }
  if (int && !Number.isInteger(value)) {
    issues.push({ path: [field], message: 'Expected an integer' });
    return undefined;
  }
  if (min !== undefined && value < min) {
    issues.push({ path: [field], message: `Must be >= ${min}` });
    return undefined;
  }
  return value;
}

function parseEnum(raw, values, { field, issues }) {
  if (values.includes(raw)) return raw;
  issues.push({
    path: [field],
    message: `Invalid value: expected one of ${values.join(', ')}`,
  });
  return undefined;
}

export const envSchema = {
  safeParse(source) {
    const issues = [];
    const data = {};

    // QLOO_API_KEY: required, non-empty string.
    const apiKey = source.QLOO_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length < 1) {
      issues.push({ path: ['QLOO_API_KEY'], message: 'QLOO_API_KEY is required' });
    } else {
      data.QLOO_API_KEY = apiKey;
    }

    // QLOO_BASE_URL: URL or default.
    const baseUrl = source.QLOO_BASE_URL ?? DEFAULTS.QLOO_BASE_URL;
    try {
      new URL(baseUrl);
      data.QLOO_BASE_URL = baseUrl;
    } catch {
      issues.push({ path: ['QLOO_BASE_URL'], message: 'Invalid URL' });
    }

    // Numeric fields (string->number coercion, mirroring z.coerce.number()).
    const numeric = [
      ['QLOO_RATE_LIMIT', { min: 1, int: true }],
      ['QLOO_RATE_WINDOW_MS', { min: 1, int: true }],
      ['QLOO_MAX_CONCURRENCY', { min: 1, int: true }],
      ['QLOO_RATE_QUEUE_MAX', { min: 1, int: true }],
      ['QLOO_MAX_RETRIES', { min: 0, int: true }],
      ['QLOO_RETRY_BASE_MS', { min: 1, int: true }],
      ['QLOO_RETRY_MAX_MS', { min: 1, int: true }],
      ['QLOO_CACHE_TTL_MS', { min: 0, int: true }],
      ['QLOO_CACHE_TTL_ENTITIES_MS', { min: 0, int: true }],
      ['QLOO_CACHE_MAX_ENTRIES', { min: 1, int: true }],
      ['PORT', {}],
    ];
    for (const [field, opts] of numeric) {
      const raw = source[field] ?? String(DEFAULTS[field]);
      const value = parseNumber(raw, { ...opts, field, issues });
      if (value !== undefined) data[field] = value;
    }

    // Enum + boolean transform (the string "false" must mean false).
    for (const [field, values, transform] of [
      ['QLOO_CACHE_ENABLED', ['true', 'false'], true],
      ['MOCK_MODE', ['true', 'false'], true],
    ]) {
      const raw = source[field] ?? DEFAULTS[field];
      const value = parseEnum(raw, values, { field, issues });
      if (value !== undefined) data[field] = transform ? value === 'true' : value;
    }

    data.NODE_ENV = parseEnum(source.NODE_ENV ?? DEFAULTS.NODE_ENV,
      ['development', 'production', 'test'], { field: 'NODE_ENV', issues }) ?? data.NODE_ENV;
    data.LOG_LEVEL = parseEnum(source.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL,
      ['debug', 'info', 'warn', 'error', 'silent'], { field: 'LOG_LEVEL', issues }) ?? data.LOG_LEVEL;

    // Free-form strings with defaults.
    data.QLOO_CACHE_DIR = source.QLOO_CACHE_DIR ?? DEFAULTS.QLOO_CACHE_DIR;
    if (typeof data.QLOO_CACHE_DIR !== 'string' || data.QLOO_CACHE_DIR.length < 1) {
      issues.push({ path: ['QLOO_CACHE_DIR'], message: 'Must be a non-empty string' });
    }

    // Cross-field TTL validation: entity/tag reference data is relatively
    // static, so its lifetime must not be shorter than the general TTL —
    // otherwise the "long-lived" tier would silently expire first.
    if (
      data.QLOO_CACHE_TTL_ENTITIES_MS !== undefined &&
      data.QLOO_CACHE_TTL_MS !== undefined &&
      data.QLOO_CACHE_TTL_ENTITIES_MS < data.QLOO_CACHE_TTL_MS
    ) {
      issues.push({
        path: ['QLOO_CACHE_TTL_ENTITIES_MS'],
        message:
          `must be >= QLOO_CACHE_TTL_MS ` +
          `(${data.QLOO_CACHE_TTL_ENTITIES_MS} < ${data.QLOO_CACHE_TTL_MS}): ` +
          'entity/tag entries must outlive general cache entries',
      });
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data };
  },
};

export default envSchema;

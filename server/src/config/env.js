/**
 * Runtime env entrypoint: parses the pure schema (envSchema.js) once at
 * module load; invalid configuration is logged (secret-redacting
 * logger) and the process exits — nothing downstream ever sees a
 * partially valid config. Verifiers import envSchema.js directly to get
 * a full report instead of an exit (scripts/verify_backend_env.js).
 */

import { envSchema } from './envSchema.js';
import { createLogger } from '../logger.js';

const log = createLogger('env');

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger reads raw process.env (no coupling) and redacts any
  // interpolated secrets; invalid config may lack LOG_LEVEL, so the
  // logger falls back to its own defaults.
  log.error('invalid environment configuration', {
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
  process.exit(1);
}

export const env = parsed.data;
export default env;

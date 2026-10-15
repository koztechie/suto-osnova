/**
 * Server contract metadata: the same discoverability conventions the
 * official qloo-harness canonical adapter uses (verified live against
 * `qloo mcp`, 2026-10-15):
 * - a `qloo_capabilities` tool exposing contract version + SHA-256
 *   checksum WITHOUT contacting Qloo;
 * - a `qloo://contracts/*` resource with the identical payload.
 *
 * Kept separate from server.js/tools.js so both can import it without
 * cycles. Tool names are collected at registration time; payloads are
 * built lazily at call time (fully registered by then).
 */

import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { readVersion } from '../version.js';

// Back-compat re-export: mcp/server.js and others import readVersion
// from here; the implementation lives in the crypto-free version.js so
// the HTTP health path never pays for node:crypto (task 38).
export { readVersion };

/** Bump when the tool/resource surface changes incompatibly. */
export const CONTRACT_VERSION = '1.0.0';

const toolNames = new Set();

/** Records a registered tool name (called by the registration layer). */
export function noteTool(name) {
  toolNames.add(name);
}

/** Sorted snapshot of every tool name registered on this process. */
export function registeredToolNames() {
  return [...toolNames].sort();
}

/**
 * The offline contract payload served by `qloo_capabilities` and
 * `qloo://contracts/suto-osnova`. The checksum covers version +
 * contract version + the sorted tool list: clients can detect changes
 * exactly like the harness workflow contract does.
 */
export function buildContractPayload() {
  const names = registeredToolNames();
  const core = {
    server: 'suto-osnova',
    version: readVersion(),
    contractVersion: CONTRACT_VERSION,
    transport: 'stdio',
    mockMode: env.MOCK_MODE,
    tools: { count: names.length, names },
    resources: {
      static: ['qloo://domains', 'qloo://contracts/suto-osnova'],
      templates: [
        'qloo://domains/{domain}',
        'qloo://entity/{id}',
        'qloo://tags/{tag}',
        'qloo://audiences/{audience}',
      ],
    },
  };
  const checksum = createHash('sha256')
    .update(JSON.stringify({ version: core.version, contractVersion: CONTRACT_VERSION, names }))
    .digest('hex');
  return { ...core, checksum };
}

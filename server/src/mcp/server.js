/**
 * Model Context Protocol server for SUTO OSNOVA.
 *
 * Exposes the project's verified Qloo capabilities (tasks 20-27) over
 * MCP's stdio transport so any MCP client (Claude, OpenCode, custom
 * agents) can drive the agent's cultural-intelligence stack. Built on
 * the official @modelcontextprotocol/sdk (already a project dependency,
 * zod v4 compatible).
 *
 * Tool surface (see tools.js): search_entities, find_tags,
 * get_cross_domain_affinities, get_audience_insights, search_audiences,
 * group_entities_by_domain (local), detect_personal_data (local).
 *
 * Transport stack behind every network tool: X-Api-Key, rate limiting,
 * retries, two-tier cache, single-flight, the unconditional privacy
 * guard and MOCK_MODE fixtures — the server works identically offline
 * with MOCK_MODE=true (no key quota consumed).
 *
 * Run:
 *   npm run mcp                    # node --env-file=.env server/src/mcp/server.js
 * MCP client config (stdio):
 *   { "mcpServers": { "suto-osnova": {
 *       "command": "node",
 *       "args": ["--env-file=.env", "/abs/path/server/src/mcp/server.js"] } } }
 *
 * STDOUT DISCIPLINE: MCP stdio reserves stdout for protocol messages.
 * Everything else in this project logs through server/src/logger.js to
 * STDERR only; this module never writes to stdout directly.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { readVersion } from './contract.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp');

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds a fully wired MCP server instance (no transport attached) —
 * exported for tests, which link it via InMemoryTransport.
 */
export function createMcpServer() {
  const server = new McpServer({
    name: 'suto-osnova',
    title: 'SUTO OSNOVA — Qloo Taste AI',
    version: readVersion(),
  });

  registerTools(server);
  registerResources(server);

  // Low-level instructions surface: what this server is, offline mode.
  server.server?.setInstructions?.(
    'Cultural intelligence over the Qloo Taste AI API: entity search, taste ' +
      'tags, cross-domain affinities, consumer-audience insights, plus local ' +
      'domain classification (film/music/books/dining/fashion) and a privacy ' +
      'audit tool. Network tools enforce rate limiting, retries and a ' +
      'zero-personal-data guarantee. With MOCK_MODE=true the server answers ' +
      'from recorded fixtures and needs no network. Resources expose the ' +
      'entity graph as standardized JSON context: qloo://domains, ' +
      'qloo://domains/{domain}, qloo://entity/{id}, qloo://tags/{tagUrn}, ' +
      'qloo://audiences/{audienceUrn} — payloads carry `links` URIs for ' +
      'graph traversal.'
  );

  return server;
}

/** Starts the server on the process stdio transport. */
export async function start() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only (the project logger): stdout belongs to the protocol.
  log.info('suto-osnova server listening on stdio');
  return server;
}

// Executed directly (npm run mcp) -> serve; imported (tests) -> silent.
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(here, 'server.js');

if (isDirectRun) {
  start().catch((err) => {
    log.error('fatal startup failure', {
      message: String(err?.message ?? err).slice(0, 200),
    });
    process.exit(1);
  });
}

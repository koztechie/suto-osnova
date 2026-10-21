/**
 * HTTP application handler (no side effects — nothing listens here):
 * routing + middleware wiring, extracted so tests can drive the handler
 * on an ephemeral port without importing the process entrypoint.
 *
 * Routes:
 *   GET  /api/health                     -> system health incl. Qloo connectivity (health.js)
 *   GET  /api/categories                 -> the supported categories / domains (categories.js)
 *   POST /api/generate/worldbuilder      -> Mode 1 Character & Scene Dossier (generate.js)
 *   POST /api/generate/experiential      -> Mode 2 Live Event Activation (generate.js)
 *   POST /api/generate/antithesis        -> Mode 3 Taste Antithesis Report (generate.js)
 *   anything else                        -> legacy echo behavior (pre-existing contract).
 */

import { corsMiddleware } from './middleware/cors.js';
import { parseJsonBody } from './middleware/bodyParser.js';
import { ClientRateLimiter, writeRateLimited } from './middleware/rateLimit.js';
import { handleHealth } from './health.js';
import { handleCategories } from './categories.js';
import {
  handleGenerateWorldbuilder, handleGenerateExperiential, handleGenerateAntithesis,
} from './generate.js';
import { sendError, classifyError } from './httpErrors.js';
import { createLogger } from './logger.js';
import { newRequestId } from './ids.js';
import { serveStaticMirror } from './middleware/staticMirror.js';
import { env } from './config/env.js';

const log = createLogger('http');

export function createHttpHandler() {
  // Per-client spam protection (task 116): one limiter per handler
  // instance (a fresh bucket set per server), configured from env.
  const limiter = new ClientRateLimiter({
    windowMs: env.INBOUND_RATE_WINDOW_MS,
    maxRequests: env.INBOUND_RATE_LIMIT,
  });
  return async function requestHandler(req, res) {
    // Global error boundary (task 35): EVERY failure — body parsing,
    // health, future routes — leaves as one structured envelope with an
    // informative code and a correlation id (X-Request-Id on every
    // response). Unexpected bugs are logged to stderr, never echoed.
    const requestId = newRequestId();
    try {
      if (corsMiddleware(req, res)) return;

      // Health first: a GET with no body, so it skips JSON parsing
      // entirely and can answer while the rest of the pipeline is
      // unavailable.
      const url = new URL(req.url ?? '/', 'http://internal');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        await handleHealth(req, res, url);
        return;
      }
      // Static categories metadata (task 114): a GET with no body, so
      // it skips JSON parsing like health.
      if (req.method === 'GET' && url.pathname === '/api/categories') {
        await handleCategories(req, res, requestId);
        return;
      }

      // Generate routes (tasks 111-113), spam-protected per client
      // (task 116): the limiter runs BEFORE body parsing, so every
      // generate attempt counts — malformed or not.
      if (req.method === 'POST' && url.pathname.startsWith('/api/generate/')) {
        const verdict = limiter.check(limiter.clientKey(req));
        if (!verdict.allowed) {
          writeRateLimited(res, requestId, verdict.retryAfterSeconds);
          return;
        }
        await parseJsonBody(req);
        if (url.pathname === '/api/generate/worldbuilder') {
          await handleGenerateWorldbuilder(req, res, req.body, requestId);
          return;
        }
        if (url.pathname === '/api/generate/experiential') {
          await handleGenerateExperiential(req, res, req.body, requestId);
          return;
        }
        if (url.pathname === '/api/generate/antithesis') {
          await handleGenerateAntithesis(req, res, req.body, requestId);
          return;
        }
      }

      // Static mirror (task 191): an OPT-IN path so ONE process serves
      // the WHOLE app on Render/VPS (client + /api, same origin). Only
      // when STATIC_DIR is set; the default keeps the legacy echo below.
      if (process.env.STATIC_DIR && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
        const served = await serveStaticMirror(req, res, url.pathname, process.env.STATIC_DIR);
        if (served) return;
        // Unknown path -> the SPA shell (client-side routes), else 404.
        const shell = await serveStaticMirror(req, res, '/index.html', process.env.STATIC_DIR);
        if (shell) return;
      }

      // Body parsing errors (413/400) surface through the same global
      // boundary below: PAYLOAD_TOO_LARGE / INVALID_JSON envelopes.
      await parseJsonBody(req);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'suto-osnova',
          receivedBody: req.body || null,
        })
      );
    } catch (err) {
      // The classified code matches what the response envelope carries,
      // so a log line and its HTTP response correlate exactly.
      const { code } = classifyError(err);
      log.error(`${req.method} ${req.url} -> ${code}`, {
        requestId,
        message: String(err?.message ?? err).slice(0, 200),
      });
      sendError(req, res, err, requestId);
    }
  };
}

export default createHttpHandler;

/**
 * HTTP application handler (no side effects — nothing listens here):
 * routing + middleware wiring, extracted so tests can drive the handler
 * on an ephemeral port without importing the process entrypoint.
 *
 * Routes:
 *   GET /api/health -> system health incl. Qloo connectivity (health.js)
 *   anything else   -> legacy echo behavior (pre-existing contract).
 */

import { corsMiddleware } from './middleware/cors.js';
import { parseJsonBody } from './middleware/bodyParser.js';
import { handleHealth } from './health.js';
import { sendError, classifyError } from './httpErrors.js';
import { createLogger } from './logger.js';
import { newRequestId } from './ids.js';

const log = createLogger('http');

export function createHttpHandler() {
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

/**
 * Netlify Function adapter (task 173) — bridges the existing Node
 * `(req, res)` HTTP handler (server/src/app.js) to Netlify's serverless
 * model so the whole `/api/*` gateway runs on Netlify's FREE tier.
 *
 * WHY AN ADAPTER: the app is written against Node's native
 * `http.createServer(createHttpHandler())` surface. Netlify Functions
 * receive a parsed EVENT object and return a `{statusCode, headers,
 * body}` response — no sockets. This module translates between the two:
 *   - event -> a Node-like `req` (a Readable carrying the body, plus
 *     method/url/headers/socket.remoteAddress the handler reads);
 *   - the handler's `res` calls (writeHead/setHeader/write/end/destroy)
 *     are captured and returned as the function response.
 *
 * ONE HANDLER PER COLD START: `createHttpHandler()` is invoked once at
 * module load and reused across warm invocations, so the inbound rate
 * limiter persists within a lambda instance (a documented serverless
 * limitation: it resets across cold starts).
 *
 * Zero new dependencies: the bridge uses only `node:stream`.
 */
import { Readable } from 'node:stream';
import { createHttpHandler } from '../../server/src/app.js';

// Reused across warm invocations (created once per cold start).
const handle = createHttpHandler();

/** Reconstructs the request URL (path + query) the handler expects. */
function requestUrl(event) {
  let url = event.path || '/';
  const query = event.queryStringParameters;
  if (query && Object.keys(query).length > 0) {
    url += `?${new URLSearchParams(query)}`;
  }
  return url;
}

/** Runs the Node (req, res) handler against one Netlify event. */
function invoke(event) {
  return new Promise((resolve, reject) => {
    const method = event.httpMethod || 'GET';
    const headers = { ...(event.headers || {}) };
    // Netlify may base64-encode a binary body; the API is JSON/text.
    const bodyText = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64')
      : (event.body ?? '');

    // req: a Readable that emits the body then 'end' (empty for GET).
    const req = Readable.from(bodyText ? [Buffer.from(bodyText)] : []);
    req.method = method;
    req.url = requestUrl(event);
    req.headers = headers;
    // The rate limiter keys on the first X-Forwarded-For hop (Netlify
    // sets it); fall back to a placeholder so it never throws.
    req.socket = {
      remoteAddress: headers['x-forwarded-for']?.split(',')[0].trim() ?? '0.0.0.0',
    };

    const outHeaders = {};
    let statusCode = 200;
    let body = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ statusCode, headers: outHeaders, body, isBase64Encoded: false });
    };

    // res: writeHead is CHAINABLE (cors does `res.writeHead(204).end()`).
    const res = {
      writeHead(status, extra) {
        statusCode = status;
        if (extra) Object.assign(outHeaders, extra);
        return res;
      },
      setHeader(name, value) { outHeaders[name] = value; },
      getHeader(name) { return outHeaders[name]; },
      write(chunk) { if (chunk) body += chunk; return true; },
      end(chunk) { if (chunk) body += chunk; finish(); },
      destroy() { finish(); },
      on() { return res; },
      once() { return res; },
      emit() { return false; },
    };

    handle(req, res).catch(reject);
  });
}

export default async function netlifyHandler(event) {
  return invoke(event);
}

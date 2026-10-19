/**
 * Netlify Function adapter (tasks 173-176) — bridges the existing Node
 * `(req, res)` HTTP handler (server/src/app.js) to Netlify's serverless
 * model so the whole `/api/*` gateway runs on Netlify's FREE tier.
 *
 * FUNCTIONS v2 CONTRACT (the 502 fix): Netlify's current runtime is
 * FUNCTIONS v2 — the default export receives a WHATWG `Request` and MUST
 * return a WHATWG `Response` (returning the legacy `{statusCode, headers,
 * body}` object raised `NetlifyUserError: Function returned an
 * unsupported value. Accepted types are 'Response' or 'undefined'`).
 * This adapter therefore: buffers the Request body, feeds it into a
 * Node-like `req` (Readable + method/url/headers/socket), captures the
 * handler's `res` calls, and returns `new Response(body, {status, headers})`.
 *
 * REDIRECT PATH: the `/api/* -> /.netlify/functions/api/:splat` redirect
 * can hand the function the ORIGINAL path (`/api/health`), the bare
 * SPLAT (`/health`), or the full mount (`/.netlify/functions/api/health`)
 * — `canonicalPath()` normalizes all three to the `/api/...` route the
 * handler dispatches on (pinned by tests/netlifyDeploy.test.js).
 *
 * ONE HANDLER PER COLD START: `createHttpHandler()` is created once at
 * module load and reused across warm invocations, so the inbound rate
 * limiter persists within a lambda instance (resets on cold start — a
 * documented serverless limitation). Zero new dependencies.
 */
import { Readable } from 'node:stream';
import { createHttpHandler } from '../../server/src/app.js';

// Reused across warm invocations (created once per cold start).
const handle = createHttpHandler();

/**
 * Canonicalizes the request path the handler routes on: ensure a leading
 * slash, strip a full function-mount prefix if present, ensure `/api`.
 */
function canonicalPath(rawPath) {
  let p = rawPath || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/^\/\.netlify\/functions\/[^/]+/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.startsWith('/api')) p = `/api${p}`;
  return p;
}

/** Runs the Node (req, res) handler against one WHATWG Request. */
async function runNodeHandler(request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  // Buffer the body (the API is JSON/text; no streaming needed).
  const rawBody = Buffer.from(await request.arrayBuffer());

  const req = Readable.from(rawBody.length > 0 ? [rawBody] : []);
  req.method = request.method || 'GET';
  req.url = canonicalPath(url.pathname) + url.search;
  req.headers = headers;
  // The rate limiter keys on the first X-Forwarded-For hop.
  req.socket = {
    remoteAddress: headers['x-forwarded-for']?.split(',')[0].trim() ?? '0.0.0.0',
  };

  const outHeaders = {};
  let statusCode = 200;
  let body = '';
  let settled = false;

  await new Promise((resolve) => {
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    // writeHead is CHAINABLE (cors does `res.writeHead(204).end()`).
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
    // The handler has its own global error boundary; a rejection here is
    // unexpected, so surface it as a 500 rather than an empty 200.
    handle(req, res).catch((error) => {
      statusCode = 500;
      body = JSON.stringify({ status: 'error', error: { code: 'INTERNAL', message: String(error?.message ?? error) } });
      finish();
    });
  });

  return { statusCode, headers: outHeaders, body };
}

/** Netlify Functions v2 default export: (Request) -> Response. */
export default async function netlifyHandler(request) {
  const { statusCode, headers, body } = await runNodeHandler(request);
  // 204/205/304 MUST carry a null body — the Response constructor
  // REJECTS even an empty string there (this broke the CORS preflight).
  const responseBody =
    statusCode === 204 || statusCode === 205 || statusCode === 304 ? null : body;
  return new Response(responseBody, { status: statusCode, headers });
}

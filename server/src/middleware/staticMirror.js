/**
 * Static mirror (task 191) — OPTIONAL static file serving so ONE Node
 * process can serve the WHOLE app (built client + the /api gateway),
 * which is what a Render/VPS backup mirror needs (the client calls
 * same-origin /api, so client and API must share an origin).
 *
 * ACTIVATION: only when STATIC_DIR is set (the mirror deploy). The
 * default (unset) is a no-op, so the legacy echo contract and every
 * existing gate are untouched — this is an opt-in mirror path.
 *
 * SAFETY: every path is resolved INSIDE the root (a `..` traversal or an
 * absolute escape resolves outside and is rejected with 404, never
 * served). Only GET/HEAD are served. Missing files fall through so the
 * caller can apply its own fallback (the SPA shell).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Content types for the static assets the build emits. */
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
});

/**
 * Resolves a URL pathname to a safe absolute path INSIDE `root`, or
 * null when the path escapes the root (traversal / absolute escape).
 */
export function resolveStaticPath(root, pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  // Decode %2e%2e etc. defensively before resolving.
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const resolved = path.resolve(root, `.${path.sep}${decoded.replace(/^[/\\]+/, '')}`);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null; // escaped the root
  }
  return resolved;
}

/**
 * Serves one static file. Returns true when a response was written
 * (file found), false when the caller should apply its own fallback.
 *
 * @param {object} req Node request (method used for HEAD)
 * @param {object} res Node response
 * @param {string} pathname decoded URL path (e.g. "/index.html")
 * @param {string} root absolute directory to serve from (STATIC_DIR)
 */
export async function serveStaticMirror(req, res, pathname, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  // Directory requests serve the shell.
  const target = pathname === '/' || pathname.endsWith('/')
    ? `${pathname}index.html`
    : pathname;
  const file = resolveStaticPath(root, target);
  if (file === null) return false;

  let body;
  try {
    body = await readFile(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false; // caller falls back
    throw err;
  }

  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const cacheControl = target.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable' // content-addressed build output
    : 'public, max-age=0, must-revalidate';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cacheControl });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

const staticMirror = { serveStaticMirror, resolveStaticPath, CONTENT_TYPES };
export default staticMirror;

/**
 * SUTO OSNOVA — client preview server (the local Vercel stand-in).
 * Serves client/ as static files and PROXIES /api/* to the local
 * backend — the exact production topology (static host + gateway) in
 * one process, for local preview and live browser verification
 * (task 157).
 *
 * Usage: CLIENT_PORT=5173 API_PORT=8787 node scripts/serveClient.mjs
 * Zero dependencies (node:http only); deterministic, no state.
 */
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_DIR = fileURLToPath(new URL('../client/', import.meta.url));
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);
const API_PORT = Number(process.env.API_PORT ?? 8787);

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
});

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://local');
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const target = path.join(CLIENT_DIR, path.normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

function proxyApi(req, res) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const proxyReq = httpRequest({
      host: '127.0.0.1',
      port: API_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        error: { code: 'PREVIEW_PROXY_DOWN', message: `backend on :${API_PORT} is unreachable` },
      }));
    });
    proxyReq.end(body);
  });
}

const server = createHttpServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(CLIENT_PORT, () => {
  process.stdout.write(`client preview on http://127.0.0.1:${CLIENT_PORT} (api -> :${API_PORT})\n`);
});

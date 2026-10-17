/**
 * POST /api/generate/worldbuilder route gate (task 111) — the Mode 1
 * HTTP surface:
 *   - ROUTING + VALIDATION through the real HTTP server (a missing
 *     seed / bad format / unparseable body each surface as a 400
 *     typed envelope, proving the POST reaches the generate handler
 *     and not the echo fallback; the X-Request-Id correlation header
 *     rides every response; the health + echo routes still work);
 *   - the HAPPY PATH + FORMAT DISPATCH by calling the handler
 *     directly with TEST-ONLY injected clients (the real Qloo
 *     transport stays offline), covering json (the standardized
 *     envelope), markdown, and html.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.QLOO_API_KEY = 'generate-route-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';

const { createHttpHandler } = await import('../src/app.js');
const {
  handleGenerateWorldbuilder, handleGenerateExperiential, handleGenerateAntithesis,
} = await import('../src/generate.js');
const { env } = await import('../src/config/env.js');
const { classifyError, RequestValidationError } = await import('../src/httpErrors.js');

const realFetch = globalThis.fetch;
let server;
let baseUrl;

beforeEach(async () => {
  env.MOCK_MODE = true;
  globalThis.fetch = async () => { throw new Error('network disabled'); };
  server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  env.MOCK_MODE = true;
  await new Promise((resolve) => server.close(resolve));
});

function request(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          text: data,
          json: () => { try { return JSON.parse(data); } catch { return null; } },
        }));
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- routing + validation through the real HTTP server ------------------------

test('routing: a POST reaches the generate handler, not the echo', async () => {
  const res = await request('/api/generate/worldbuilder', { method: 'POST', body: {} });
  assert.equal(res.status, 400, 'the echo would be 200; a 400 proves the route ran');
  assert.equal(res.json().error.code, 'INVALID_SEED');
  assert.equal(res.json().status, 'error');
});

test('validation: typed 400 envelopes for malformed input', async () => {
  const missingSeed = await request('/api/generate/worldbuilder', { method: 'POST', body: {} });
  assert.equal(missingSeed.status, 400);
  assert.equal(missingSeed.json().error.code, 'INVALID_SEED');

  const badFormat = await request('/api/generate/worldbuilder', {
    method: 'POST', body: { seed: 'x', format: 'pdf' },
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.json().error.code, 'INVALID_FORMAT');

  const badOptions = await request('/api/generate/worldbuilder', {
    method: 'POST', body: { seed: 'x', options: [] },
  });
  assert.equal(badOptions.status, 400);
  assert.equal(badOptions.json().error.code, 'INVALID_OPTIONS');
});

test('body pipeline: an unparseable body is a 400 INVALID_JSON', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/api/generate/worldbuilder`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, json: () => JSON.parse(d) })); },
    );
    req.on('error', reject);
    req.write('{ not json');
    req.end();
  });
  assert.equal(res.status, 400);
  assert.equal(res.json().error.code, 'INVALID_JSON');
});

test('correlation + regressions: X-Request-Id, health, echo', async () => {
  const gen = await request('/api/generate/worldbuilder', { method: 'POST', body: {} });
  assert.ok(gen.headers['x-request-id'], 'the correlation header rides the error envelope');

  const health = await request('/api/health');
  assert.equal(health.status, 200, 'the health route still answers');

  const echo = await request('/legacy', { method: 'POST', body: { hello: 'world' } });
  assert.equal(echo.status, 200);
  assert.equal(echo.json().receivedBody.hello, 'world', 'the echo fallback is intact');
});

// --- the happy path + format dispatch (offline, injected clients) -------------

// A minimal dark-ambient universe that drives one real worldbuilder run.
const UUID = (t) => `${t.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const T = (id, name, type) => ({ id, name, type });
const ANCHOR = {
  id: UUID('da7a0000'), name: 'Dark Thread', subtype: 'urn:entity:artist', popularity: 0.6,
  tags: [T('urn:tag:genre:music:darkambient', 'Dark Ambient', 'urn:tag:genre:music')],
};
const SUB = {
  music: 'urn:entity:artist', books: 'urn:entity:book', fashion: 'urn:entity:brand',
  dining: 'urn:entity:place', film: 'urn:entity:movie',
};
const BASE = { music: 1, books: 2, fashion: 3, dining: 4, film: 5 };
const TAGS = {
  music: [T('urn:tag:genre:music:darkambient', 'Dark Ambient', 'urn:tag:genre:music')],
  books: [T('urn:tag:genre:media:fiction', 'Fiction', 'urn:tag:genre:media')],
  fashion: [T('urn:tag:genre:brand:fashion', 'Fashion', 'urn:tag:genre:brand')],
  dining: [T('urn:tag:genre:place:restaurant', 'Restaurant', 'urn:tag:genre:place')],
  film: [T('urn:tag:genre:media:horror', 'Horror', 'urn:tag:genre:media')],
};
const NAMES = {
  music: ['Null Drone', 'Grey Static'], books: ['Samizdat Nights'],
  fashion: ['Monochrome Atelier', 'Obsidian Wear'],
  dining: ['The Crypt Bar', 'Nocturne Cafe'], film: ['Silent Reel'],
};
const clients = {
  searchEntities: async () => ({ results: [ANCHOR] }),
  getCrossDomainAffinities: async (ids, domain) => {
    const key = String(domain);
    let k = key;
    if (key.includes('artist')) k = 'music';
    else if (key.includes('book')) k = 'books';
    else if (key.includes('brand')) k = 'fashion';
    else if (key.includes('place')) k = 'dining';
    else if (key.includes('movie')) k = 'film';
    const names = NAMES[k] ?? NAMES.music;
    return {
      results: names.map((name, i) => ({
        id: UUID(`${BASE[k]}${i}0000`), name, subtype: SUB[k],
        affinity: 0.9 - i * 0.05, popularity: 0.3, tags: TAGS[k],
      })),
    };
  },
  findTags: async () => ({ results: TAGS.music }),
  getAudienceInsights: async () => ({
    count: 1,
    results: [{ name: 'Monochrome Atelier', affinity: 0.8 }],
  }),
};

function mockRes() {
  return {
    statusCode: null, headers: null, body: null, headersSent: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; },
  };
}

test('happy path (json): the standardized dossier envelope', async () => {
  const res = mockRes();
  await handleGenerateWorldbuilder({}, res, { seed: 'Dark Thread' }, 'req-1', clients);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(res.headers['X-Request-Id'], 'req-1');
  assert.equal(res.headers['Cache-Control'], 'no-store');

  const payload = JSON.parse(res.body);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.dossier.schema, 'suto-osnova.dossier/v1');
  assert.equal(payload.dossier.mode, 'worldbuilder');
  assert.equal(payload.dossier.output, 'mise_en_scene_dossier');
  assert.equal(payload.dossier.entity.name, 'Dark Thread');
  assert.equal(payload.dossier.entity.category, 'music');
  assert.ok(Array.isArray(payload.dossier.data.ranked), 'the ranked payload rides `data`');
  assert.ok(payload.dossier.data.ranked.length > 0);
  assert.ok(payload.dossier.meta.stats, 'the ledger rides `meta`');
});

test('format dispatch: markdown and html', async () => {
  const md = mockRes();
  await handleGenerateWorldbuilder({}, md, { seed: 'Dark Thread', format: 'markdown' }, 'req-2', clients);
  assert.equal(md.statusCode, 200);
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.match(md.body, /^# DOSSIER — Worldbuilder/m);
  assert.match(md.body, /^## TOP AFFINITIES$/m);

  const html = mockRes();
  await handleGenerateWorldbuilder({}, html, { seed: 'Dark Thread', format: 'html' }, 'req-3', clients);
  assert.equal(html.statusCode, 200);
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(html.body.startsWith('<!DOCTYPE html>'));
  assert.match(html.body, /<h2>DATA SOURCES<\/h2>/);
  assert.match(html.body, /<h2>PRIVACY NOTICE<\/h2>/);
});

test('validation edge: the typed 400 classifier', () => {
  const { httpStatus, code } = classifyError(new RequestValidationError('bad', 'INVALID_SEED'));
  assert.equal(httpStatus, 400);
  assert.equal(code, 'INVALID_SEED');
});

// --- POST /api/generate/experiential (Mode 2, task 112) -----------------------

test('experiential routing: the POST reaches the Mode 2 handler', async () => {
  const res = await request('/api/generate/experiential', { method: 'POST', body: {} });
  assert.equal(res.status, 400, 'the echo would be 200; a 400 proves the route ran');
  assert.equal(res.json().error.code, 'INVALID_SEED');

  const badFormat = await request('/api/generate/experiential', {
    method: 'POST', body: { seed: 'x', format: 'pdf' },
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.json().error.code, 'INVALID_FORMAT');
});

test('experiential happy path: the activation envelope with the audience leg', async () => {
  const res = mockRes();
  await handleGenerateExperiential(
    {}, res, { seed: 'Dark Thread', options: { cutRate: 0 } }, 'req-x1', clients,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(res.headers['X-Request-Id'], 'req-x1');

  const payload = JSON.parse(res.body);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.dossier.schema, 'suto-osnova.dossier/v1');
  assert.equal(payload.dossier.mode, 'activation', 'the mode id, not the route name');
  assert.equal(payload.dossier.output, 'activation_curation');
  assert.equal(payload.dossier.entity.name, 'Dark Thread');
  // The activation payload: the audience leg + the curation lists.
  assert.ok(payload.dossier.data.audience, 'the audience leg rides `data`');
  assert.equal(payload.dossier.data.audience.available, true);
  assert.ok(payload.dossier.data.curation.openingActs.length > 0, 'opening acts present');
  assert.ok(payload.dossier.data.curation.sponsors.length > 0, 'sponsors present');
  assert.ok(payload.dossier.meta.stats, 'the ledger rides `meta`');
});

test('experiential format dispatch: markdown + html carry the activation blocks', async () => {
  const md = mockRes();
  await handleGenerateExperiential(
    {}, md, { seed: 'Dark Thread', format: 'markdown', options: { cutRate: 0 } }, 'req-x2', clients,
  );
  assert.equal(md.statusCode, 200);
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.match(md.body, /^# DOSSIER — Experiential Activation/m);
  assert.match(md.body, /^## AUDIENCE INSIGHTS$/m);
  assert.match(md.body, /^## OPENING ACTS$/m);

  const html = mockRes();
  await handleGenerateExperiential(
    {}, html, { seed: 'Dark Thread', format: 'html', options: { cutRate: 0 } }, 'req-x3', clients,
  );
  assert.equal(html.statusCode, 200);
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(html.body.startsWith('<!DOCTYPE html>'));
  assert.match(html.body, /<h2>SPONSORS<\/h2>/);
  assert.match(html.body, /<h2>PRIVACY NOTICE<\/h2>/);
});

test('experiential options pass-through: topN bounds reach the mode', async () => {
  const res = mockRes();
  await handleGenerateExperiential(
    {}, res, { seed: 'Dark Thread', options: { topN: 2, cutRate: 0 } }, 'req-x4', clients,
  );
  const payload = JSON.parse(res.body);
  assert.ok(payload.dossier.data.curation.openingActs.length <= 2, 'topN honored');
});

// --- POST /api/generate/antithesis (Mode 3, task 113) -------------------------

test('antithesis routing: the POST reaches the Mode 3 handler', async () => {
  const res = await request('/api/generate/antithesis', { method: 'POST', body: {} });
  assert.equal(res.status, 400, 'the echo would be 200; a 400 proves the route ran');
  assert.equal(res.json().error.code, 'INVALID_SEED');

  const badFormat = await request('/api/generate/antithesis', {
    method: 'POST', body: { seed: 'x', format: 'pdf' },
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.json().error.code, 'INVALID_FORMAT');
});

test('antithesis happy path: the blindspot envelope', async () => {
  const res = mockRes();
  await handleGenerateAntithesis({}, res, { seed: 'Dark Thread' }, 'req-a1', clients);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(res.headers['X-Request-Id'], 'req-a1');

  const payload = JSON.parse(res.body);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.dossier.schema, 'suto-osnova.dossier/v1');
  assert.equal(payload.dossier.mode, 'antithesis');
  assert.equal(payload.dossier.output, 'cultural_blindspot_report');
  assert.equal(payload.dossier.entity.name, 'Dark Thread');
  // The antithesis payload: the blindspot block with the honest null thresholds.
  assert.ok(payload.dossier.data.antithesis, 'the antithesis block rides `data`');
  assert.ok(Array.isArray(payload.dossier.data.antithesis.matrix));
  assert.equal(payload.dossier.data.selection.strategy, 'lowest_correlation');
  assert.equal(payload.dossier.data.selection.thresholds, null);
  assert.ok(payload.dossier.meta.stats, 'the ledger rides `meta`');
});

test('antithesis format dispatch: markdown + html carry the blindspot report', async () => {
  const md = mockRes();
  await handleGenerateAntithesis(
    {}, md, { seed: 'Dark Thread', format: 'markdown' }, 'req-a2', clients,
  );
  assert.equal(md.statusCode, 200);
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.match(md.body, /^# DOSSIER — Taste Antithesis/m);
  assert.match(md.body, /^## CULTURAL BLINDSPOT$/m);

  const html = mockRes();
  await handleGenerateAntithesis(
    {}, html, { seed: 'Dark Thread', format: 'html' }, 'req-a3', clients,
  );
  assert.equal(html.statusCode, 200);
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(html.body.startsWith('<!DOCTYPE html>'));
  assert.match(html.body, /<h2>CULTURAL BLINDSPOT<\/h2>/);
  assert.match(html.body, /<h2>PRIVACY NOTICE<\/h2>/);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Deterministic transport env BEFORE the module graph loads.
process.env.QLOO_API_KEY = 'health-test-key';
process.env.MOCK_MODE = 'true';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
process.env.QLOO_MAX_RETRIES = '0';

const { classifyError, sendError } = await import('../src/httpErrors.js');
const { createHttpHandler } = await import('../src/app.js');
const { QlooApiError } = await import('../src/services/qlooClient.js');
const { MockFixtureNotFoundError } = await import('../src/services/qlooMock.js');
const { PrivacyError } = await import('../src/services/privacyGuard.js');
const { EntitySearchError } = await import('../src/services/entitySearchClient.js');
const { DomainMappingError } = await import('../src/services/domainMapper.js');

// --- classification table (pure) -------------------------------------------------

test('QlooApiError variants map to informative transport codes', () => {
  const cases = [
    [{ status: 401, statusText: 'Unauthorized', attempts: 1 }, 502, 'QLOO_AUTH'],
    [{ status: 403, statusText: 'Forbidden', attempts: 1 }, 502, 'QLOO_AUTH'],
    [{ status: 429, statusText: 'Too Many', attempts: 3 }, 503, 'QLOO_RATE_LIMITED'],
    [{ status: 503, statusText: 'Overload', attempts: 3 }, 502, 'QLOO_UPSTREAM'],
    [{ status: 404, statusText: 'Not Found', attempts: 1 }, 502, 'QLOO_REJECTED'],
    [{ status: 400, statusText: 'Bad Request', attempts: 1 }, 502, 'QLOO_REJECTED'],
  ];
  for (const [opts, httpStatus, code] of cases) {
    const got = classifyError(new QlooApiError('upstream', opts));
    assert.equal(got.httpStatus, httpStatus, code);
    assert.equal(got.code, code);
    assert.equal(got.upstream.status, opts.status);
    assert.equal(got.upstream.attempts, opts.attempts);
  }
});

test('network exhaustion separates timeouts from plain outages', () => {
  const net = classifyError(
    new QlooApiError('net', { status: null, statusText: 'Network Error', attempts: 3, cause: new TypeError('fetch failed') })
  );
  assert.equal(net.httpStatus, 502);
  assert.equal(net.code, 'QLOO_NETWORK');

  const timeout = classifyError(
    new QlooApiError('t/o', {
      status: null,
      statusText: 'Network Error',
      attempts: 1,
      cause: Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    })
  );
  assert.equal(timeout.httpStatus, 504);
  assert.equal(timeout.code, 'QLOO_TIMEOUT');

  // nested cause chain (cause.cause)
  const nested = classifyError(
    new QlooApiError('n', {
      status: null,
      attempts: 1,
      cause: Object.assign(new Error('outer'), { code: 'ETIMEDOUT' }),
    })
  );
  assert.equal(nested.code, 'QLOO_TIMEOUT');
});

test('offline misconfig, privacy and typed validators map to typed codes', () => {
  const mock = classifyError(new MockFixtureNotFoundError({ method: 'GET', pathname: '/x', search: '' }));
  assert.equal(mock.httpStatus, 503);
  assert.equal(mock.code, 'MOCK_FIXTURE_NOT_FOUND');

  const pii = classifyError(new PrivacyError('PII', { findings: [] }));
  assert.equal(pii.httpStatus, 400);
  assert.equal(pii.code, 'PII_DETECTED');

  const domain = classifyError(new EntitySearchError('bad domain', { code: 'INVALID_DOMAIN' }));
  assert.equal(domain.httpStatus, 400);
  assert.equal(domain.code, 'INVALID_DOMAIN');

  const registry = classifyError(new DomainMappingError('broken', { code: 'INVALID_REGISTRY' }));
  assert.equal(registry.httpStatus, 400);
  assert.equal(registry.code, 'INVALID_REGISTRY');
});

test('body-pipeline and unexpected errors', () => {
  const tooLarge = Object.assign(new Error('Payload Too Large'), { status: 413 });
  assert.deepEqual(
    [classifyError(tooLarge).httpStatus, classifyError(tooLarge).code],
    [413, 'PAYLOAD_TOO_LARGE']
  );
  const badJson = Object.assign(new Error('Invalid JSON'), { status: 400 });
  assert.equal(classifyError(badJson).code, 'INVALID_JSON');

  const abort = Object.assign(new Error('a'), { name: 'AbortError' });
  assert.equal(classifyError(abort).httpStatus, 504);

  // Raw transport-class errors escaping UNWRAPPED are OUR bugs: generic
  // 500, original message never leaks into the envelope.
  const internal = classifyError(new Error('boom: /secret/path exploded'));
  assert.equal(internal.httpStatus, 500);
  assert.equal(internal.code, 'INTERNAL');
  assert.equal(internal.message, 'Internal server error');
});

// --- envelope writer ----------------------------------------------------------------

function fakeRes({ headersSent = false } = {}) {
  const res = {
    headersSent,
    destroyed: false,
    status: null,
    headers: null,
    body: null,
    destroyedSocket: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(text) {
      this.body = JSON.parse(text);
      this.finished = true;
    },
    destroy() {
      this.destroyedSocket = true;
    },
    once() {},
  };
  return res;
}

test('sendError writes the structured envelope with requestId and upstream', () => {
  const req = { destroy() {} };
  const res = fakeRes();
  const err = new QlooApiError('up', { status: 429, statusText: 'Too Many', attempts: 3 });
  const { httpStatus, code } = sendError(req, res, err, 'req-123');

  assert.equal(httpStatus, 503);
  assert.equal(code, 'QLOO_RATE_LIMITED');
  assert.equal(res.status, 503);
  assert.equal(res.headers['X-Request-Id'], 'req-123');
  assert.equal(res.body.status, 'error');
  assert.equal(res.body.service, 'suto-osnova');
  assert.equal(res.body.error.code, 'QLOO_RATE_LIMITED');
  assert.equal(res.body.error.requestId, 'req-123');
  assert.deepEqual(res.body.upstream, { status: 429, attempts: 3 });
});

test('sendError destroys an already-streaming response instead of corrupting it', () => {
  const res = fakeRes({ headersSent: true });
  sendError({ destroy() {} }, res, new Error('late failure'), 'req-late');
  assert.equal(res.destroyedSocket, true, 'socket dropped');
  assert.equal(res.body, null, 'nothing written over a live stream');
});

// --- integration through the real HTTP pipeline ------------------------------------------

let server;
let baseUrl;

beforeEach(async () => {
  process.env.MOCK_MODE = 'true';
  server = http.createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function request(path, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('invalid JSON body -> 400 INVALID_JSON envelope with matching request id', async () => {
  const res = await request('/', { body: '{"broken":', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
  const body = JSON.parse(res.text);
  assert.equal(body.status, 'error');
  assert.equal(body.error.code, 'INVALID_JSON');
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['x-request-id'], body.error.requestId, 'header correlates with body');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('oversized JSON body -> 413 PAYLOAD_TOO_LARGE envelope (answerable)', async () => {
  const big = JSON.stringify({ blob: 'x'.repeat(1_050_000) });
  const res = await request('/', { body: big, headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 413);
  const body = JSON.parse(res.text);
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.ok(body.error.requestId);
});

test('success responses carry X-Request-Id and keep the legacy body', async () => {
  const res = await request('/', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 200);
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(res.text).receivedBody, { a: 1 });
});

test('health route is unaffected by the error boundary (200 in mock mode)', async () => {
  const res = await request('/api/health', { method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).status, 'ok');
});

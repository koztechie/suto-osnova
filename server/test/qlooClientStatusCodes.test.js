import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Deterministic transport: fast limiter, fast retries, cache off (exact
// upstream call counts are the point of this suite), live path with the
// global fetch mocked per status code.
process.env.QLOO_API_KEY = 'test-key-status-matrix';
process.env.QLOO_RATE_LIMIT = '50';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '5';
process.env.QLOO_RATE_QUEUE_MAX = '50';
process.env.QLOO_MAX_RETRIES = '2'; // 3 total attempts
process.env.QLOO_RETRY_BASE_MS = '5';
process.env.QLOO_RETRY_MAX_MS = '100';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.MOCK_MODE = 'false';
process.env.LOG_LEVEL = 'error'; // silence retry warnings; one test lowers it

const { qlooClient, QlooApiError } = await import('../src/services/qlooClient.js');
const { setSink, resetSink } = await import('../src/logger.js');

const realFetch = globalThis.fetch;
let calls;
let sequence;

/**
 * Minimal Response stand-in with the fields the client consumes:
 * ok/status/statusText, headers.get, json(), text().
 */
function mockResponse({
  status = 200,
  statusText = 'OK',
  body = { ok: true },
  contentType = 'application/json',
  brokenBody = false,
} = {}) {
  const headers = new Map([['content-type', contentType]]);
  const serialize = () => {
    if (brokenBody) throw new SyntaxError('unexpected token');
    return typeof body === 'string' ? body : JSON.stringify(body);
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: async () => {
      const text = serialize();
      return JSON.parse(text);
    },
    text: async () => serialize(),
  };
}

/** Each call gets a unique query value so single-flight never merges them. */
function uniqueParams() {
  sequence += 1;
  return { probe: `status-${sequence}` };
}

beforeEach(() => {
  calls = [];
  sequence = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSink();
});

test('200: resolves the parsed body verbatim with a single upstream call', async () => {
  const payload = { data: [{ name: 'entity', affinity: 0.87 }], meta: { source: 'qloo' } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ status: 200, body: payload });
  };

  const result = await qlooClient.get('/v2/insights', uniqueParams());

  assert.deepEqual(result, payload, 'the caller receives the upstream body untouched');
  assert.equal(calls.length, 1, 'exactly one upstream call on success');
});

// The permanent-failure matrix: 400, 401, 404 and 500 are NOT in the
// retryable set (only 429 and 503 are transient), so each must fail fast
// with one attempt and a fully populated error envelope.
const PERMANENT = [
  { status: 400, statusText: 'Bad Request' },
  { status: 401, statusText: 'Unauthorized' },
  { status: 404, statusText: 'Not Found' },
  { status: 500, statusText: 'Internal Server Error' },
];

for (const { status, statusText } of PERMANENT) {
  test(`${status}: fails fast with one attempt and the full error envelope`, async () => {
    const upstreamPayload = { message: `upstream says no`, status };
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return mockResponse({ status, statusText, body: upstreamPayload });
    };

    const error = await qlooClient
      .get('/v2/insights', uniqueParams())
      .then(() => null, (err) => err);

    assert.ok(error instanceof QlooApiError, `${status} raises QlooApiError`);
    assert.equal(error.name, 'QlooApiError');
    assert.equal(error.code, 'QLOO_API_ERROR', 'the stable machine code is set');
    assert.equal(error.status, status, 'the upstream status is preserved');
    assert.equal(error.statusText, statusText);
    assert.equal(error.attempts, 1, `${status} is permanent: no retries are wasted`);
    assert.equal(error.message,
      `Qloo API request failed: ${status} ${statusText}`,
      'the message carries status + statusText verbatim');
    assert.deepEqual(error.data, upstreamPayload, 'the JSON error body survives');
    assert.equal(calls.length, 1, 'exactly one upstream call, no retry storm');
  });
}

test('404: reads a text/plain error body as a string payload', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({
      status: 404,
      statusText: 'Not Found',
      body: 'no such entity',
      contentType: 'text/plain',
    });
  };

  const error = await qlooClient
    .get('/v2/entities/missing', uniqueParams())
    .then(() => null, (err) => err);

  assert.ok(error instanceof QlooApiError);
  assert.equal(error.data, 'no such entity', 'non-JSON bodies are read as text');
});

test('400: an unparseable error body degrades to null, never a crash', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({
      status: 400,
      statusText: 'Bad Request',
      body: 'not json at all',
      contentType: 'application/json',
      brokenBody: true,
    });
  };

  const error = await qlooClient
    .get('/v2/insights', uniqueParams())
    .then(() => null, (err) => err);

  assert.ok(error instanceof QlooApiError, 'still a typed error, not a SyntaxError');
  assert.equal(error.status, 400);
  assert.equal(error.data, null, 'the unreadable body becomes null');
});

test('429: retries and succeeds on the next attempt', async () => {
  const payload = { data: ['recovered'] };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return mockResponse({ status: 429, statusText: 'Too Many Requests' });
    }
    return mockResponse({ status: 200, body: payload });
  };

  const result = await qlooClient.get('/v2/insights', uniqueParams());

  assert.deepEqual(result, payload, 'the retry transparently delivers the body');
  assert.equal(calls.length, 2, 'one throttle, one retry');
});

test('429: surfaces the last upstream error verbatim after all attempts', async () => {
  const throttlePayload = { message: 'quota exhausted' };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({
      status: 429,
      statusText: 'Too Many Requests',
      body: throttlePayload,
    });
  };

  const error = await qlooClient
    .get('/v2/insights', uniqueParams())
    .then(() => null, (err) => err);

  assert.ok(error instanceof QlooApiError, 'exhausted retries still raise a typed error');
  assert.equal(error.status, 429);
  assert.equal(error.attempts, 3, 'initial attempt + QLOO_MAX_RETRIES');
  assert.deepEqual(error.data, throttlePayload, 'the last upstream body survives');
  assert.equal(calls.length, 3, 'exactly maxAttempts upstream calls');
});

test('429: honors the Retry-After header, clamped to the retry ceiling', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const response = calls.length === 1
      ? mockResponse({ status: 429, statusText: 'Too Many Requests' })
      : mockResponse({ status: 200, body: { data: ['after wait'] } });
    if (calls.length === 1) {
      response.headers = {
        get: (name) => (name.toLowerCase() === 'retry-after' ? '1' : null),
      };
    }
    return response;
  };

  const started = Date.now();
  const result = await qlooClient.get('/v2/insights', uniqueParams());
  const elapsed = Date.now() - started;

  assert.deepEqual(result, { data: ['after wait'] });
  assert.equal(calls.length, 2);
  assert.ok(elapsed >= 90, `waited ${elapsed}ms: the header was honored (>= ~100ms floor)`);
  assert.ok(elapsed < 5000, `the 1s header was clamped to the ceiling (waited ${elapsed}ms)`);
});

test('429: the retry emits a warn log naming the status and the attempt', async () => {
  const lines = [];
  process.env.LOG_LEVEL = 'warn';
  setSink((line) => lines.push(line));
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return mockResponse({ status: 429, statusText: 'Too Many Requests' });
    }
    return mockResponse({ status: 200, body: { data: ['logged'] } });
  };

  await qlooClient.get('/v2/insights', uniqueParams());
  delete process.env.LOG_LEVEL;

  const retryLine = lines.find((line) => line.includes('transient failure'));
  assert.ok(retryLine, 'the retry is observable in the logs');
  assert.match(retryLine, /429/, 'the throttle status is named');
  assert.match(retryLine, /retry 1\/2/, 'the attempt counter is named');
  assert.ok(!retryLine.includes('test-key-status-matrix'),
    'the API key never reaches the log line');
});

test('500: is permanent by policy — one call, zero retries', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ status: 500, statusText: 'Internal Server Error' });
  };

  await assert.rejects(
    () => qlooClient.post('/v2/taste', { entity: 'x' }),
    (error) => {
      assert.ok(error instanceof QlooApiError);
      assert.equal(error.status, 500);
      return true;
    },
    'POST also surfaces the typed error'
  );
  assert.equal(calls.length, 1,
    'only 429/503 are transient: a 500 never burns retry quota');
});

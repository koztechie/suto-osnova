import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Configure a fast, deterministic limiter before the module under test loads.
process.env.QLOO_API_KEY = 'test-key';
process.env.QLOO_RATE_LIMIT = '5';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '2';
process.env.QLOO_RATE_QUEUE_MAX = '50';
process.env.QLOO_MAX_RETRIES = '2';
process.env.QLOO_RETRY_BASE_MS = '10';
process.env.QLOO_RETRY_MAX_MS = '2000';
// Transport tests assert exact upstream call counts — disable the cache here;
// caching itself is covered by qlooCache.test.js.
process.env.QLOO_CACHE_ENABLED = 'false';

const { qlooClient } = await import('../src/services/qlooClient.js');
const { QlooApiError } = await import('../src/services/qlooClient.js');
const { setSink, resetSink } = await import('../src/logger.js');

const realFetch = globalThis.fetch;
let calls;

function mockResponse({ status = 200, body = { ok: true }, headers = {} } = {}) {
  const map = new Map(
    Object.entries({
      'content-type': 'application/json',
      ...Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
      ),
    })
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('attaches X-Api-Key to every outgoing request', async () => {
  await qlooClient.get('/v2/insights', { ids: 'x' });
  await qlooClient.post('/v2/taste', { entity: 'y' });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.headers['X-Api-Key'], 'test-key');
  }
});

test('deduplicates concurrent identical GET requests (single-flight)', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    await new Promise((r) => setTimeout(r, 30));
    return mockResponse({ body: { hits: 1 } });
  };

  const [a, b, c] = await Promise.all([
    qlooClient.get('/v2/insights', { ids: 'same' }),
    qlooClient.get('/v2/insights', { ids: 'same' }),
    qlooClient.get('/v2/insights', { ids: 'same' }),
  ]);

  assert.equal(calls.length, 1, 'only one upstream call for identical GETs');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('does NOT deduplicate non-GET requests', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    await new Promise((r) => setTimeout(r, 10));
    return mockResponse();
  };

  await Promise.all([
    qlooClient.post('/v2/taste', { a: 1 }),
    qlooClient.post('/v2/taste', { a: 1 }),
  ]);

  assert.equal(calls.length, 2);
});

test('respects Retry-After on 429 and retries successfully', async () => {
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    attempts += 1;
    if (attempts === 1) {
      return mockResponse({ status: 429, headers: { 'retry-after': '0' } });
    }
    return mockResponse({ body: { recovered: true } });
  };

  const result = await qlooClient.get('/v2/insights', { ids: 'retry' });

  assert.deepEqual(result, { recovered: true });
  assert.equal(calls.length, 2);
});

test('gives up after 3 total attempts on 429 and throws QlooApiError', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({
      status: 429,
      body: { message: 'quota exceeded' },
      headers: { 'retry-after': '0' },
    });
  };

  await assert.rejects(
    qlooClient.get('/v2/insights', { ids: 'doomed' }),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, 429);
      assert.deepEqual(err.data, { message: 'quota exceeded' });
      assert.equal(err.attempts, 3);
      return true;
    }
  );

  // 1 initial attempt + QLOO_MAX_RETRIES (2) = 3 total attempts.
  assert.equal(calls.length, 3);
});

test('retries HTTP 503 with backoff and recovers', async () => {
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    attempts += 1;
    if (attempts < 3) {
      return mockResponse({ status: 503, headers: { 'retry-after': '0' } });
    }
    return mockResponse({ body: { recovered: true } });
  };

  const result = await qlooClient.get('/v2/insights', { ids: 'overload' });

  assert.deepEqual(result, { recovered: true });
  assert.equal(calls.length, 3, '2 failures + 1 success');
});

test('retries transient network errors and recovers', async () => {
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    attempts += 1;
    if (attempts === 1) {
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      });
      throw err;
    }
    return mockResponse({ body: { recovered: true } });
  };

  const result = await qlooClient.get('/v2/insights', { ids: 'flaky' });

  assert.deepEqual(result, { recovered: true });
  assert.equal(calls.length, 2);
});

test('wraps persistent network failure in QlooApiError after 3 attempts', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    throw Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' });
  };

  await assert.rejects(
    qlooClient.get('/v2/insights', { ids: 'offline' }),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, null);
      assert.equal(err.statusText, 'Network Error');
      assert.equal(err.attempts, 3);
      assert.match(err.message, /after 3 attempts/);
      assert.ok(err.cause instanceof Error);
      assert.equal(err.cause.code, 'ETIMEDOUT');
      return true;
    }
  );

  assert.equal(calls.length, 3);
});

test('does NOT retry caller-initiated AbortError', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    throw err;
  };

  await assert.rejects(
    qlooClient.get('/v2/insights', { ids: 'cancelled' }),
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );

  assert.equal(calls.length, 1, 'aborts must stay deterministic');
});

test('honors Retry-After header delay on 503 overload', async () => {
  const startedAt = Date.now();
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    attempts += 1;
    if (attempts === 1) {
      return mockResponse({
        status: 503,
        headers: { 'retry-after': '1' },
      });
    }
    return mockResponse({ body: { recovered: true } });
  };

  const result = await qlooClient.get('/v2/insights', { ids: 'server-busy' });

  assert.deepEqual(result, { recovered: true });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 900, `expected to wait ~1s per Retry-After, got ${elapsed}ms`);
});

test('surfaces non-retryable HTTP errors immediately without retries', async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return mockResponse({ status: 401, body: { message: 'invalid key' } });
  };

  await assert.rejects(
    qlooClient.get('/v2/insights', { ids: 'bad-key' }),
    (err) => {
      assert.ok(err instanceof QlooApiError);
      assert.equal(err.status, 401);
      assert.equal(err.attempts, 1);
      return true;
    }
  );

  assert.equal(calls.length, 1, 'no retries on permanent failures');
});

// --- privacy guard at the transport boundary (task 25) ---------------------------

test('redacts PII from outbound query params before they reach the wire', async () => {
  const lines = [];
  process.env.LOG_LEVEL = 'warn';
  setSink((line) => lines.push(line));
  try {
    await qlooClient.get('/search', {
      query: 'pizza',
      'x-note': 'call john.doe@example.com or 192.168.1.10',
    });
  } finally {
    resetSink();
    delete process.env.LOG_LEVEL;
  }

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('query'), 'pizza', 'clean values untouched');
  const note = url.searchParams.get('x-note');
  assert.ok(!note.includes('john.doe@example.com'), 'email must not leak');
  assert.ok(!note.includes('192.168.1.10'), 'IP must not leak');
  assert.ok(note.includes('[REDACTED]'), 'redaction placeholder is present');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'test-key', 'auth intact');
  assert.ok(
    lines.some((l) => l.includes('email×1') && l.includes('ipv4×1')),
    `expected a masked summary warning, got: ${JSON.stringify(lines)}`
  );
  // the log line itself must not leak the raw PII
  assert.ok(!lines.join(' ').includes('john.doe@example.com'));
});

test('redacts PII from POST bodies (objects and strings) and keeps cache coherent', async () => {
  // Warn-level logs are suppressed by the test-env default (level=error),
  // so no silencing is needed — the transport just runs.
  await qlooClient.post('/v2/taste', {
    profile: { email: 'user@test.com', note: 'ip 10.0.0.7' },
  });
  await qlooClient.post('/v2/taste', 'raw body with bad@mail.io inside');

  const [objectBody, stringBody] = calls.map((c) => c.options.body);
  assert.ok(!objectBody.includes('user@test.com'), 'object body email redacted');
  assert.ok(!objectBody.includes('10.0.0.7'), 'object body IP redacted');
  assert.ok(objectBody.includes('[REDACTED]'));
  assert.ok(!stringBody.includes('bad@mail.io'), 'string body email redacted');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
});

test('PII-free requests are byte-identical (no guard interference)', async () => {
  await qlooClient.get('/search', {
    query: 'Blade Runner 2049',
    types: 'urn:entity:movie',
    take: 5,
  });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('query'), 'Blade Runner 2049');
  assert.equal(url.searchParams.get('types'), 'urn:entity:movie');
  assert.equal(url.searchParams.get('take'), '5');
});

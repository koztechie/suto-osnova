import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'logger-test-key-abcdef';

const {
  createLogger,
  logger,
  setSink,
  resetSink,
  scrubSecrets,
} = await import('../src/logger.js');

const realEnv = { ...process.env };
let lines;

beforeEach(() => {
  lines = [];
  setSink((line) => lines.push(line));
  delete process.env.LOG_LEVEL; // default behavior per test
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  resetSink();
  process.env.LOG_LEVEL = realEnv.LOG_LEVEL;
  if (!('LOG_LEVEL' in realEnv)) delete process.env.LOG_LEVEL;
  process.env.QLOO_API_KEY = realEnv.QLOO_API_KEY;
});

// --- format -----------------------------------------------------------------

test('one laconic line: ISO ts, LEVEL, [scope], message, json fields', () => {
  process.env.LOG_LEVEL = 'debug';
  createLogger('qloo').info('transient failure', { retry: 2, waitMs: 500 });

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.match(
    line,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO {2}\[qloo\] transient failure \{"retry":2,"waitMs":500\}$/
  );
});

test('scope children nest with a colon', () => {
  process.env.LOG_LEVEL = 'debug';
  createLogger('qloo').child('cache').warn('disk write failed');

  assert.match(lines[0], /\[qloo:cache\] disk write failed/);
});

test('unserializable fields never crash the log call', () => {
  process.env.LOG_LEVEL = 'debug';
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  logger.info('cycle', cyclic);

  assert.match(lines[0], /\[unserializable fields\]/);
});

// --- levels -------------------------------------------------------------------

test('LOG_LEVEL filters strictly; silent disables everything', () => {
  process.env.LOG_LEVEL = 'warn';
  const log = createLogger('t');
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.equal(lines.length, 2, 'warn+error only');
  assert.ok(lines[0].includes(' WARN ') && lines[1].includes(' ERROR '));

  lines = [];
  process.env.LOG_LEVEL = 'silent';
  log.error('nope');
  assert.equal(lines.length, 0);
});

test('test-env default is quiet (error), production default is info', () => {
  delete process.env.LOG_LEVEL;
  process.env.NODE_ENV = 'test';
  logger.info('hidden');
  assert.equal(lines.length, 0, 'NODE_ENV=test suppresses info by default');

  process.env.NODE_ENV = 'production';
  logger.info('visible');
  assert.equal(lines.length, 1, 'production default logs info');

  process.env.LOG_LEVEL = 'nonsense'; // invalid values fall back safely
  lines = [];
  logger.info('also visible');
  assert.equal(lines.length, 1, 'invalid LOG_LEVEL -> info default');
  process.env.NODE_ENV = 'test';
});

// --- secret redaction (the core guarantee) ---------------------------------------

test('the configured API key is redacted wherever it appears', () => {
  process.env.LOG_LEVEL = 'debug';
  process.env.QLOO_API_KEY = 'super-secret-key-abcdef123456';

  logger.error('boom while calling with super-secret-key-abcdef123456 inline');
  logger.warn('config', { apiKey: 'super-secret-key-abcdef123456' });

  const all = lines.join('\n');
  assert.ok(!all.includes('super-secret-key-abcdef123456'), 'key never leaks');
  assert.equal((all.match(/\[REDACTED\]/g) ?? []).length >= 2, true);
});

test('header- and JSON-style secrets are redacted generically', () => {
  process.env.QLOO_API_KEY = 'short'; // <8 chars: exact-match rule off
  process.env.LOG_LEVEL = 'debug';

  logger.warn('headers', { raw: 'X-Api-Key: sk-live-9f8e7d6c' });
  logger.warn('auth', { raw: 'Authorization: Bearer eyJhbGciOi.payload123' });
  logger.info('body', '{"token":"abc123def456","api_key":"zzz999","nested":1}');
  logger.info('field', { password: 'hunter2hunter2' });

  const all = lines.join('\n');
  for (const secret of ['sk-live-9f8e7d6c', 'eyJhbGciOi.payload123', 'abc123def456', 'zzz999', 'hunter2hunter2']) {
    assert.ok(!all.includes(secret), `must not leak: ${secret}`);
  }
  assert.ok(all.includes('[REDACTED]'));
});

test('scrubSecrets is idempotent and leaves clean text untouched', () => {
  process.env.QLOO_API_KEY = 'stable-key-0123456789';
  const clean = '2026-10-15 INFO [qloo] retry 1/2 in 500ms';
  assert.equal(scrubSecrets(clean), clean);
  const dirty = scrubSecrets('key=stable-key-0123456789');
  assert.equal(scrubSecrets(dirty), dirty, 'idempotent');
});

// --- integration: the HTTP error boundary logs through the logger -----------------

test('http error path emits one scoped line with the requestId', async () => {
  process.env.LOG_LEVEL = 'error';
  const { createHttpHandler } = await import('../src/app.js');
  const { createServer } = await import('node:http');

  const server = createServer(createHttpHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    const body = await res.json();

    const line = lines.find((l) => l.includes('INVALID_JSON'));
    assert.ok(line, `expected an [http] log line, got: ${JSON.stringify(lines)}`);
    assert.ok(line.includes(body.error.requestId), 'requestId correlates');
    assert.match(line, /\[http\] POST \//);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

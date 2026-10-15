import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic transport; MOCK_MODE must stay OFF (real pipeline, stubbed fetch).
process.env.QLOO_API_KEY = 'fixture-key';
process.env.QLOO_CACHE_ENABLED = 'false';
process.env.QLOO_MAX_RETRIES = '0';
process.env.QLOO_RATE_LIMIT = '100';
process.env.QLOO_RATE_WINDOW_MS = '1000';
process.env.QLOO_MAX_CONCURRENCY = '10';
delete process.env.MOCK_MODE;

const { qlooClient, QlooApiError } = await import('../src/services/qlooClient.js');
const { searchEntities } = await import('../src/services/entitySearchClient.js');
const { findTags } = await import('../src/services/tasteTagsClient.js');
const { getCrossDomainAffinities } = await import('../src/services/crossDomainClient.js');
const { getAudienceInsights, searchAudiences } = await import(
  '../src/services/audienceInsightsClient.js'
);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '../tests/fixtures');
const manifest = JSON.parse(await readFile(path.join(fixturesDir, 'manifest.json'), 'utf8'));

const realFetch = globalThis.fetch;
const load = async (file) =>
  JSON.parse(await readFile(path.join(fixturesDir, file), 'utf8'));

const CLIENTS = {
  searchEntities,
  findTags,
  getCrossDomainAffinities,
  getAudienceInsights,
  searchAudiences,
  'qlooClient.get': (endpoint, params) => qlooClient.get(endpoint, params),
};

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(rawBody, status) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: { get: () => 'application/json' },
    json: async () => structuredClone(rawBody),
    text: async () => JSON.stringify(rawBody),
  });
}

// --- manifest integrity ---------------------------------------------------------

test('manifest pins exactly 10 scenarios with valid files and clients', async () => {
  assert.equal(manifest.scenarios.length, 10, 'the contract fixes 10 scenarios');
  const ids = new Set();
  for (const s of manifest.scenarios) {
    assert.ok(!ids.has(s.id), `duplicate scenario id ${s.id}`);
    ids.add(s.id);
    assert.ok(CLIENTS[s.client], `unknown client ${s.client}`);
    assert.ok(Array.isArray(s.args), `${s.id}: args must be an array`);
    assert.ok(typeof s.notes === 'string' && s.notes.length > 0);
  }
  // both fixture kinds exist on disk for every scenario
  const files = await readdir(fixturesDir);
  for (const s of manifest.scenarios) {
    assert.ok(files.includes(s.response), `${s.response} missing`);
    assert.ok(files.includes(s.expected), `${s.expected} missing`);
  }
  // scenario coverage: all five service clients plus the raw transport
  const covered = new Set(manifest.scenarios.map((s) => s.client));
  for (const client of Object.keys(CLIENTS)) {
    assert.ok(covered.has(client), `client ${client} has no reference scenario`);
  }
});

// --- golden regression: every scenario round-trips through the real pipeline ----

for (const scenario of manifest.scenarios) {
  test(`golden: ${scenario.id} — ${scenario.title}`, async () => {
    const raw = await load(scenario.response);
    const expected = await load(scenario.expected);
    stubFetch(raw, scenario.status ?? 200);

    if (scenario.error) {
      // try/catch instead of assert.rejects: deterministic control over
      // which assertions run against the escaped error object.
      let caught;
      try {
        await CLIENTS[scenario.client](...scenario.args);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, `${scenario.id}: expected a rejection`);
      assert.ok(caught instanceof QlooApiError, `${scenario.id}: QlooApiError`);
      assert.equal(caught.name, expected.errorName);
      assert.equal(caught.status, expected.status);
      assert.equal(caught.attempts, expected.attempts);
      assert.deepEqual(caught.data, expected.data, 'error body preserved verbatim');
    } else {
      const result = await CLIENTS[scenario.client](...scenario.args);
      assert.deepEqual(
        result,
        expected,
        `${scenario.id}: normalization drifted — review the diff, then regenerate ` +
          'with node server/tests/fixtures/generate.mjs only if intentional'
      );
    }
  });
}

// --- fixture hygiene ------------------------------------------------------------

test('reference fixtures never leak PII (privacy guard scenario set)', async () => {
  const { detectPersonalData } = await import('../src/services/privacyGuard.js');
  for (const file of await readdir(fixturesDir)) {
    if (!file.endsWith('.json')) continue;
    const content = await readFile(path.join(fixturesDir, file), 'utf8');
    const findings = detectPersonalData(JSON.parse(content));
    // Pattern-level PII (email/IP/phone/card/…) must never appear. The
    // denylisted_key and name_hint classes are excluded: entity `name`
    // fields are CULTURAL data (Severance, Nike), and the input-boundary
    // denylist targets user payloads, not Qloo responses.
    const real = findings.filter(
      (f) => !['name_hint', 'denylisted_key'].includes(f.type)
    );
    assert.deepEqual(real, [], `${file} must contain no personal data`);
  }
});

/**
 * Affinity vector service tests (task 50) — pins the PARALLEL query
 * algorithm: bounded worker-pool semantics (runBounded), domain-ordered
 * results under out-of-order completion, per-domain failure isolation,
 * all-failed/strict rejections, waiter timeouts, fail-fast validation,
 * frozen deterministic records and the end-to-end
 * expandAffinityVector pipeline (5-domain vector including the source
 * domain, self-loop removed by the expander).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Env must be configured BEFORE the modules under test load (config
// requires QLOO_API_KEY at import time — repo-wide test pattern).
process.env.QLOO_API_KEY = 'affinity-vector-test-key';

const {
  fetchAffinityVector,
  expandAffinityVector,
  runBounded,
  AffinityVectorError,
  VECTOR_CODES,
  VECTOR_DEFAULTS,
} = await import('../src/services/affinityVectorService.js');
const { MANDATORY_DOMAINS } = await import('../src/services/domainMapper.js');
const { getCrossDomainAffinities } = await import('../src/services/crossDomainClient.js');

const UUID = (tag) => `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;
const SEED_ID = UUID('SEED000');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const row = (tag, name, affinity) => ({
  id: UUID(tag),
  name,
  subtype: 'urn:entity:artist',
  popularity: 0.5,
  affinity,
  tags: [],
});

const pageOf = (...rows) => ({ results: rows, count: rows.length });

test('runBounded: index-ordered results under out-of-order completion', async () => {
  const resolvers = new Map();
  const items = ['a', 'b', 'c', 'd'];
  const pending = runBounded(items, 4, (item) =>
    new Promise((resolve) => resolvers.set(item, () => resolve(item.toUpperCase())))
  );

  // Let the lanes park on their promises, then complete in REVERSE
  // order — result slots must stay index-aligned regardless.
  await tick();
  for (const item of [...items].reverse()) resolvers.get(item)();
  const results = await pending;

  assert.deepEqual(results, ['A', 'B', 'C', 'D']);
});

test('runBounded: concurrency is bounded and lanes saturate the queue', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];

  await runBounded(items, 2, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick();
    inFlight -= 1;
  });

  assert.equal(maxInFlight, 2, 'never more than the limit in flight');
  assert.deepEqual(
    await runBounded([], 3, async () => 1),
    [],
    'empty input'
  );
});

test('fetchAffinityVector: all five domains queried in parallel, domain order kept', async () => {
  const resolvers = new Map();
  const fetchFn = (ids, domain) =>
    new Promise((resolve) => {
      assert.deepEqual(ids, [SEED_ID]);
      resolvers.set(domain, () => resolve(pageOf(row(`M-${domain}`, `Entity ${domain}`, 0.5))));
    });

  const pending = fetchAffinityVector(SEED_ID, { fetchFn });

  // Let all five queries start, then complete in REVERSE order.
  await tick();
  for (const domain of [...MANDATORY_DOMAINS].reverse()) resolvers.get(domain)();
  const vector = await pending;

  assert.deepEqual(vector.domains.map((d) => d.domain), [...MANDATORY_DOMAINS]);
  assert.ok(vector.domains.every((d) => d.status === 'ok'));
  assert.equal(vector.ok, 5);
  assert.equal(vector.failed, 0);
  assert.deepEqual(vector.failures, []);
  assert.equal(vector.domains.find((d) => d.domain === 'music').targetType, 'urn:entity:artist');
  assert.equal(vector.domains.find((d) => d.domain === 'film').count, 1);
  assert.ok(Object.isFrozen(vector.domains));
  assert.ok(!Object.isFrozen(vector.domains[0].page), "page stays caller-owned");
});

test('fetchAffinityVector: one failing domain never aborts its siblings', async () => {
  const fetchFn = async (ids, domain) => {
    if (domain === 'books') {
      throw Object.assign(new Error('upstream 503'), { code: 'UPSTREAM_ERROR' });
    }
    return pageOf(row(`X-${domain}`, `E ${domain}`, 0.3));
  };

  const vector = await fetchAffinityVector(SEED_ID, { fetchFn });

  assert.equal(vector.ok, 4);
  assert.equal(vector.failed, 1);
  assert.deepEqual(
    vector.failures.map((f) => ({ domain: f.domain, code: f.code })),
    [{ domain: 'books', code: 'UPSTREAM_ERROR' }]
  );
  const books = vector.domains.find((d) => d.domain === 'books');
  assert.equal(books.status, 'error');
  assert.equal(books.error.message, 'upstream 503');
  assert.equal(books.page, null);
});

test('fetchAffinityVector: all domains failing rejects typed; strict rejects partials', async () => {
  const down = async () => {
    throw new Error('gateway down');
  };
  await assert.rejects(
    () => fetchAffinityVector(SEED_ID, { fetchFn: down }),
    (err) =>
      err instanceof AffinityVectorError &&
      err.code === VECTOR_CODES.ALL_DOMAINS_FAILED &&
      err.details.failures.length === 5
  );

  const flaky = async (ids, domain) => {
    if (domain === 'fashion') throw new Error('flaky');
    return pageOf(row(`Y-${domain}`, `E ${domain}`, 0.2));
  };
  await assert.rejects(
    () => fetchAffinityVector(SEED_ID, { fetchFn: flaky, strict: true }),
    (err) =>
      err.code === VECTOR_CODES.PARTIAL_FAILURE &&
      err.details.failures.length === 1
  );
});

test('fetchAffinityVector: per-domain waiter timeout is captured, siblings unaffected', async () => {
  const fetchFn = (ids, domain) => {
    if (domain === 'books') return new Promise(() => {}); // hangs forever
    return Promise.resolve(pageOf(row(`T-${domain}`, `E ${domain}`, 0.4)));
  };

  const vector = await fetchAffinityVector(SEED_ID, { fetchFn, timeoutMs: 30 });

  const books = vector.domains.find((d) => d.domain === 'books');
  assert.equal(books.status, 'error');
  assert.equal(books.error.code, VECTOR_CODES.TIMEOUT);
  assert.equal(vector.ok, 4);
  assert.equal(vector.failed, 1);
});

test('fetchAffinityVector: options passthrough (take, concurrency bound)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  const fetchFn = async (ids, domain, opts) => {
    seen.push({ domain, opts });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick();
    inFlight -= 1;
    return pageOf(row(`P-${domain}`, `E ${domain}`, 0.1));
  };

  await fetchAffinityVector(SEED_ID, { fetchFn, take: 25, concurrency: 2 });

  assert.ok(seen.every((s) => s.opts.take === 25));
  assert.ok(maxInFlight <= 2, `max in flight was ${maxInFlight}`);
  assert.equal(VECTOR_DEFAULTS.concurrency, 5);
});

test('fetchAffinityVector: fail-fast validation before any fetch call', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return pageOf();
  };

  await assert.rejects(
    () => fetchAffinityVector('bad id with spaces', { fetchFn }),
    (err) => err.name === 'CrossDomainAffinityError'
  );
  await assert.rejects(
    () => fetchAffinityVector(SEED_ID, { fetchFn, domains: ['blockchain'] }),
    (err) => err.name === 'DomainMappingError'
  );
  await assert.rejects(
    () => fetchAffinityVector(SEED_ID, { fetchFn, domains: [] }),
    (err) => err instanceof AffinityVectorError && err.code === VECTOR_CODES.NO_DOMAINS
  );
  assert.equal(calls, 0, 'zero quota on invalid input');
});

test('fetchAffinityVector: deterministic records for identical data', async () => {
  const fetchFn = async (ids, domain) =>
    pageOf(row(`D-${domain}`, `E ${domain}`, 0.55), row(`D2-${domain}`, `E2 ${domain}`, 0.15));

  assert.deepEqual(
    await fetchAffinityVector(SEED_ID, { fetchFn }),
    await fetchAffinityVector(SEED_ID, { fetchFn })
  );
});

test('expandAffinityVector: full 5-domain vector, self-loop removed by the expander', async () => {
  const fetchFn = async (ids, domain) => {
    if (domain === 'film') {
      // The source domain answer contains the seed itself + a neighbor.
      return pageOf(
        { id: SEED_ID, name: 'The Seed', subtype: 'urn:entity:movie', affinity: 0.99, tags: [] },
        row('F-NEIGHBOR', 'Neighbor Film', 0.6)
      );
    }
    return pageOf(row(`E-${domain}`, `Taste ${domain}`, 0.5));
  };

  const result = await expandAffinityVector(
    { id: SEED_ID, category: 'film' },
    { fetchFn }
  );

  assert.deepEqual([...result.plan.domains], [...MANDATORY_DOMAINS], 'source domain included');
  assert.equal(result.ok, 5);
  assert.equal(result.expansion.totals.droppedSelf, 1, 'seed removed from its own domain');
  const film = result.expansion.domains.find((d) => d.domain === 'film');
  assert.equal(film.count, 1);
  assert.equal(film.entities[0].name, 'Neighbor Film');
  assert.deepEqual({ ...result.expansion.coverage }, { planned: 5, covered: 5, uncovered: [] });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.expansion));
});

test('expandAffinityVector: failing domains surface as coverage gaps + failures', async () => {
  const fetchFn = async (ids, domain) => {
    if (domain === 'dining') throw Object.assign(new Error('no dining today'), { code: 'UPSTREAM_ERROR' });
    return pageOf(row(`Z-${domain}`, `T ${domain}`, 0.4));
  };

  const result = await expandAffinityVector({ id: SEED_ID, domain: 'film' }, { fetchFn });

  assert.equal(result.ok, 4);
  assert.equal(result.failed, 1);
  assert.deepEqual([...result.expansion.coverage.uncovered], ['dining']);
  assert.deepEqual(result.failures.map((f) => f.domain), ['dining']);
});

test('expandAffinityVector: includeSeedDomain=false restores cross-only expansion', async () => {
  const fetchFn = async (ids, domain) => pageOf(row(`C-${domain}`, `T ${domain}`, 0.3));
  const result = await expandAffinityVector(
    { id: SEED_ID, category: 'film' },
    { fetchFn, includeSeedDomain: false }
  );

  assert.deepEqual([...result.plan.domains], ['music', 'books', 'dining', 'fashion']);
  assert.equal(result.ok, 4);
});

test('expandAffinityVector: extra signal ids are merged and deduplicated', async () => {
  const seen = [];
  const fetchFn = async (ids) => {
    seen.push([...ids]);
    return pageOf();
  };

  await expandAffinityVector(
    { id: SEED_ID, category: 'film' },
    { fetchFn, signalIds: [SEED_ID, UUID('EXTRA1')] }
  );

  assert.deepEqual(seen[0], [SEED_ID, UUID('EXTRA1')], 'deduped by the client contract');
});

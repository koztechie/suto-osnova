/**
 * Seed entity resolver RELIABILITY suite (task 164) — hostile and
 * malformed INPUT PARAMETER handling in server/src/services/seedEntityResolver.js.
 *
 * The ingest path (raw anchor shapes, Unicode, domain hints) is pinned
 * in seedResolver.test.js; the happy selection path lives in
 * seedEntityResolver.test.js. This suite covers the ADVERSARIAL seam:
 * what happens when the SEARCH PAGE or the OPTIONS bag carries shapes
 * the happy path never sees. Before the hardening (recorded in
 * PLAN_STATE) every case below crashed with a raw TypeError; the
 * contract now is: hostile input DEGRADES (empty pool, typed failure,
 * defaults), it never crashes and never fabricates an entity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'seed-reliability-test-key';

const {
  resolveTextQuery,
  selectBestCandidate,
  normalizeNameKey,
  SeedResolutionError,
  RESOLUTION_CODES,
} = await import('../src/services/seedEntityResolver.js');
const { InvalidSeedError } = await import('../src/engine/SeedResolver.js');

const UUID = (tag) =>
  `${tag.padEnd(8, '0').slice(0, 8)}-1111-4222-8333-444455556666`;

const movie = (name, id = UUID('AAAAAAAA'), popularity = 0.9) => ({
  id,
  name,
  subtype: 'urn:entity:movie',
  popularity,
  tags: [],
});

/** Search stub returning one canned page (no network). */
function stubSearch(page) {
  const calls = [];
  const fn = async (query, types, opts) => {
    calls.push({ query, types, opts });
    return page;
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// 1. HOSTILE SEARCH PAGES — upstream data is untrusted input.
// ---------------------------------------------------------------------------

test('hostile page: null and primitive entries shrink the pool, never crash', () => {
  const result = selectBestCandidate(
    [null, undefined, 42, 'x', [], movie('Blade Runner')],
    { queryKey: 'blade runner' }
  );

  assert.equal(result.best.name, 'Blade Runner', 'the valid entity still wins');
  assert.equal(result.diagnostics.total, 1,
    'non-object entries are discarded before diagnostics');
});

test('hostile page: a page of pure garbage yields a typed no_results, not a crash', () => {
  const result = selectBestCandidate([null, 0, false, {}, []], {
    queryKey: 'anything',
  });

  assert.equal(result.best, null);
  assert.equal(result.match, 'none');
  assert.deepEqual(result.alternatives, []);
});

test('hostile page: a nameless candidate cannot win but a named peer still can', () => {
  const result = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), subtype: 'urn:entity:movie', popularity: 0.99 },
      movie('Blade Runner', UUID('BBBBBBBB'), 0.5)],
    { queryKey: 'blade runner' }
  );

  assert.equal(result.best.name, 'Blade Runner', 'the nameless entry never wins');
  assert.equal(result.match, 'exact', 'name matching still works');
});

test('hostile page: a nameless-only page degrades to typed no_results', () => {
  const result = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), subtype: 'urn:entity:movie', popularity: 0.9 }],
    { queryKey: 'blade runner' }
  );

  assert.equal(result.best, null, 'no name, no match — the pool degrades');
  assert.equal(result.diagnostics.sawName, false,
    'diagnostics report the name filter emptied the pool');
});

test('hostile page: non-string names (number/object) degrade without crashing', () => {
  const numeric = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), name: 42, subtype: 'urn:entity:movie' }],
    { queryKey: '42' }
  );
  assert.equal(numeric.best, null, 'a numeric name is not a name');

  const mixed = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), name: { toString: () => 'x' }, subtype: 'urn:entity:movie' },
      movie('Blade Runner', UUID('BBBBBBBB'))],
    { queryKey: 'blade runner' }
  );
  assert.equal(mixed.best.name, 'Blade Runner', 'the string-named peer wins');
});

test('hostile page: normalizeNameKey returns the empty key for non-strings', () => {
  assert.equal(normalizeNameKey(undefined), '');
  assert.equal(normalizeNameKey(null), '');
  assert.equal(normalizeNameKey(42), '');
  assert.equal(normalizeNameKey({}), '');
  assert.equal(normalizeNameKey([]), '');
  assert.equal(normalizeNameKey('  Blade   Runner '), 'blade runner',
    'string behavior is unchanged');
});

test('hostile page: string popularity below the gate is filtered, garbage popularity survives as 0', () => {
  // A string popularity is not a number: (e.popularity ?? 0) coerces
  // via >= to false under a numeric gate — it must never crash.
  const gated = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), name: 'Blade Runner', subtype: 'urn:entity:movie', popularity: 'high' }],
    { queryKey: 'blade runner', minPopularity: 0.5 }
  );
  assert.equal(gated.best, null, 'non-numeric popularity fails the gate honestly');

  // Without a gate the same candidate is selectable (popularity is a
  // tiebreaker, not a requirement).
  const open = selectBestCandidate(
    [{ id: UUID('AAAAAAAA'), name: 'Blade Runner', subtype: 'urn:entity:movie', popularity: 'high' }],
    { queryKey: 'blade runner' }
  );
  assert.equal(open.best.name, 'Blade Runner');
});

// ---------------------------------------------------------------------------
// 2. HOSTILE OPTIONS BAGS — caller input is untrusted too.
// ---------------------------------------------------------------------------

test('options: null/array/primitive options degrade to defaults, never destructure-crash', async () => {
  // Object-ish hostile options with a working injection: defaults apply.
  const withSearch = await resolveTextQuery('Blade Runner', {
    search: stubSearch({ results: [movie('Blade Runner')] }),
  });
  assert.ok(withSearch.verified, 'a clean options object works');

  // Fully hostile options bags: the injection is lost, so the call
  // degrades to a TYPED upstream_error (no network in tests) — the
  // guarantee is: no raw TypeError from the options destructure.
  for (const hostile of [null, [], 'garbage', 42, true]) {
    await assert.rejects(
      () => resolveTextQuery('Blade Runner', hostile),
      (err) => {
        assert.ok(err instanceof SeedResolutionError,
          `options ${JSON.stringify(hostile)} raise a typed error, not ${err.constructor.name}`);
        return true;
      }
    );
  }
});

test('options: selectBestCandidate survives a null options bag', () => {
  const result = selectBestCandidate([movie('Blade Runner')], null);
  assert.equal(result.match, 'fuzzy',
    'defaults apply: allowFuzzy stays on, the sole candidate is still selectable');
  assert.equal(result.best.name, 'Blade Runner');
});

test('options: extraTypes as a non-array is ignored, not spread into the types', async () => {
  const search = stubSearch({ results: [movie('Blade Runner')] });
  await resolveTextQuery('Blade Runner', { search, extraTypes: 'urn:entity:movie' });

  const types = search.calls[0].types;
  assert.ok(Array.isArray(types), 'types stay an array');
  assert.equal(types.length, new Set(types).size, 'types stay deduped');
  assert.ok(types.every((t) => typeof t === 'string' && t.length > 1),
    'a bare string was never spread character-wise');
});

test('options: garbage take/minPopularity/weights degrade to typed errors or defaults', async () => {
  // take as a non-number: the search client clamps 1..50; the resolver
  // itself must not crash passing it through.
  const search = stubSearch({ results: [movie('Blade Runner')] });
  const result = await resolveTextQuery('Blade Runner', { search, take: 'lots' });
  assert.ok(result.verified, 'a garbage take never crashes the resolver');
  assert.equal(search.calls[0].opts.take, 'lots',
    'the resolver passes take through verbatim (clamping is the client seam)');

  // minPopularity as a non-number: every comparison is false -> typed
  // failure, never a NaN-crash or a silent pass-through.
  const gated = stubSearch({ results: [movie('Blade Runner')] });
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search: gated, minPopularity: 'high' }),
    (err) => {
      assert.ok(err instanceof SeedResolutionError);
      assert.equal(err.code, RESOLUTION_CODES.NO_RESULTS,
        'a non-numeric gate filters everything -> honest no_results');
      return true;
    }
  );

  // weights as a non-object: the ranker's validated contract throws a
  // typed TypeError — the message must name the parameter.
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search: stubSearch({ results: [movie('Blade Runner')] }), weights: 'heavy' }),
    (err) => {
      assert.ok(err instanceof TypeError, 'weights validation is a TypeError by contract');
      assert.match(err.message, /weights/);
      return true;
    }
  );
});

test('options: a non-function search injection degrades to typed upstream_error', async () => {
  for (const hostile of [null, 'fetch', 42, {}]) {
    await assert.rejects(
      () => resolveTextQuery('Blade Runner', { search: hostile }),
      (err) => {
        assert.ok(err instanceof SeedResolutionError,
          `search: ${JSON.stringify(hostile)} raises SeedResolutionError`);
        assert.equal(err.code, RESOLUTION_CODES.UPSTREAM_ERROR);
        assert.ok(err.cause instanceof TypeError, 'the raw failure is preserved as cause');
        return true;
      }
    );
  }
});

// ---------------------------------------------------------------------------
// 3. INGRESS CROSS-CHECK — typed InvalidSeedError before ANY I/O.
// ---------------------------------------------------------------------------

test('ingress: hostile anchor shapes fail typed with zero search calls', async () => {
  const search = stubSearch({ results: [] });
  const hostile = [42, null, undefined, true, [], {}, { seed: 42 }, { seed: null }];

  for (const input of hostile) {
    await assert.rejects(
      () => resolveTextQuery(input, { search }),
      (err) => {
        assert.ok(err instanceof InvalidSeedError,
          `${JSON.stringify(input)} raises InvalidSeedError, not ${err.constructor.name}`);
        return true;
      }
    );
  }
  assert.equal(search.calls.length, 0, 'zero quota burned on unusable input');
});

test('ingress: an overlong anchor fails typed before any search call', async () => {
  const search = stubSearch({ results: [] });
  await assert.rejects(
    () => resolveTextQuery('x'.repeat(200), { search }),
    (err) => err instanceof InvalidSeedError && err.reason === 'too_long'
  );
  assert.equal(search.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 4. HOSTILE RESULT PAGES THROUGH THE FULL PIPELINE.
// ---------------------------------------------------------------------------

test('pipeline: a search resolving to a non-object page degrades to typed no_results', async () => {
  for (const hostile of [null, undefined, 'boom', 42, { results: 'x' }, { results: null }]) {
    await assert.rejects(
      () => resolveTextQuery('Blade Runner', { search: stubSearch(hostile) }),
      (err) => {
        assert.ok(err instanceof SeedResolutionError,
          `page ${JSON.stringify(hostile)} raises a typed error`);
        assert.equal(err.code, RESOLUTION_CODES.NO_RESULTS);
        return true;
      }
    );
  }
});

test('pipeline: a hostile page with one clean entity still resolves it', async () => {
  const page = {
    results: [null, 42, movie('Blade Runner'), { id: 'not-a-uuid', name: 'Fake' }],
  };
  const result = await resolveTextQuery('Blade Runner', { search: stubSearch(page) });

  assert.equal(result.entity.name, 'Blade Runner', 'the clean entity is selected');
  assert.equal(result.entity.id, UUID('AAAAAAAA'));
  assert.equal(result.idValid, true);
});

test('pipeline: candidates with invalid ids on a hostile page stay excluded (no synthesis)', async () => {
  const page = {
    results: [null, { id: '__proto__', name: 'Blade Runner', subtype: 'urn:entity:movie' },
      { name: 'Blade Runner', subtype: 'urn:entity:movie' }],
  };
  await assert.rejects(
    () => resolveTextQuery('Blade Runner', { search: stubSearch(page) }),
    (err) => {
      assert.ok(err instanceof SeedResolutionError);
      assert.equal(err.code, RESOLUTION_CODES.NO_VALID_ID,
        'candidates existed but none carried a valid id — loud, typed, honest');
      return true;
    }
  );
});

test('pipeline: frozen output survives a hostile page (still frozen, still serializable)', async () => {
  const page = { results: [null, movie('Blade Runner')] };
  const result = await resolveTextQuery('Blade Runner', { search: stubSearch(page) });

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.entity));
  assert.doesNotThrow(() => JSON.stringify(result));
});

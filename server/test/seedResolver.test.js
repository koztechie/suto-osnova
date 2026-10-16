/**
 * SeedResolver tests (task 45) — pins the normalization contract of the
 * input cultural anchor: tolerant ingress shapes, the NFC/cleanup/
 * collapse pipeline, code-point length bounds, domain-hint validation
 * through domainMapper (single source of truth), typed failures, frozen
 * descriptors and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSeed,
  normalizeSeedText,
  countCodePoints,
  InvalidSeedError,
  SEED_REASONS,
  SEED_LIMITS,
} from '../src/engine/SeedResolver.js';
import {
  resolveDomain,
  MANDATORY_DOMAINS,
  DomainMappingError,
} from '../src/services/domainMapper.js';

test('resolveSeed: happy path — descriptor shape, exact values, frozen', () => {
  const seed = resolveSeed('  The   Matrix \n');

  assert.deepEqual({ ...seed }, {
    raw: '  The   Matrix \n',
    normalized: 'The Matrix',
    key: 'the matrix',
    codepoints: 10,
    domain: null,
  });
  assert.ok(Object.isFrozen(seed));
  assert.throws(() => {
    seed.normalized = 'tampered';
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(seed)).key, 'the matrix', 'serializable');
});

test('normalizeSeedText: NFC makes composed and decomposed input identical', () => {
  const composed = resolveSeed('Caf\u00e9 de Flore');
  const decomposed = resolveSeed('Cafe\u0301 de Flore');

  assert.equal(composed.normalized, decomposed.normalized);
  assert.equal(composed.key, decomposed.key);
  assert.equal(composed.codepoints, decomposed.codepoints);
  assert.equal(composed.normalized, 'Caf\u00e9 de Flore');
});

test('normalizeSeedText: zero-width and control characters are neutralized', () => {
  assert.equal(normalizeSeedText('Ma\u200Btrix\uFEFF'), 'Matrix');
  assert.equal(normalizeSeedText('The\u0000\u001FMatrix\u007F'), 'The Matrix');
  assert.equal(normalizeSeedText('Blade\t\r\n Runner'), 'Blade Runner');
  assert.equal(normalizeSeedText('  padded  '), 'padded');
});

test('resolveSeed: raw stays untouched, normalized carries the cleanup', () => {
  const seed = resolveSeed('  A\u200BB   Quiet   Place ');
  assert.equal(seed.raw, '  A\u200BB   Quiet   Place ');
  assert.equal(seed.normalized, 'AB Quiet Place');
});

test('resolveSeed: NOT_A_STRING fails typed for every non-anchor input', () => {
  const badInputs = [42, null, undefined, true, [], Symbol('s'), 3.14];
  for (const input of badInputs) {
    assert.throws(
      () => resolveSeed(input),
      (err) =>
        err instanceof InvalidSeedError &&
        err.reason === SEED_REASONS.NOT_A_STRING &&
        typeof err.details.received === 'string',
      `expected typed NOT_A_STRING for ${String(input)}`
    );
  }
  // details distinguish shapes.
  assert.throws(() => resolveSeed([]), (e) => e.details.received === 'array');
  assert.throws(() => resolveSeed(null), (e) => e.details.received === 'null');
  // Objects with no anchor field at all.
  assert.throws(() => resolveSeed({}), (e) => e.reason === SEED_REASONS.NOT_A_STRING);
});

test('resolveSeed: tolerant object ingress — seed/anchor/query, priority order', () => {
  assert.equal(resolveSeed({ seed: ' Dune ' }).normalized, 'Dune');
  assert.equal(resolveSeed({ anchor: 'Dune Messiah' }).normalized, 'Dune Messiah');
  assert.equal(resolveSeed({ query: 'Dune (2021)' }).normalized, 'Dune (2021)');
  // First present string field wins.
  assert.equal(resolveSeed({ seed: 'Dune', query: 'Blade Runner' }).normalized, 'Dune');
  // Non-string first field falls through to the next alias.
  assert.equal(resolveSeed({ seed: 42, query: 'Dune' }).normalized, 'Dune');
  // An EXPLICITLY empty field fails loudly, never falls through.
  assert.throws(
    () => resolveSeed({ seed: '', query: 'Dune' }),
    (e) => e instanceof InvalidSeedError && e.reason === SEED_REASONS.EMPTY
  );
});

test('resolveSeed: EMPTY — whitespace-only and invisible-only anchors', () => {
  for (const input of ['', '   \t ', '\u200B\u200B', '\u0000\u001F']) {
    assert.throws(
      () => resolveSeed(input),
      (err) =>
        err instanceof InvalidSeedError && err.reason === SEED_REASONS.EMPTY,
      `expected EMPTY for ${JSON.stringify(input)}`
    );
  }
});

test('resolveSeed: code-point length bounds (emoji anchors count right)', () => {
  // The pizza emoji is ONE code point (2 UTF-16 units) — the counting
  // must be code-point based, or surrogate pairs skew every bound.
  assert.equal('\u{1F355}'.length, 2, 'UTF-16 length');
  assert.equal(countCodePoints('\u{1F355}'), 1, 'code-point length');

  // MIN boundary: a 1-code-point anchor fails — including a lone emoji.
  assert.throws(
    () => resolveSeed('a'),
    (e) =>
      e.reason === SEED_REASONS.TOO_SHORT && e.details.codepoints === 1
  );
  assert.throws(
    () => resolveSeed('\u{1F355}'),
    (e) => e.reason === SEED_REASONS.TOO_SHORT && e.details.codepoints === 1
  );
  assert.equal(resolveSeed('ab').codepoints, 2);
  // Two emojis clear the minimum — a legitimate (if odd) dining anchor.
  assert.equal(resolveSeed('\u{1F355}\u{1F355}').codepoints, 2);

  // MAX boundary in code points, not UTF-16 length.
  const atLimit = 'x'.repeat(SEED_LIMITS.MAX_CODEPOINTS);
  assert.equal(resolveSeed(atLimit).codepoints, SEED_LIMITS.MAX_CODEPOINTS);
  assert.throws(
    () => resolveSeed(`${atLimit}x`),
    (e) =>
      e.reason === SEED_REASONS.TOO_LONG &&
      e.details.codepoints === SEED_LIMITS.MAX_CODEPOINTS + 1
  );
  // Surrogate-heavy input cannot skew the budget: 121 emoji = 121 code
  // points (242 UTF-16 units) — still TOO_LONG, counted honestly.
  assert.throws(
    () => resolveSeed('\u{1F355}'.repeat(121)),
    (e) => e.reason === SEED_REASONS.TOO_LONG && e.details.codepoints === 121
  );
});

test('resolveSeed: domain hint via options resolves through domainMapper', () => {
  assert.equal(resolveSeed('Blade Runner', { domain: 'film' }).domain, 'film');
  // Aliases and case/whitespace tolerance come from the mapper itself.
  assert.equal(resolveSeed('Blade Runner', { domain: 'TV SHOW' }).domain, 'film');
  assert.equal(resolveSeed('Blade Runner', { domain: 'restaurants' }).domain, 'dining');
});

test('resolveSeed: domain hint via input object; options override it', () => {
  assert.equal(resolveSeed({ seed: 'Dune', domain: 'books' }).domain, 'books');
  assert.equal(
    resolveSeed({ seed: 'Dune', domain: 'books' }, { domain: 'music' }).domain,
    'music',
    'explicit option wins over the object field'
  );
  // No hint (absent or null) -> domain null, no error.
  assert.equal(resolveSeed({ seed: 'Dune' }).domain, null);
  assert.equal(resolveSeed('Dune', { domain: null }).domain, null);
});

test('resolveSeed: unknown hint fails UNKNOWN_DOMAIN with DomainMappingError cause', () => {
  assert.throws(
    () => resolveSeed('Dune', { domain: 'blockchain' }),
    (err) =>
      err instanceof InvalidSeedError &&
      err.reason === SEED_REASONS.UNKNOWN_DOMAIN &&
      err.details.domain === 'blockchain' &&
      err.cause instanceof DomainMappingError
  );
  // The object-field hint is validated the same way.
  assert.throws(
    () => resolveSeed({ seed: 'Dune', domain: 'cooking-show' }),
    (e) => e.reason === SEED_REASONS.UNKNOWN_DOMAIN
  );
});

test('cross-module: every mandatory domain and its aliases are accepted hints', () => {
  assert.equal(MANDATORY_DOMAINS.length, 5);
  for (const domain of MANDATORY_DOMAINS) {
    assert.equal(resolveSeed('anchor-x', { domain }).domain, domain);
    // Case-insensitive through the shared alias index.
    assert.equal(resolveSeed('anchor-x', { domain: domain.toUpperCase() }).domain, domain);
  }
});

test('determinism: same input -> identical descriptors; caller mutation is irrelevant', () => {
  assert.deepEqual(resolveSeed({ seed: 'Am\u00e9lie' }), resolveSeed({ seed: 'Am\u00e9lie' }));

  const input = { seed: 'Her', domain: 'film' };
  const seed = resolveSeed(input);
  input.seed = 'tampered';
  input.domain = 'blockchain';
  assert.equal(seed.normalized, 'Her', 'descriptor immune to post-hoc input mutation');
  assert.equal(seed.domain, 'film');
  // Keys collide exactly when the anchors are case-variants (dedup contract).
  assert.equal(resolveSeed('HER').key, resolveSeed('her').key);
  assert.notEqual(resolveSeed('Her').key, resolveSeed('Her 2').key);
});

test('InvalidSeedError: typed shape across all failure paths', () => {
  const cases = [
    [42, SEED_REASONS.NOT_A_STRING],
    ['', SEED_REASONS.EMPTY],
    ['a', SEED_REASONS.TOO_SHORT],
    ['x'.repeat(121), SEED_REASONS.TOO_LONG],
    ['xx', SEED_REASONS.UNKNOWN_DOMAIN], // hint path (length checked first)
  ];
  for (const [input, reason] of cases) {
    try {
      resolveSeed(input, reason === SEED_REASONS.UNKNOWN_DOMAIN ? { domain: 'nope' } : undefined);
      assert.fail(`expected InvalidSeedError for reason ${reason}`);
    } catch (err) {
      assert.ok(err instanceof InvalidSeedError, `reason ${reason}: instanceof`);
      assert.ok(err instanceof Error, `reason ${reason}: Error base`);
      assert.equal(err.name, 'InvalidSeedError', `reason ${reason}: name`);
      assert.equal(err.reason, reason, `reason ${reason}: reason field`);
      assert.ok(err.message.length > 0, `reason ${reason}: message`);
    }
  }
});

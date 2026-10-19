/**
 * SeedResolver (task 45) — normalization of the INPUT CULTURAL ANCHOR
 * ("seed"): the raw string a user names ("The Matrix", "Radiohead",
 * "Kyiv", "Blade Runner") turned into a canonical, frozen seed
 * descriptor that the dossier pipeline (task 42, SEED_RESOLUTION) and
 * the Qloo search tools consume.
 *
 * This module is PURE: no I/O, no clocks, no RNG — same input, same
 * descriptor, always. Determinism is pinned by
 * server/test/seedResolver.test.js.
 *
 * Normalization pipeline (normalizeSeedText):
 *   1. Unicode NFC — composed and decomposed input become identical
 *      ("Cafe\u0301" === "Caf\u00e9"), so cache keys and dedup cannot be
 *      bypassed with alternate encodings of the same title;
 *   2. zero-width/invisible characters stripped (U+200B..U+200D,
 *      U+FEFF) — a classic search-injection vector;
 *   3. control characters (C0/C1) replaced with a space, then every
 *      whitespace run collapsed to a single U+0020, then trimmed;
 *   4. length counted in CODE POINTS (not UTF-16 units), so an emoji
 *      anchor counts as one character and the limits cannot be skewed
 *      by surrogate pairs.
 *
 * Ingress is deliberately tolerant (anti-fragile): a plain string OR an
 * object carrying `seed` / `anchor` / `query` is accepted (first present
 * STRING field wins — an explicitly empty field fails loudly as EMPTY,
 * never silently coerced). Everything else fails fast with a typed
 * InvalidSeedError and a machine-readable `reason`.
 *
 * Domain hints are validated against the FIVE mandatory domains through
 * domainMapper.resolveDomain (single source of truth — this module does
 * NOT duplicate the alias vocabulary); an unknown hint fails as
 * UNKNOWN_DOMAIN with the DomainMappingError preserved as `cause`, so a
 * typo'd domain never reaches a Qloo round-trip.
 */

import { resolveDomain, DomainMappingError } from '../services/domainMapper.js';
import { sanitizeText } from '../services/privacyGuard.js';

/** Typed error for unusable cultural anchors. */
export class InvalidSeedError extends Error {
  constructor(message, { reason, details, cause } = undefined) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'InvalidSeedError';
    this.reason = reason;
    this.details = details;
  }
}

/** Machine-readable failure reasons. */
export const SEED_REASONS = Object.freeze({
  NOT_A_STRING: 'not_a_string',
  EMPTY: 'empty',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
  UNKNOWN_DOMAIN: 'unknown_domain',
});

/** Hard bounds on the normalized anchor, counted in code points. */
export const SEED_LIMITS = Object.freeze({
  MIN_CODEPOINTS: 2,
  MAX_CODEPOINTS: 120,
});

/** Tolerant ingress field names, in extraction priority order. */
const SEED_FIELDS = Object.freeze(['seed', 'anchor', 'query']);

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE_RUN = /\s+/g;

/**
 * The normalization pipeline described in the module header. Pure and
 * exported so callers (MCP tools, tests) can normalize without full
 * validation when they only need the text form.
 *
 * OUTPUT PII GUARD (task 165): the last step pattern-redacts unambiguous
 * personal data (emails, phones, SSNs, cards, IPs, JWTs) that a user may
 * have pasted into the anchor. This is the SINGLE choke point: the
 * normalized text is BOTH the search query AND the `seed.normalized` /
 * `anchor` value echoed into every output bundle, so redacting here
 * keeps PII out of all three export formats at the source. Redaction is
 * idempotent and preserves cultural anchors (years, zip-code-like album
 * titles such as "1989", and "Beverly Hills 90210" never match the
 * separator-joined phone pattern). `raw` stays untouched by contract —
 * it is never echoed into an output bundle, only logged under the
 * logger's own secret scrubber.
 */
export function normalizeSeedText(value) {
  const cleaned = value
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
  // Redact PII, then re-collapse whitespace: a redacted segment can
  // leave a double space ("for  [REDACTED]  call" -> "for [REDACTED] call").
  return sanitizeText(cleaned).value.replace(WHITESPACE_RUN, ' ').trim();
}

/** Counts code points (an emoji is one character, not two UTF-16 units). */
export function countCodePoints(value) {
  return [...value].length;
}

function receivedType(input) {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}

/**
 * Extracts the raw anchor string from tolerant ingress shapes. The first
 * present string field wins (even when empty — an explicit empty seed
 * must fail loudly, not fall through to the next alias).
 */
function extractRaw(input) {
  if (typeof input === 'string') return input;
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const field of SEED_FIELDS) {
      if (typeof input[field] === 'string') return input[field];
    }
  }
  return null;
}

/** Extracts the domain hint: explicit option wins over the input object. */
function extractHint(input, options) {
  if (options !== undefined && options !== null && typeof options.domain === 'string') {
    return options.domain;
  }
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    typeof input.domain === 'string'
  ) {
    return input.domain;
  }
  return null;
}

/**
 * Resolves an input cultural anchor into a frozen seed descriptor.
 *
 * @param {string|object} input e.g. "The Matrix", or {seed, domain}
 * @param {{domain?: string}} [options] explicit domain hint override
 * @returns {Readonly<{raw: string, normalized: string, key: string,
 *          codepoints: number, domain: string|null}>}
 *          - `raw`        — the exact extracted string, untouched;
 *          - `normalized` — NFC, cleaned, collapsed, trimmed form
 *                           (this is the search query);
 *          - `key`        — lowercased comparison key for dedup/caches;
 *          - `codepoints` — normalized length in code points;
 *          - `domain`     — canonical domain id (film|music|books|
 *                           dining|fashion) or null when no hint given.
 * @throws {InvalidSeedError} reason NOT_A_STRING | EMPTY | TOO_SHORT |
 *         TOO_LONG | UNKNOWN_DOMAIN — fails fast and typed, so a bad
 *         anchor never burns a Qloo round-trip.
 */
export function resolveSeed(input, options = undefined) {
  const raw = extractRaw(input);
  if (raw === null) {
    throw new InvalidSeedError(
      `seed anchor must be a string or an object with a string ` +
        `"${SEED_FIELDS.join('" / "')}" field; received: ${receivedType(input)}`,
      { reason: SEED_REASONS.NOT_A_STRING, details: { received: receivedType(input) } }
    );
  }

  const normalized = normalizeSeedText(raw);
  if (normalized.length === 0) {
    throw new InvalidSeedError(
      `seed anchor is empty after normalization (raw: ${JSON.stringify(raw)})`,
      { reason: SEED_REASONS.EMPTY, details: { raw } }
    );
  }

  const codepoints = countCodePoints(normalized);
  if (codepoints < SEED_LIMITS.MIN_CODEPOINTS) {
    throw new InvalidSeedError(
      `seed anchor is too short: ${codepoints} code point(s), ` +
        `minimum is ${SEED_LIMITS.MIN_CODEPOINTS}`,
      { reason: SEED_REASONS.TOO_SHORT, details: { codepoints } }
    );
  }
  if (codepoints > SEED_LIMITS.MAX_CODEPOINTS) {
    throw new InvalidSeedError(
      `seed anchor is too long: ${codepoints} code points, ` +
        `maximum is ${SEED_LIMITS.MAX_CODEPOINTS}`,
      { reason: SEED_REASONS.TOO_LONG, details: { codepoints } }
    );
  }

  const hint = extractHint(input, options);
  let domain = null;
  if (hint !== null) {
    try {
      domain = resolveDomain(hint);
    } catch (cause) {
      if (!(cause instanceof DomainMappingError)) throw cause;
      throw new InvalidSeedError(
        `seed domain hint ${JSON.stringify(hint)} is not one of the ` +
          `five mandatory domains`,
        { reason: SEED_REASONS.UNKNOWN_DOMAIN, details: { domain: hint }, cause }
      );
    }
  }

  return Object.freeze({
    raw,
    normalized,
    key: normalized.toLowerCase(),
    codepoints,
    domain,
  });
}

export default resolveSeed;

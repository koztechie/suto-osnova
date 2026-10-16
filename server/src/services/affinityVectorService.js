/**
 * Affinity vector service (task 50) — the PARALLEL QUERY ALGORITHM that
 * fetches the taste affinity vector of a source entity into the target
 * Qloo domains.
 *
 * Task 49 defined the PURE side (plan + fold). This module performs the
 * I/O: it fires one `getCrossDomainAffinities` call per target domain
 * CONCURRENTLY through a bounded worker pool, captures per-domain
 * outcomes in isolation, and returns a deterministic record the
 * expander folds into the final expansion.
 *
 * PARALLELISM MODEL (`runBounded`, exported and unit-tested):
 *   - a fixed number of lanes (default 5 — one per mandatory domain)
 *     pull work from a shared cursor; a lane awaits its in-flight
 *     query and immediately takes the next domain;
 *   - the RESULT ORDER IS THE DOMAIN ORDER, never the completion
 *     order: late answers land in their slots, so repeated runs with
 *     the same data produce byte-identical records;
 *   - concurrency is BOUNDED on purpose even though `qlooClient`
 *     already rate-limits: an unbounded fan-out would enqueue 5
 *     simultaneous waits per resolution batch and starve other agent
 *     traffic. `concurrency` is clamped to 1..domains.length.
 *
 * FAILURE MODEL:
 *   - one domain failing (upstream error, malformed payload, timeout)
 *     NEVER aborts its siblings — the failure is captured as
 *     {status: 'error', error: {code, message}} and the domain lands in
 *     `failures`; the expander reports it via coverage.uncovered;
 *   - a per-domain TIMEOUT (default 15s) bounds the WAITER, not the
 *     transport (the client keeps its own retry/limiter lifecycle);
 *   - if EVERY domain fails the whole vector fails typed
 *     (AffinityVectorError, code all_domains_failed) — that is an
 *     upstream outage, not a partial answer;
 *   - `strict: true` turns ANY domain failure into a typed
 *     partial_failure rejection.
 *
 * `expandAffinityVector` composes the full pipeline: expansionPlan
 * (includeSeedDomain: TRUE by default — the 5-domain vector includes
 * same-domain neighbors of the seed; the seed itself is removed later
 * by expandTastes) -> parallel fetch -> expandTastes fold.
 *
 * The fetch function is INJECTABLE (`options.fetchFn`) so the whole
 * algorithm is testable deterministically without network; production
 * callers inherit the full transport stack (auth, rate limiting,
 * retries, caching, single-flight, privacy guard, MOCK_MODE fixtures).
 */

import {
  getCrossDomainAffinities,
  resolveEntityIds,
} from './crossDomainClient.js';
import { MANDATORY_DOMAINS, primaryInsightType } from './domainMapper.js';
import {
  expansionPlan,
  expandTastes,
  ExpansionInputError,
} from '../engine/CrossDomainExpander.js';

/** Typed error for vector-level failures. */
export class AffinityVectorError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AffinityVectorError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable vector failure codes. */
export const VECTOR_CODES = Object.freeze({
  NO_DOMAINS: 'no_domains',
  ALL_DOMAINS_FAILED: 'all_domains_failed',
  PARTIAL_FAILURE: 'partial_failure',
  TIMEOUT: 'timeout',
});

/** Algorithm defaults (documented, exported, overridable). */
export const VECTOR_DEFAULTS = Object.freeze({
  take: 10,
  concurrency: 5,
  timeoutMs: 15_000,
});

/** Internal timeout marker — surfaced as error code `timeout`. */
class VectorTimeoutError extends Error {
  constructor(domain, ms) {
    super(`affinity query for domain "${domain}" exceeded ${ms}ms`);
    this.name = 'VectorTimeoutError';
    this.code = VECTOR_CODES.TIMEOUT;
  }
}

/** Default transport: agent domain -> insights URN -> the client. */
const defaultFetch = (signalIds, domain, opts) =>
  getCrossDomainAffinities(signalIds, primaryInsightType(domain), opts);

/**
 * Bounded-parallel map: runs `worker` over `items` with at most
 * `limit` in flight, preserving INDEX order in the results (completion
 * order never leaks into the output). Exported for direct unit testing.
 *
 * @returns {Promise<Array>} results aligned with items.
 */
export async function runBounded(items, limit, worker) {
  const total = items.length;
  const results = new Array(total);
  if (total === 0) return results;

  const lanes = Math.min(
    Math.max(1, Math.trunc(limit)),
    total
  );
  let cursor = 0;
  const lane = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

/** Bounds the WAITER with a timer; clears it in every path. */
async function withTimeout(promise, domain, ms) {
  if (!(ms > 0)) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new VectorTimeoutError(domain, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Compact, serializable error description (no stacks, bounded length). */
function describeError(err) {
  const code =
    typeof err?.code === 'string' && err.code.length > 0
      ? err.code
      : typeof err?.name === 'string' && err.name.length > 0
        ? err.name
        : 'unknown_error';
  const message =
    typeof err?.message === 'string' && err.message.length > 0
      ? err.message
      : String(err);
  return Object.freeze({ code, message: message.slice(0, 300) });
}

/**
 * Fetches the affinity vector: one cross-domain query per target
 * domain, in parallel, results in domain order.
 *
 * @param {string|string[]} signalIds source entity id(s) (validated and
 *        deduplicated by the cross-domain client before any I/O).
 * @param {object} [options]
 * @param {string[]} [options.domains] target domains (default: ALL five
 *        mandatory domains — the full vector).
 * @param {number} [options.take=10] page size per domain.
 * @param {number} [options.concurrency=5] max in-flight queries (1..50).
 * @param {number} [options.timeoutMs=15000] per-domain waiter bound; 0 disables.
 * @param {boolean} [options.strict=false] reject on ANY domain failure.
 * @param {Function} [options.fetchFn] injectable fetch — receives the
 *        AGENT domain id plus {take}; the default transport converts
 *        it to the insights URN via domainMapper before calling Qloo.
 * @returns {Promise<Readonly<{signalIds, domains, ok, failed, failures}>>}
 *          `domains` holds one record per target domain, in canonical
 *          order: {domain, targetType, status, count, error, page}.
 * @throws {AffinityVectorError} no_domains | all_domains_failed |
 *         partial_failure (strict).
 */
export async function fetchAffinityVector(signalIds, options = {}) {
  const {
    domains = [...MANDATORY_DOMAINS],
    take = VECTOR_DEFAULTS.take,
    concurrency = VECTOR_DEFAULTS.concurrency,
    timeoutMs = VECTOR_DEFAULTS.timeoutMs,
    strict = false,
    fetchFn = defaultFetch,
  } = options;

  // Synchronous fail-fast validation: a bad id or domain never reaches
  // the pool (and never burns quota). Agent domains map to insights
  // target URNs via domainMapper (the client's own alias table lacks
  // the agent vocabulary "books/dining/fashion" but accepts raw URNs).
  const ids = resolveEntityIds(signalIds);
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new AffinityVectorError(
      'fetchAffinityVector: domains must be a non-empty array',
      { code: VECTOR_CODES.NO_DOMAINS, details: { domains } }
    );
  }
  const targetTypes = domains.map((d) => primaryInsightType(d));

  const records = await runBounded(
    domains,
    concurrency,
    async (domain, index) => {
      try {
        const page = await withTimeout(
          Promise.resolve().then(() => fetchFn(ids, domain, { take })),
          domain,
          timeoutMs
        );
        const count =
          typeof page?.count === 'number'
            ? page.count
            : Array.isArray(page?.results)
              ? page.results.length
              : 0;
        return Object.freeze({
          domain,
          targetType: targetTypes[index],
          status: 'ok',
          count,
          error: null,
          page: page ?? null,
        });
      } catch (err) {
        return Object.freeze({
          domain,
          targetType: targetTypes[index],
          status: 'error',
          count: 0,
          error: describeError(err),
          page: null,
        });
      }
    }
  );

  const failures = records
    .filter((r) => r.status === 'error')
    .map((r) => Object.freeze({ domain: r.domain, ...r.error }));

  if (failures.length === records.length && records.length > 0) {
    throw new AffinityVectorError(
      `every target domain failed for the affinity vector (${ids.length} ` +
        `signal entit${ids.length === 1 ? 'y' : 'ies'}) — upstream outage`,
      { code: VECTOR_CODES.ALL_DOMAINS_FAILED, details: { failures } }
    );
  }
  if (strict && failures.length > 0) {
    throw new AffinityVectorError(
      `strict mode: ${failures.length} domain(s) failed — ${failures
        .map((f) => f.domain)
        .join(', ')}`,
      { code: VECTOR_CODES.PARTIAL_FAILURE, details: { failures } }
    );
  }

  return Object.freeze({
    signalIds: Object.freeze([...ids]),
    domains: Object.freeze(records),
    ok: records.length - failures.length,
    failed: failures.length,
    failures: Object.freeze(failures),
  });
}

/**
 * End-to-end taste vector: plan -> PARALLEL fetch -> expandTastes fold.
 *
 * Unlike task 49's default plan, the vector includes the seed's OWN
 * domain by default (`includeSeedDomain: true`) — same-domain
 * neighbors complete the picture; the seed entity itself is removed
 * later by expandTastes (self-loop invariant).
 *
 * @param {{id: string, domain?: string, category?: string}} seed resolved
 *        seed entity (task 47 shape); its id is the primary signal.
 * @param {object} [options] fetchAffinityVector options plus:
 *        includeSeedDomain (default true), maxPerDomain, and
 *        `signalIds` (extra signal entities beyond the seed).
 * @returns {Readonly<{plan, expansion, vector, ok, failed, failures}>}
 * @throws {ExpansionInputError} on unusable seeds (task 49 contract);
 *         {AffinityVectorError} on vector-level failures.
 */
export async function expandAffinityVector(seed, options = {}) {
  const {
    includeSeedDomain = true,
    signalIds = undefined,
    maxPerDomain = undefined,
    ...fetchOptions
  } = options;

  const plan = expansionPlan(seed, { includeSeedDomain, maxPerDomain });
  const ids = signalIds === undefined ? seed.id : [seed.id, ...signalIds];

  const vector = await fetchAffinityVector(ids, {
    ...fetchOptions,
    domains: plan.domains,
  });

  const payloads = {};
  for (const record of vector.domains) {
    if (record.status === 'ok' && record.page !== null) {
      payloads[record.domain] = record.page;
    }
  }
  const expansion = expandTastes(plan, payloads, { maxPerDomain });

  return Object.freeze({
    plan,
    expansion,
    vector,
    ok: vector.ok,
    failed: vector.failed,
    failures: vector.failures,
  });
}

const affinityVectorService = {
  fetchAffinityVector,
  expandAffinityVector,
  runBounded,
  AffinityVectorError,
  VECTOR_CODES,
  VECTOR_DEFAULTS,
  ExpansionInputError,
};

export default affinityVectorService;

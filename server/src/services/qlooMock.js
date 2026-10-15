/**
 * Mock transport for MOCK_MODE=true: serves hand-recorded static Qloo
 * response fixtures (see server/src/mocks/qlooFixtures.js) instead of
 * hitting the network, keeping the whole agent autonomous offline with
 * zero key quota consumption.
 *
 * Wired into `qlooClient.qlooRequest` at the same seam where live
 * `performRequest` runs, so EVERY service client (search, tags,
 * insights, audiences, cross-domain …) works unchanged: they all funnel
 * through the one transport. In mock mode the transport additionally:
 * - BYPASSES the response cache entirely (mock fixtures must never
 *   pollute the on-disk cache, nor be served to live traffic after
 *   MOCK_MODE is switched off);
 * - SKIPS the rate limiter and retries (nothing quota-bound can fail).
 *
 * Matching: exact per declared query param (arrays mean "any of").
 * Specific fixtures win over `fallback: true` entries. When NOTHING
 * matches — including fallbacks, e.g. an unknown endpoint — the request
 * fails loudly with MockFixtureNotFoundError (with the URL and hints)
 * rather than inventing data silently: an offline agent must know when
 * it stepped outside the recorded surface.
 */

import { QLOO_FIXTURES } from '../mocks/qlooFixtures.js';
import { createLogger } from '../logger.js';

const log = createLogger('qlooMock');

/** Error for "MOCK_MODE is on but nothing serves this request". */
export class MockFixtureNotFoundError extends Error {
  constructor({ method, pathname, search }) {
    super(
      `MOCK_MODE: no fixture matches ${method} ${pathname}${search}. ` +
        'Add one to server/src/mocks/qlooFixtures.js (record it from the ' +
        'live API), or turn MOCK_MODE off to hit the real Qloo API.'
    );
    this.name = 'MockFixtureNotFoundError';
    this.code = 'MOCK_FIXTURE_NOT_FOUND';
    this.details = { method, path: pathname, query: search.replace(/^\?/, '') };
  }
}

/** Checks a fixture's declared query params against the actual request. */
function matchesQuery(spec, params) {
  for (const [key, expected] of Object.entries(spec)) {
    // Case-insensitive: query values are free text ("Lucali" vs
    // "lucali"), and every structured URN we match is lowercase anyway.
    const actual = (params.get(key) ?? '').toLowerCase();
    const options = Array.isArray(expected) ? expected : [expected];
    if (!options.some((candidate) => String(candidate).toLowerCase() === actual)) {
      return false;
    }
  }
  return true;
}

/**
 * Finds the fixture serving a request: specific entries (in declaration
 * order) first, then fallbacks.
 * @returns {object|null}
 */
export function findMockFixture(method, url) {
  const params = url.searchParams;
  let fallback = null;

  for (const fixture of QLOO_FIXTURES) {
    if (fixture.method !== method || fixture.path !== url.pathname) continue;
    if (fixture.fallback) {
      fallback ??= fixture;
      continue;
    }
    if (matchesQuery(fixture.match?.query ?? {}, params)) return fixture;
  }
  return fallback;
}

/**
 * Serves one request from fixtures. Returns the parsed JSON body — the
 * same value `performRequest` would resolve to — so the surrounding
 * pipeline (single-flight, service-client normalization, envelope
 * building) behaves identically to live mode.
 *
 * @throws {MockFixtureNotFoundError}
 */
export async function mockQlooRequest(method, url) {
  const fixture = findMockFixture(method, url);
  if (!fixture) {
    throw new MockFixtureNotFoundError({
      method,
      pathname: url.pathname,
      search: url.search,
    });
  }

  // Function fixtures build a fresh body per call (take/fallback-aware);
  // object fixtures are cloned so callers can never mutate the registry.
  const body =
    typeof fixture.response === 'function'
      ? fixture.response({ params: url.searchParams, url })
      : structuredClone(fixture.response);

  log.warn(`served fixture for ${method} ${url.pathname}${url.search}`, {
    fixture: fixture.name,
  });
  return body;
}

const qlooMock = { mockQlooRequest, findMockFixture, MockFixtureNotFoundError };

export default qlooMock;

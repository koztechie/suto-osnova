/**
 * Global HTTP error handler: transforms Qloo network/transport failures
 * and typed domain errors into ONE structured JSON envelope with
 * machine-readable codes (task 35).
 *
 * Envelope (never leaks stacks or internal messages for unexpected
 * bugs — those are logged to stderr with the requestId instead):
 *   {
 *     status: 'error',
 *     service: 'suto-osnova',
 *     error: { code, message, requestId },
 *     upstream?: { status, attempts }   // Qloo transport failures only
 *   }
 *
 * Qloo transport failures are ALREADY wrapped in QlooApiError by the
 * transport layer (task 17), so a raw TypeError/SyntaxError escaping to
 * this boundary is OUR bug -> 500 INTERNAL, never mislabeled as an
 * upstream outage.
 *
 * Code map:
 *   504 QLOO_TIMEOUT          upstream timeout / caller abort exhausted
 *   503 QLOO_RATE_LIMITED     upstream 429 after retries
 *   503 MOCK_FIXTURE_NOT_FOUND  offline mode asked for an unrecorded call
 *   502 QLOO_AUTH             upstream 401/403 (key rejected)
 *   502 QLOO_UPSTREAM         upstream 5xx
 *   502 QLOO_REJECTED         other upstream 4xx (our params refused)
 *   502 QLOO_NETWORK          DNS/connection failures after retries
 *   400 PII_DETECTED          privacy guard refused the input (task 25)
 *   400 <typed codes>         domain validators (INVALID_DOMAIN, …)
 *   413 PAYLOAD_TOO_LARGE     request body over the limit
 *   400 INVALID_JSON          unparseable request body
 *   500 INTERNAL              unexpected server-side bug
 */

// Correlation ids come from the zero-dependency ids.js (request ids are
// correlation identifiers, never secrets — measured budget: node:crypto
// import ~2.8MB, global WebCrypto ~0.7MB, ids.js ~0.05MB, task 38).
import { newRequestId } from './ids.js';

// Classification is DUCK-TYPED on stable error `name`s (every error
// class in this project sets this.name as part of its contract, and
// tests assert it). Eager instanceof-imports would drag the ENTIRE
// service graph (qlooClient, cache, privacy, mock fixtures) onto the
// HTTP server boot path — measured at ~5MB RSS (task 38), so the
// boundary stays import-free.
const TYPED_INPUT_ERROR_NAMES = new Set([
  'EntitySearchError',
  'TasteTagsError',
  'CrossDomainAffinityError',
  'AudienceInsightsError',
  'DomainMappingError',
  // Caller-input problems at the generate routes' edges (tasks 111+):
  // an unusable/unresolvable seed or a malformed request body is a
  // 4xx, never a 500.
  'RequestValidationError',
  'InvalidSeedError',
  'SeedResolutionError',
]);

/**
 * Typed 400 for malformed caller input at a route's validation edge.
 * The `code` is forwarded verbatim into the error envelope so a client
 * can distinguish a missing seed from a bad format.
 */
export class RequestValidationError extends Error {
  constructor(message, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'RequestValidationError';
    this.code = code;
  }
}

const TIMEOUT_CAUSE_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ABORT_ERR']);
const TIMEOUT_CAUSE_NAMES = new Set(['AbortError', 'TimeoutError']);

function isTimeoutCause(cause) {
  if (!cause || cause === null) return false;
  if (TIMEOUT_CAUSE_NAMES.has(cause.name)) return true;
  if (TIMEOUT_CAUSE_CODES.has(cause.code)) return true;
  return isTimeoutCause(cause.cause);
}

/**
 * Pure classification: any error -> { httpStatus, code, message,
 * upstream? }. Exported for direct table-driven testing.
 */
export function classifyError(err) {
  // --- Qloo transport layer (already wrapped by task 17) ---------------
  if (err?.name === 'QlooApiError') {
    const upstream =
      err.status !== null && err.status !== undefined
        ? { status: err.status, attempts: err.attempts }
        : { attempts: err.attempts };

    if (err.status === null || err.status === undefined) {
      return isTimeoutCause(err.cause)
        ? { httpStatus: 504, code: 'QLOO_TIMEOUT', message: 'Qloo request timed out', upstream }
        : { httpStatus: 502, code: 'QLOO_NETWORK', message: 'Qloo is unreachable (network failure)', upstream };
    }
    if (err.status === 401 || err.status === 403) {
      return { httpStatus: 502, code: 'QLOO_AUTH', message: 'Qloo rejected the API credentials', upstream };
    }
    if (err.status === 429) {
      return { httpStatus: 503, code: 'QLOO_RATE_LIMITED', message: 'Qloo rate limit exhausted (retries spent)', upstream };
    }
    if (err.status >= 500) {
      return { httpStatus: 502, code: 'QLOO_UPSTREAM', message: `Qloo upstream failure (HTTP ${err.status})`, upstream };
    }
    return { httpStatus: 502, code: 'QLOO_REJECTED', message: `Qloo refused the request (HTTP ${err.status})`, upstream };
  }

  // --- offline mode misconfiguration ------------------------------------
  if (err?.name === 'MockFixtureNotFoundError') {
    return {
      httpStatus: 503,
      code: 'MOCK_FIXTURE_NOT_FOUND',
      message: 'MOCK_MODE has no fixture for this call (see server/src/mocks/qlooFixtures.js)',
    };
  }

  // --- privacy guard (task 25) -------------------------------------------
  if (err?.name === 'PrivacyError') {
    return { httpStatus: 400, code: 'PII_DETECTED', message: err.message };
  }

  // --- typed domain validators: forward their precise code ---------------
  if (TYPED_INPUT_ERROR_NAMES.has(err?.name)) {
    return { httpStatus: 400, code: err.code ?? 'INVALID_INPUT', message: err.message };
  }

  // --- request-body pipeline (bodyParser) ---------------------------------
  if (typeof err.status === 'number') {
    if (err.status === 413) {
      return { httpStatus: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' };
    }
    if (err.status === 400) {
      return { httpStatus: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
    }
    return { httpStatus: err.status, code: `HTTP_${err.status}`, message: err.message };
  }

  // --- caller aborts / timeouts anywhere else ------------------------------
  if (TIMEOUT_CAUSE_NAMES.has(err.name) || TIMEOUT_CAUSE_CODES.has(err.code)) {
    return { httpStatus: 504, code: 'TIMEOUT', message: 'Operation timed out' };
  }

  // Everything else escaped UNWRAPPED: a transport failure would have
  // been a QlooApiError, so this is an internal bug — generic message,
  // the truth goes to stderr with the requestId.
  return { httpStatus: 500, code: 'INTERNAL', message: 'Internal server error' };
}

/**
 * Writes the structured error envelope. Crash-safe: if the response is
 * already streaming, the socket is destroyed instead of corrupting it.
 */
export function sendError(req, res, err, requestId = newRequestId()) {
  if (res.headersSent) {
    res.destroy();
    return;
  }

  const { httpStatus, code, message, upstream } = classifyError(err);

  const body = {
    status: 'error',
    service: 'suto-osnova',
    error: { code, message, requestId },
  };
  if (upstream) body.upstream = upstream;

  res.writeHead(httpStatus, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
  });
  res.end(JSON.stringify(body));
  if (httpStatus === 413) {
    // The body was only partially consumed (bodyParser paused); drop the
    // remainder AFTER the envelope is flushed — the client gets the 413
    // before any connection reset.
    res.once('finish', () => req.destroy?.());
  }
  return { httpStatus, code };
}

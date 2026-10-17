/**
 * SUTO OSNOVA — backend client.
 * Native fetch() only. All intelligence (Qloo, LLM) is computed by the
 * local Node gateway; this module never touches upstream directly and
 * never holds an API key.
 */

const API_BASE = '/api';

/** Typed transport failure with the HTTP status preserved. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK', requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function request(path, init) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    throw new ApiError('Backend is unreachable (network failure)', { code: 'NETWORK', cause });
  }

  const body = await parseBody(response);

  if (!response.ok) {
    // The gateway's typed envelope: { status:'error', error:{code,message,requestId} }.
    const envelope = typeof body === 'object' && body !== null ? body.error : null;
    throw new ApiError(envelope?.message ?? `Request failed (HTTP ${response.status})`, {
      status: response.status,
      code: envelope?.code ?? `HTTP_${response.status}`,
      requestId: envelope?.requestId ?? response.headers.get('x-request-id'),
    });
  }

  return body;
}

/**
 * Fetch the static domain registry (GET /api/categories).
 * Returns { status, domains: [...] }.
 */
export function fetchCategories() {
  return request('/categories');
}

/**
 * Generate a dossier for one mode.
 *
 * @param {object} params
 * @param {string} params.seed   Cultural anchor text.
 * @param {string} params.mode   worldbuilder | experiential | antithesis.
 * @param {string} params.format json | markdown | html.
 * @returns {Promise<{kind:'json'|'markdown'|'html', payload: object|string}>}
 *   The parsed response tagged with its kind so the UI can render it.
 */
export async function generateDossier({ seed, mode, format = 'json' }) {
  const raw = await request(`/generate/${encodeURIComponent(mode)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed, format }),
  });

  if (format === 'json') {
    return { kind: 'json', payload: raw };
  }
  // markdown/html responses arrive as text bodies.
  return { kind: format, payload: raw };
}

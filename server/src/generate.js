/**
 * Generate routes (task 111) — the HTTP surface for MODE 1.
 *
 * POST /api/generate/worldbuilder — takes { seed, options?, format? }
 * and returns the Character & Scene Dossier generated through the
 * REAL Qloo clients (lazy-imported, so the transport chain stays off
 * the server boot path and only loads when a request actually runs).
 *
 * CLIENT WIRING: the mode's injectable contract is satisfied by the
 * production service functions — affinityFn -> getCrossDomainAffinities,
 * search/searchFn -> searchEntities (both the seed probe
 * `search(text, types, {take})` and the layer probe
 * `searchFn(query, [urn], {take})` share this signature), tagsFn ->
 * findTags, insightsFn -> getAudienceInsights. The transport stack
 * (auth, rate limiting, retries, cache, privacy guard) is inherited
 * from qlooClient; the API key NEVER reaches the response.
 *
 * RESPONSE FORMATS: `json` (default) returns the STANDARDIZED envelope
 * (task 103 exportJson); `markdown` returns the semantic document
 * (task 102); `html` returns the print-ready page (task 104). All
 * carry an X-Request-Id correlation header.
 *
 * ERRORS: caller-input problems (missing seed, bad format, an
 * unusable or unresolvable seed) surface as a 400 typed envelope via
 * the global boundary; Qloo transport failures map to 5xx by the
 * task-35 code map. The route throws; the boundary writes.
 */

import { RequestValidationError } from './httpErrors.js';

/** The supported response formats. */
export const GENERATE_FORMATS = Object.freeze(['json', 'markdown', 'html']);

const validateBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError('a JSON body object is required', 'INVALID_BODY');
  }
  const { seed, format, options } = body;
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    throw new RequestValidationError(
      'a non-empty string `seed` is required', 'INVALID_SEED'
    );
  }
  if (format !== undefined && !GENERATE_FORMATS.includes(format)) {
    throw new RequestValidationError(
      `format must be one of ${GENERATE_FORMATS.join(' | ')}`, 'INVALID_FORMAT'
    );
  }
  if (options !== undefined && (typeof options !== 'object' || options === null
    || Array.isArray(options))) {
    throw new RequestValidationError('options must be a JSON object', 'INVALID_OPTIONS');
  }
  return { seed: seed.trim(), format: format ?? 'json', options: options ?? {} };
};

/** The production Qloo clients (lazy, loaded only when a request runs). */
async function realClients() {
  const { searchEntities } = await import('./services/entitySearchClient.js');
  const { getCrossDomainAffinities } = await import('./services/crossDomainClient.js');
  const { findTags } = await import('./services/tasteTagsClient.js');
  const { getAudienceInsights } = await import('./services/audienceInsightsClient.js');
  return { searchEntities, getCrossDomainAffinities, findTags, getAudienceInsights };
}

/** HTTP handler for POST /api/generate/worldbuilder.
 *
 * @param {object} req the node request.
 * @param {object} res the node response.
 * @param {object} body the parsed JSON body.
 * @param {string} requestId the correlation id.
 * @param {object} [clients] TEST-ONLY dependency injection — the
 *        real Qloo clients are used when it is absent. Never taken
 *        from the request body (a caller cannot inject clients).
 */
export async function handleGenerateWorldbuilder(req, res, body, requestId, clients) {
  const { seed, format, options } = validateBody(body);

  // Lazy imports: the mode + the whole Qloo transport chain load only
  // when a request runs, keeping the boot path light (task 38).
  const { runWorldbuilder } = await import('./modes/WorldbuilderMode.js');
  const wired = clients ?? await realClients();

  const bundle = await runWorldbuilder(seed, {
    affinityFn: wired.getCrossDomainAffinities,
    search: wired.searchEntities,
    searchFn: wired.searchEntities,
    tagsFn: wired.findTags,
    insightsFn: wired.getAudienceInsights,
    ...options,
  });

  const headers = {
    'X-Request-Id': requestId,
    'Cache-Control': 'no-store',
  };

  if (format === 'markdown') {
    const { markdownFromBundle } = await import('./formatters/MarkdownExporter.js');
    res.writeHead(200, { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end(markdownFromBundle(bundle));
    return;
  }
  if (format === 'html') {
    const { exportHtml } = await import('./formatters/HtmlPrintFormatter.js');
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(exportHtml(bundle));
    return;
  }

  // json (default): the standardized envelope (task 103).
  const { exportJson } = await import('./formatters/JsonExporter.js');
  res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'suto-osnova',
    dossier: exportJson(bundle),
  }));
}

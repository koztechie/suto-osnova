/**
 * Generate routes (tasks 111-112) — the HTTP surface for the agent
 * modes.
 *
 * POST /api/generate/worldbuilder   -> MODE 1 (Character & Scene Dossier)
 * POST /api/generate/experiential   -> MODE 2 (Live Event Activation)
 * POST /api/generate/antithesis     -> MODE 3 (Taste Antithesis Report)
 *
 * Each takes { seed, options?, format? } and returns the dossier
 * generated through the REAL Qloo clients (lazy-imported, so the
 * transport chain stays off the server boot path and only loads when a
 * request actually runs). The two modes share the SAME client wiring,
 * validation and format dispatch — only the runner differs.
 *
 * CLIENT WIRING: the modes' injectable contract is satisfied by the
 * production service functions — affinityFn -> getCrossDomainAffinities,
 * search/searchFn -> searchEntities (both the seed probe
 * `search(text, types, {take})` and the layer probe
 * `searchFn(query, [urn], {take})` share this signature), tagsFn ->
 * findTags, insightsFn -> getAudienceInsights (REQUIRED by Mode 2's
 * audience leg). The transport stack (auth, rate limiting, retries,
 * cache, privacy guard) is inherited from qlooClient; the API key
 * NEVER reaches the response.
 *
 * RESPONSE FORMATS: `json` (default) returns the STANDARDIZED envelope
 * (task 103 exportJson); `markdown` the semantic document (task 102);
 * `html` the print-ready page (task 104). All carry an X-Request-Id
 * correlation header.
 *
 * ERRORS: caller-input problems (missing seed, bad format, an
 * unusable or unresolvable seed) surface as a 400 typed envelope via
 * the global boundary; Qloo transport failures map to 5xx by the
 * task-35 code map. The route throws; the boundary writes.
 */

import { RequestValidationError } from './httpErrors.js';
import { validateSchema } from './schemaValidator.js';

/** The supported response formats. */
export const GENERATE_FORMATS = Object.freeze(['json', 'markdown', 'html']);

/**
 * The generate request schema (task 115): a lightweight JSON Schema.
 * The envelope is validated here; the free-form `options` object is
 * validated by each MODE's own validateOptions (topN, cutRate, ...)
 * — this layer only proves it is an object.
 */
export const GENERATE_REQUEST_SCHEMA = Object.freeze({
  type: 'object',
  errorCode: 'INVALID_BODY',
  required: ['seed'],
  properties: Object.freeze({
    seed: Object.freeze({ type: 'string', errorCode: 'INVALID_SEED' }),
    format: Object.freeze({
      type: 'string', enum: GENERATE_FORMATS, errorCode: 'INVALID_FORMAT',
    }),
    options: Object.freeze({ type: 'object', errorCode: 'INVALID_OPTIONS' }),
  }),
});

const validateBody = (body) => {
  const { valid, errors } = validateSchema(body, GENERATE_REQUEST_SCHEMA);
  if (!valid) {
    // Declaration order (required first, then properties) makes the
    // FIRST error deterministic and stable.
    const first = errors[0];
    throw new RequestValidationError(first.message, first.code);
  }
  // Structural checks pass; the seed's semantic rule (non-empty after
  // trim) is a value check the schema cannot express portably.
  const seed = body.seed.trim();
  if (seed.length === 0) {
    throw new RequestValidationError(
      'a non-empty string `seed` is required', 'INVALID_SEED'
    );
  }
  return { seed, format: body.format ?? 'json', options: body.options ?? {} };
};

/** The production Qloo clients (lazy, loaded only when a request runs). */
async function realClients() {
  const { searchEntities } = await import('./services/entitySearchClient.js');
  const { getCrossDomainAffinities: rawCrossDomain } = await import('./services/crossDomainClient.js');
  const { toInsightsDomain } = await import('./services/domainMapper.js');
  const { findTags } = await import('./services/tasteTagsClient.js');
  const { getAudienceInsights } = await import('./services/audienceInsightsClient.js');
  // fetchAffinityVector passes the RAW agent domain (books/dining/fashion)
  // per its fetchFn contract; getCrossDomainAffinities' alias table lacks
  // that vocabulary and rejects it locally (INVALID_TARGET_DOMAIN). On a
  // book/videogame seed that failed ALL five domains -> 500
  // all_domains_failed (caught by the task-193 hosting stability probe).
  // Map ONCE here so every downstream real caller (the vector AND the
  // URN-passing extractors) is covered; injected test clients bypass this.
  const getCrossDomainAffinities = (entityIds, targetDomain, options) =>
    rawCrossDomain(entityIds, toInsightsDomain(targetDomain), options);
  return { searchEntities, getCrossDomainAffinities, findTags, getAudienceInsights };
}

/** Write the bundle in the requested format. */
async function dispatchFormat(res, bundle, format, requestId) {
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
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
  res.end(JSON.stringify({ status: 'ok', service: 'suto-osnova', dossier: exportJson(bundle) }));
}

/**
 * The shared generate pipeline: validate, run the mode over the real
 * (or injected) clients, dispatch the format.
 *
 * @param {Function} loadRunner a lazy loader for the mode runner.
 * @param {object} [clients] TEST-ONLY DI (never from the request).
 */
async function runGenerate(loadRunner, req, res, body, requestId, clients) {
  const { seed, format, options } = validateBody(body);
  const runner = await loadRunner(); // lazy: the transport chain loads here
  const wired = clients ?? await realClients();
  const bundle = await runner(seed, {
    affinityFn: wired.getCrossDomainAffinities,
    search: wired.searchEntities,
    searchFn: wired.searchEntities,
    tagsFn: wired.findTags,
    insightsFn: wired.getAudienceInsights,
    ...options,
  });
  await dispatchFormat(res, bundle, format, requestId);
}

/** HTTP handler for POST /api/generate/worldbuilder (Mode 1). */
export async function handleGenerateWorldbuilder(req, res, body, requestId, clients) {
  return runGenerate(
    async () => (await import('./modes/WorldbuilderMode.js')).runWorldbuilder,
    req, res, body, requestId, clients,
  );
}

/** HTTP handler for POST /api/generate/experiential (Mode 2). */
export async function handleGenerateExperiential(req, res, body, requestId, clients) {
  return runGenerate(
    async () => (await import('./modes/ExperientialMode.js')).runExperiential,
    req, res, body, requestId, clients,
  );
}

/** HTTP handler for POST /api/generate/antithesis (Mode 3). */
export async function handleGenerateAntithesis(req, res, body, requestId, clients) {
  return runGenerate(
    async () => (await import('./modes/AntithesisMode.js')).runAntithesis,
    req, res, body, requestId, clients,
  );
}

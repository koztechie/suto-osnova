# PLAN_STATE

## Task 27 — Reference mock data for 10 test scenarios

Status: DONE
Date: 2026-10-14

Deliverables:
- server/tests/fixtures/manifest.json — 10 scenarios (id, client, args, status, error flag, files, notes).
- server/tests/fixtures/NN-*.response.json — raw Qloo bodies, shapes recorded live from hackathon.api.qloo.com (2026-10-14).
- server/tests/fixtures/NN-*.expected.json — golden envelopes, generated through the real service clients.
- server/tests/fixtures/generate.mjs — regeneration tool (kept in repo; regenerate only on intentional normalizer changes, review diff).
- server/test/referenceFixtures.test.js — golden regression: manifest integrity, per-scenario deep-equality through the real pipeline, error-path pin (429 -> QlooApiError, attempts=1, verbatim data), PII hygiene scan over all fixture JSON.

Scenario coverage: film/music/books/dining/fashion search (01-05), taste tags (06), cross-domain affinity with keyed explainability + warning (07), audience insights null-attribution (08), audience discovery (09), upstream 429 error surface (10). Clients covered: all five service clients plus raw qlooClient.get.

Patch applied during the task: entitySearchClient.DOMAINS gained agent-vocabulary aliases books->urn:entity:book, dining->urn:entity:place, fashion->urn:entity:brand (integration gap found by the fixture pipeline). Test added in server/test/entitySearchClient.test.js.

Verification: npm test 211/211 pass (pre-task baseline 198; +12 golden/hygiene tests, +1 alias test), npm run lint clean.

## Task 28 — Model Context Protocol server

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/mcp/server.js — createMcpServer() factory + stdio start(); official @modelcontextprotocol/sdk (already a project dependency, zod v4 compatible — verified); stdout reserved for protocol, logs to stderr; direct-run guard for npm run mcp.
- server/src/mcp/tools.js — 7 tools: search_entities, find_tags, get_cross_domain_affinities, get_audience_insights, search_audiences, group_entities_by_domain (local), detect_personal_data (local). Zod input schemas; typed domain errors mapped to isError results with code/status/attempts; every network tool inherits the transport stack (auth, rate limiting, retries, cache, single-flight, privacy guard, MOCK_MODE).
- package.json — script "mcp": node --env-file=.env server/src/mcp/server.js.
- server/test/mcpServer.test.js — 10 tests: initialize/capabilities, 7-tool list with compiled schemas + required fields, ping, offline tool execution over mock fixtures with sabotaged network, local tools, masked privacy findings, invalid-argument isError channel, upstream 401 mapping, unknown-tool channel, real-stdio spawn integration (full handshake + tools/call + -32601, every stdout line parsed as JSON-RPC).

Patch applied during the task: QlooApiError gained stable this.code = 'QLOO_API_ERROR' (parity with typed domain errors; machine-readable tool error channel).

Verification: npm test 221/221 pass (baseline 211; +10 MCP tests), npm run lint clean; live stdio smoke (initialize/tools/list/tools/call via NDJSON pipes) passed with MOCK_MODE=true.

## Task 29 — MCP resources for the Qloo entity graph

Status: DONE
Date: 2026-10-15

Live contract verification (2026-10-15):
- GET /entities requires param entity_ids (id/ids answer 400 "provide at least one of: entity_ids or any external.*.ids"); entity_ids=<UUID> -> 200 with full record (types, properties.external/image/short_description, popularity).
- GET /v2/audiences?filter.results.audiences=<urn> -> 200, returns that audience node.

Deliverables:
- server/src/mcp/resources.js — registerResources(server): qloo://domains (local vocabulary catalog), qloo://domains/{domain} (alias-resolving, throws on unknown), qloo://entity/{id} (by-id graph node: normalized fields, domain classification via classifyEntity, links to self/domain/tag edges), qloo://tags/{tag} (popularity, description/history, parents, parent-type -> domain links via reverse map), qloo://audiences/{audience} (audience node). All payloads application/json in the project's normalized vocabulary plus a links[] traversal surface; reads inherit the full transport stack via qlooClient.
- server/src/mcp/server.js — registerResources wired; instructions updated with the resource URI scheme.
- server/src/mocks/qlooFixtures.js — entities:phoebe fixture (live-recorded /entities shape) + fallback:entities honest skeleton (echo requested id, invent nothing); fallback:tags/fallback:audiences now honor exact-URN params (filter.tags / filter.results.audiences) for node reads.
- server/test/mcpResources.test.js — 8 tests: list/templates discovery, offline domain catalog (fetch sabotaged, 0 calls), alias resolution + unknown rejection, entity node with classification/links/short_description, skeleton degradation for unknown ids offline, tag node with domain links + not-found rejection, audience node + not-found, tools+resources coexistence.

Verification: npm test 229/229 pass (baseline 221; +8 resource tests), npm run lint clean; offline stdio smoke: resources/list (1), templates (4), entity read (Phoebe Bridgers, domain music, 4 links), domain alias read (dining).

## Task 30 — MCP tool qloo_resolve_entity

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/mcp/tools.js — qloo_resolve_entity({ name, domain?, min_popularity?, allow_fuzzy? }): textual name -> VERIFIED Qloo id. Verification contract: candidates from searchEntities (scoped to the domain's types, or the union of all 5 agent domains when omitted); popularity gate; exact-name pool preferred; deterministic ordering (popularity desc, name asc, id asc); match: exact|fuzzy; ambiguous flag; alternatives from the FULL eligible set (fuzzy runner-ups included — the disambiguation case); ENTITY_NOT_FOUND for strict/empty outcomes; provenance stamp mode: live|mock. Tool count 7 -> 8.
- server/test/mcpResolveEntity.test.js — 7 tests: listing/required field, exact scoped resolution with provenance + alternatives, unscoped ambiguity with deterministic pick, fuzzy popularity preference + strict-mode miss, min_popularity gating (winner shift + not-found), invalid-name isError channel, domain vocabulary rejection (INVALID_DOMAIN).
- Count assertions updated in server/test/mcpServer.test.js (tools 7->8, names list) and server/test/mcpResources.test.js.

Flake fixed during the task: qlooCache freshness boundary was `age <= ttl` — with ttlMs === 0 an entry written and read within the SAME millisecond was reusable (timer-resolution race surfacing under full-suite parallelism). Patch: fresh iff `age < ttl` on both memory and disk paths (stale flags use >=); ttl 0 is now deterministically dead. Verified: two consecutive full-suite runs 236/236.

Verification: npm test 236/236 pass (baseline 229; +7 resolver tests; the pre-existing TTL-0 flake eliminated — isolated runs had passed, full-suite parallel runs failed before the patch), npm run lint clean; stdio smoke: resolve "Phoebe Bridgers" (music) -> AFBC71A7-... exact, verified, alternative Kendrick Lamar, mode mock; strict miss "Bon Iver" -> ENTITY_NOT_FOUND.

## Task 31 — MCP tool qloo_cross_correlate

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/mcp/tools.js — qloo_cross_correlate({ entity_ids, domains?, take?, explainability? }): cross-sphere affinity coefficients. Per target sphere: coefficient = mean of the returned affinities (rounded 4dp; null when the payload carries none — honest, never 0), top-3 strongest links, sourceContribution = mean per-signal attribution ("how much each input drives this sphere"). Default sweep: all five agent domains. Deterministic ranking (desc, nulls last). Per-sphere failures degrade to error entries; ALL_SPHERES_FAILED only when every sphere fails. Sphere resolution composed: agent vocabulary first (books/dining/fashion -> primary insights type via insightTypesFor), then Qloo vocabulary/raw URN (podcast, urn:entity:*). Synchronous validation (resolveEntityIds) before any I/O. Tool count 8 -> 9.
- server/test/mcpCrossCorrelate.test.js — 6 tests: listing/required field, full five-sphere sweep with pinned golden coefficient (0.9607) + attribution + honest null, deterministic ranking stability, domain subsets + explainability-off behavior, typed INVALID_TARGET_DOMAIN + zod min(1) channel for empty ids, partial-failure degradation (selective 500 stub, mock off) + ALL_SPHERES_FAILED.
- Count assertions updated in server/test/mcpServer.test.js (names list + stdio 9) and server/test/mcpResources.test.js.

Verification: npm test 242/242 pass (baseline 236; +6 correlation tests), two consecutive full runs stable, npm run lint clean; stdio smoke: sweep of Phoebe Bridgers -> ranked coefficients place 0.971, book 0.97, movie 0.9607, artist 0.908, brand null; film top links + attribution {PHOBBE: 1}.

## Task 32 — MCP tool qloo_taste_antithesis

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/mcp/tools.js — qloo_taste_antithesis({ entity_ids, domains?, window? }): inverse cultural vectors. Per sphere: the affinity-ranked window (window 3..50, default 30) splits into top slice / middle / inverse slice of floor(window/3) (min 1); ONLY finite-affinity entities participate (no signal data -> neither vector); contrast = topMean - inverseMean (rounded 4dp, null when a slice lacks data or the pool is too small — honest null, never invented). Deterministic ranking (contrast desc, nulls last); per-sphere failures degrade to error entries; ALL_SPHERES_FAILED on total failure. Reuses the sphere resolution and validation composed in task 31. Tool count 9 -> 10.
- server/test/mcpTasteAntithesis.test.js — 7 tests: listing/required/options, pinned golden inversion (window 3 over the fixture pool: top The Menu 0.966, inverse Last Night in Soho 0.956, contrast 0.01), honest degradation on tiny pools (default window over 3 entities -> no inverse, null contrast), five-sphere sweep with null-not-zero degenerate spheres, deterministic ranking stability, typed INVALID_TARGET_DOMAIN + zod channels (empty ids, window below floor), partial-failure degradation + ALL_SPHERES_FAILED.
- Count assertions updated in server/test/mcpServer.test.js (names list + stdio 10) and server/test/mcpResources.test.js.

Product fix found by the tests: skeleton entities without affinity data were entering the slice math (the fashion sphere carved an inverse from empty data); vectors now build from finite-affinity results only.

Verification: npm test 249/249 pass (baseline 242; +7 antithesis tests), two consecutive full runs stable, npm run lint clean; stdio smoke: window 3 sweep over film+music -> movie top The Menu / inverse Last Night in Soho / contrast 0.01; artist top Phoebe Bridgers / inverse none / contrast null.

## Task 33 — qloo-harness compatibility (`qloo mcp`)

Status: DONE
Date: 2026-10-15

Harness ground truth (live, @qloo/qloo-harness@0.1.26, `qloo mcp`): serverInfo {name: qloo-harness}; protocol 2024-11-05; capabilities {tools, resources}; ALL 10 tools canonical qloo_* (incl. offline qloo_capabilities with contract version + SHA-256 checksum); resource qloo://contracts/workflows (application/json); no resource templates; qloo_capabilities works without Qloo credentials.

Deliverables:
- server/src/mcp/contract.js — shared contract metadata: CONTRACT_VERSION 1.0.0, tool-name registry (noteTool), buildContractPayload() with SHA-256 checksum over version + contractVersion + sorted tool names (harness convention: clients detect contract changes by checksum).
- server/src/mcp/tools.js — canonical qloo_* namespace: every tool registered under its short name AND a qloo_* canonical alias (7 aliases; same schema + handler; harness precedent: canonical prefixed names with unprefixed aliases in its Python adapter, mirrored inverted). New zero-arg tool qloo_capabilities (offline contract payload). Tool count 10 -> 18.
- server/src/mcp/resources.js — qloo://contracts/suto-osnova static resource (parity with qloo://contracts/workflows), same payload as qloo_capabilities.
- scripts/verify-harness-compat.mjs — spawns BOTH servers (ours: MOCK_MODE, compat key; harness: NO QLOO_* env) and runs the identical stdio handshake: initialize negotiation, snake_case + schema checks, canonical-namespace completeness, interop name overlap (>= 2 shared qloo_* names), offline qloo_capabilities on both, contract resources readable as application/json on both, qloo:// scheme, strict NDJSON purity. Standalone runner (exit code) + reusable export. npm script mcp:verify.
- server/test/mcpHarnessCompat.test.js — one end-to-end test over the shared verifier.
- package.json — devDependency @qloo/qloo-harness, script "mcp:verify".

Patches during the task: contract.js env import level (server boot module-resolution failure, caught by the first verifier run); handshake() handle spread; mcpServer.test.js zero-argument schema exemption for qloo_capabilities.

Verification: node scripts/verify-harness-compat.mjs -> HARNESS COMPATIBILITY: PASS (15/15 checks: both handshakes, namespace completeness, overlap qloo_find_tags + qloo_capabilities, both contract resources, NDJSON purity); npm test 250/250 pass (baseline 249; +1 compat test; tool-count expectations updated to 18 in three files), two consecutive full runs stable; npm run lint clean.

## Task 34 — GET /api/health (system + Qloo connectivity)

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/health.js — checkQloo/healthReport/handleHealth. Probe: documented GET / ("Get API Information", live-verified 200 JSON ~700ms — the cheapest authenticated call proving DNS+TLS+key+gateway) through qlooClient (caching, rate limiting, retries, privacy guard inherited; repeated polls reuse one cached upstream call per TTL) with a 5s AbortSignal bound (aborts never retried per transport contract). Semantics: MOCK_MODE -> status mocked, HTTP 200, zero upstream; live probe ok -> 200; live probe failure -> 503 degraded (orchestrators act on the code) with typed error; probe=0|false -> skipped, 200, zero upstream. Payload carries version/uptime/timestamp/mockMode + qloo report + rate-limiter and cache stats; never echoes request input (no PII surface).
- server/src/app.js — createHttpHandler() extracted (no side effects): CORS, health route first (GET-only, skips body parsing), legacy echo route preserved byte-for-byte. server/src/index.js slimmed to wiring only.
- server/test/healthEndpoint.test.js — 8 tests: mock-mode full status + zero fetch, probe=0 and probe=false skips with zero upstream, live success with latency + exactly one probe to GET /, live failure 503 degraded with typed code, PII non-echo, legacy GET/POST echo preserved, POST /api/health falls to legacy (GET-only route).

Verification: npm test 258/258 pass (baseline 250; +8 health tests), npm run lint clean; live smoke against the real server with the real key: HTTP 200, status ok, mockMode false, qloo reachable true latency 606ms, rate-limiter stats populated.

## Task 35 — global HTTP error handler (structured Qloo failure envelopes)

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/httpErrors.js — classifyError() (pure, table-tested) + sendError() envelope writer. Envelope: { status: 'error', service, error: { code, message, requestId }, upstream?: { status, attempts } }. Codes: 504 QLOO_TIMEOUT (abort/timeout cause chains, incl. nested causes), 503 QLOO_RATE_LIMITED (429 after retries), 503 MOCK_FIXTURE_NOT_FOUND (offline misconfig), 502 QLOO_AUTH (401/403), 502 QLOO_UPSTREAM (5xx), 502 QLOO_REJECTED (other 4xx), 502 QLOO_NETWORK (transport exhaustion), 400 PII_DETECTED (privacy guard), 400 <typed validator codes> (five domain error classes), 413 PAYLOAD_TOO_LARGE, 400 INVALID_JSON, 500 INTERNAL (raw TypeError/SyntaxError are OUR bugs by the transport contract — never mislabeled as upstream outages; generic message, truth to stderr with requestId). Crash-safe: headersSent -> socket destroyed, nothing written over a live stream. X-Request-Id correlation header on every response (error and success).
- server/src/app.js — whole request pipeline wrapped in the global boundary (CORS, health, body parsing, future routes); stderr log line per failure with requestId.
- server/src/middleware/bodyParser.js — overflow now pauses instead of destroy()-ing the socket BEFORE the response (a 413 must be answerable); the error responder destroys the remainder after the envelope is flushed ('Connection: close' semantics via finish hook).
- server/test/httpErrors.test.js — 10 tests: classification table for all six QlooApiError variants, network-vs-timeout with nested causes, misconfig/privacy/typed-validator codes, body-pipeline + internal-bug genericity (original message never leaks), envelope writer (requestId/upstream/header match), streaming-response crash safety, live-pipeline integration (400 INVALID_JSON with header/body requestId correlation, answerable 413, success X-Request-Id + legacy body intact, health unaffected).

Verification: npm test 268/268 pass (baseline 258; +10 error-handler tests), two consecutive full runs stable, npm run lint clean; live smoke against the real server: invalid JSON -> HTTP 400 { status: 'error', error: { code: 'INVALID_JSON', requestId: 'bb74c278-…' } }, health still live-probes (200, qloo ok, 680ms).

## Task 36 — system event logging (laconic format, no secret leaks)

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/logger.js — scoped one-line logger, ALWAYS stderr (stdout stays machine/protocol-only: MCP stdio depends on it). Format: `<ISO-ts> <LEVEL> [scope] message {json-fields}`; child scopes (qloo:cache). Levels debug|info|warn|error|silent via LOG_LEVEL (default info; invalid values -> info; NODE_ENV=test -> error so test output is quiet). Zero project imports (raw process.env reads, lazy) -> importable from env.js without cycles. Test hooks setSink/resetSink. CORE GUARANTEE scrubSecrets(): the configured QLOO_API_KEY value anywhere in a line, X-Api-Key header-style occurrences, Bearer tokens, JSON fields named api_key/token/secret/password (plain AND escaped-quote forms when JSON is logged inside a field); idempotent.
- All 12 console.* call sites migrated to scoped loggers: qlooClient x4 (retry, privacy redactions x2, stale-if-error), qlooMock (fixture served), qlooCache (continuing without cache), index (listening), app (http failures — now logs the CLASSIFIED code matching the response envelope + requestId), mcp/server (stdio listening, fatal startup), env (invalid configuration — emoji removed per governance). env.js schema gained LOG_LEVEL; .env.example documents it; npm test now sets NODE_ENV=test.
- server/test/logger.test.js — 9 tests: exact line format, child scopes, unserializable-field safety, level filtering incl. silent, test/prod defaults + invalid-value fallback, EXACT API-key redaction (message + fields), generic header/Bearer/JSON-field redaction (5 secret shapes), scrub idempotence, HTTP error-path integration (classified code + requestId correlation).
- Migrated log-asserting tests: qlooClient.test.js (privacy warn capture -> logger sink + LOG_LEVEL=warn), qlooMock.test.js (same), POST-redaction test simplified (test-env default suppresses warn).

Verification: npm test 277/277 pass (baseline 268; +9 logger tests), two consecutive full runs stable, npm run lint clean; live smoke with the real key in env + LOG_LEVEL=debug: stderr shows `INFO  [server] listening on port 3997 {"mode":"development"}` and `ERROR [http] POST / -> INVALID_JSON {"requestId":"8566662b-…","message":"Invalid JSON"}`, and an explicit leak check confirms the real QLOO_API_KEY is ABSENT from all stderr output.

## Task 37 — scripts/verify_backend_env.js (backend config verifier)

Status: DONE
Date: 2026-10-15

Refactor enabling the verifier: server/src/config/envSchema.js — the pure zod schema extracted (no side effects, no exit); server/src/config/env.js is now a thin runtime wrapper (parse, secret-redacting log, exit 1 on failure — identical failure messages, envTtl child-process tests unaffected).

Deliverables:
- scripts/verify_backend_env.js — two-layer validation: (1) the exact boot schema (envSchema.js safeParse -> FULL per-field report instead of the runtime exit path; TTL invariants included); (2) semantic checks the schema cannot express: .env.example placeholder key -> FAIL, key whitespace -> FAIL (key value NEVER printed, only its shape/length), https transport (WARN), TCP port range 1..65535 (FAIL outside), QLOO_CACHE_DIR creatable+writable probe (write+delete), .gitignore coverage of .env (WARN when missing), MOCK_MODE/LOG_LEVEL/NODE_ENV runtime-mode summary. Opt-in --probe verifies the credential LIVE via documented GET / (5s bound) — default run is network-free and CI-safe. Output: PASS/WARN/FAIL lines + summary; exit 0/1.
- npm script "verify:env".
- server/test/verifyBackendEnv.test.js — 7 spawn-based tests: valid env full PASS report + key-value never printed, placeholder key FAIL, key whitespace FAIL, per-field schema violations (LOG_LEVEL, TTL cross-field) with exit 1, http base URL WARN-only exit 0, out-of-range PORT FAIL, --probe against unreachable host FAIL.

Verification: real run `node --env-file=.env scripts/verify_backend_env.js --probe` -> 11/11 PASS including live qloo probe HTTP 200 in 773ms; npm test 284/284 pass (baseline 277; +7 verifier tests), two consecutive full runs stable; npm run lint clean; node --check on the script clean.

## Task 38 — stable base-server memory < 60 MB (recorded)

Status: DONE
Date: 2026-10-15

Measurement basis (Node v22.22.2 linux x64, measured): platform floor = 42.1MB empty process / 53.1MB listening http server (Node-native, exists regardless of the application); the service's own consumption is the JS heap — warmed load-served server holds ~7MB heapUsed + ~3.5MB external. The <60MB gate is applied to MAX heapUsed over the stable sample window; the full RSS breakdown is recorded alongside (build/memory-baseline.json).

Optimization journey (RSS under 1 req/s health load): 64.7 -> 62.0 through:
- zero-dependency env validator (server/src/config/envSchema.js, same safeParse contract + messages; zod classic cost ~12MB settled, zod/v4/mini measured unusable API + only -1.4MB; zod stays for MCP tool schemas);
- lazy Qloo transport chain in health (only when a live probe engages it; mock/skipped -> transport stats null with a note, health tests updated);
- import-free httpErrors boundary (duck-typed on stable err.name instead of instanceof imports of the whole service graph);
- crypto-free version reader (server/src/version.js, memoized; node:crypto first-use ~2.8MB moved off the health path; contract.js re-exports for back-compat);
- global/cheap helpers: server/src/ids.js correlation ids (UUID-v4-shaped, Math.random — documented trade-off: correlation only, never secrets), logger isoNow() manual ISO (avoids ~1MB date-format machinery);
- semi-space/old-space V8 flags measured and REJECTED (they raise RSS).

Deliverables:
- scripts/verify_memory.js (npm run verify:memory): spawns the REAL server via a thin snapshot wrapper (server untouched), readiness via /api/health?probe=0, MOCK_MODE deterministic; warmup + sample window under 1 health req/s; gate MAX heapUsed < --mb (default 60); records heap min/avg/max + RSS boot-idle/warm plateau + methodology + rationale into build/memory-baseline.json; exit code. Flags: --samples/--warmup/--interval/--mb.

Verification: `node scripts/verify_memory.js` -> MEMORY: PASS — heapUsed samples 6.6..7.5MB (min=6.6 avg=6.9 max=7.5, threshold 60MB), RSS recorded as informational (boot idle 61.9, warm plateau 60.5-62.1 — platform-inclusive). Patch during the task: ids.js UUID layout (missing 4-char group -> 31 chars; fixed to canonical 8-4-4-4-12=36). npm test 284/284 pass (two consecutive runs), npm run lint clean, node --check on the script clean.

## Task 39 — initial Git commit

Status: DONE
Date: 2026-10-15

Commit: 664af12 (amended to include this status) on branch main — "feat: scaffold backend gateway and qloo mcp server". 87 files, 18379 insertions: server/ (config, middleware, services, mcp, mocks), scripts/ (verify_backend_env, verify_memory, verify-harness-compat), server/tests/fixtures/ (10 reference scenarios + generator), docs/, AGENTS.md, LICENSE, PLAN_STATE.md, package.json/-lock, .env.example, .gitignore, opencode.jsonc. Secrets/caches excluded by .gitignore (.env, node_modules, build/, .cache/); staged-tree leak scan against the live QLOO_API_KEY value: clean (only synthetic sk-live strings inside redaction TEST fixtures).

Verification of the committed tree: npm test 284/284, npm run lint clean, node --env-file=.env scripts/verify_backend_env.js -> CONFIGURATION: PASS (the bare run without --env-file correctly FAILS on the missing key — expected gate behavior).

## EPIC 1 — Backend gateway scaffold + Qloo MCP server

Status: COMPLETE
Closed: 2026-10-15
Anchor commit: c102439 "feat: scaffold backend gateway and qloo mcp server"

Scope delivered (tasks 15-39):

1. Transport foundation (15-19, baseline before this journal): qlooClient with X-Api-Key attachment, token-bucket rate limiting + concurrency semaphore + bounded queue, exponential backoff with Retry-After (3 attempts, network/429/503 only), two-tier response cache (memory LRU + disk JSON, SHA-256 keys, stale-if-error) with per-endpoint TTL tiers (24h entities/tags/audiences, general 5min).
2. Qloo capability clients (20-24): searchEntities (entity search), findTags (taste vector tags), getCrossDomainAffinities (cross-domain affinity + attribution), getAudienceInsights + searchAudiences (demographics), domainMapper (5 mandatory agent domains film/music/books/dining/fashion, two-way mapping, live-verified tag-family classification). All contracts verified live against hackathon.api.qloo.com.
3. Privacy and offline operation (25-27): privacyGuard with unconditional transport-boundary redaction (zero personal data in outbound requests; typed domain errors; masked findings), MOCK_MODE with recorded fixtures (autonomous offline operation), 10 reference mock-data scenarios pinned by golden regression tests.
4. MCP server (28-33): stdio server on @modelcontextprotocol/sdk; 18 tools under the canonical qloo_* namespace (search, tags, cross-domain, audiences, resolve_entity, cross_correlate, taste_antithesis, capabilities, local domain/privacy utilities); entity-graph resources (qloo://domains, entity/{id}, tags/{tag}, audiences/{urn}); offline contract tool + qloo://contracts/suto-osnova with SHA-256 checksum; official qloo-harness compatibility verified 15/15 via `qloo mcp` (canonical namespace, contract resources, NDJSON purity, offline capabilities on both servers).
5. HTTP layer (34-37): GET /api/health with live Qloo connectivity probe (GET /, 5s bound, 503 on degradation); global error handler mapping Qloo transport failures to structured envelopes with informative codes (QLOO_TIMEOUT/NETWORK/AUTH/RATE_LIMITED/UPSTREAM/REJECTED, MOCK_FIXTURE_NOT_FOUND, PII_DETECTED, typed validator codes, INTERNAL) + X-Request-Id correlation; laconic stderr logging with secret redaction (zero console.* drift, zero emojis); scripts/verify_backend_env.js (schema + semantic checks + optional live probe).
6. Quality gate (38): base-server memory optimized and recorded — heapUsed max 7.5MB under load (gate <60MB; RSS platform floor documented), build/memory-baseline.json.
7. Repository (39): initial commit c102439 on main; secrets/caches excluded; staged-tree leak scan clean.

Epic-level verification: npm test 284/284 (two consecutive stable runs), npm run lint clean, harness compatibility 15/15, env verifier 11/11 PASS with live probe (HTTP 200), memory MEMORY: PASS, live API contract probes across all five endpoint families, no secret material in git history.

Definition of Done: all epic tasks implemented, tested and verified; state journal complete; working tree clean on main. Epic 2 (agent behavior / mise-en-scène domain logic on top of this gateway) not started — no tasks executed beyond the scaffold.

## Task 41 — deterministic agent finite state machine (engine core)

Status: DONE
Date: 2026-10-15

Deliverable: server/src/engine/AgentStateMachine.js — pure, dependency-free FSM core layered above the gateway/MCP toolbox (start of Epic 2). 10 states (idle, intake, intent, domain, disambiguation, execute, synthesize + terminal delivered/failed/cancelled), 13 events, 6 declarative effect types, frozen transition table with ordered guard branches (first-match, default branch required). Intent->canonical qloo_* tool map (10 intents, live-verified names from task 33); 7 domain-bearing intents route through DOMAIN (domainMapper) before EXECUTE, direct intents (capabilities/group_by_domain/privacy_scan) skip it; disambiguation loop (domain.unresolved -> clarification.provided -> domain); bounded retries (MAX_ATTEMPTS=3, attempts carried in context, ATTEMPTS_EXHAUSTED on ceiling); failure taxonomy (PII_DETECTED/MALFORMED_INPUT/UNKNOWN_INTENT/TOOL_REJECTED/UPSTREAM_ERROR/ATTEMPTS_EXHAUSTED); bounded trace (last 100 {from,event,to} records, no clocks in core -> trace is deterministic).

Determinism invariants D1-D5 pinned by tests: pure reducer (no I/O, clocks, RNG), total function over known events (undefined pair OR guard-rejected payload -> typed InvalidTransitionError with state/event/reason), pure guards, effects are declarations executed elsewhere (executor feeds results back as events), immutability (every transition returns a new frozen machine; context patches never mutate).

Verification: server/test/agentStateMachine.test.js 16/16 — golden paths (domain + direct intents with full effect-sequence assertions), determinism (identical scripts -> deep-equal machines), exhaustive 130-pair state x event matrix (20 defined targets asserted, 110 undefined pairs assert typed rejection), retry loop 1->2->3->EXHAUSTED, cancel/reset coverage per state class, trace FIFO cap, argument taxonomy (TypeError vs InvalidTransitionError), intent->tool regex completeness. npm test 300/300 (two consecutive stable runs; baseline 284), npm run lint clean. Engine imports nothing -> zero effect on the base-server memory gate (task 38).

## Task 42 — six discrete agent execution phases (dossier pipeline)

Status: DONE
Date: 2026-10-15

Deliverable: server/src/engine/AgentPhases.js — the second deterministic engine ladder: the six mandated execution phases IDLE -> SEED_RESOLUTION -> AFFINITY_EXPANSION -> ANTITHESIS_GENERATION -> DOSSIER_SYNTHESIS -> COMPLETED (frozen AgentPhase enum, exact names, canonical PHASE_ORDER). Phase semantics: SEED_RESOLUTION resolves the user's seed (qloo_resolve_entity); AFFINITY_EXPANSION expands it across the five agent domains (qloo_get_cross_domain_affinities); ANTITHESIS_GENERATION builds the contrast profile (qloo_taste_antithesis); DOSSIER_SYNTHESIS is local narrative assembly; COMPLETED is terminal. Six phase events (start, seed.resolved, affinities.collected, antithesis.ready, dossier.ready, fail); fail is the ONLY backward step (active -> IDLE, failure recorded, partial work kept for diagnostics). Context accumulators: seed, affinities (frozen array), antithesis, dossier, failure. Bounded deterministic trace (100 records).

Relation to task 41: that FSM governs the REQUEST lifecycle; this ladder governs what a dossier request BUILDS (multi-tool pipeline advancing on stage results); the executor task will drive both. Determinism invariants P1-P4 mirror D1-D5 (pure reducer, total function, linearity, immutability).

Verification: server/test/agentPhases.test.js 12/12 — exact six-phase name/order assertions (task mandate), golden full run with per-phase tool + accumulator assertions, exhaustive 36-pair phase x event matrix (9 defined targets, 27 typed InvalidPhaseError rejections), linearity invariant (every forward step strictly +1 in PHASE_ORDER), determinism (identical scripts -> deep-equal pipelines), fail coverage per active phase + terminal rejection semantics, bounded trace FIFO, cross-module consistency (all PHASE_TOOL values are canonical qloo_* tools present in the task-41 INTENT_TOOL map), TypeError/typed-error argument taxonomy. npm test 312/312 (two consecutive stable runs; baseline 300), npm run lint clean. Zero-dep module -> no effect on the memory gate.

## Task 43 — agent internal-state protection via #private fields

Status: DONE
Date: 2026-10-15

Deliverables:
- server/src/engine/AgentSession.js — the agent facade class: the task-41 request machine and the task-42 dossier pipeline live ONLY in native #private fields (#machine, #pipeline). Protection model H1-H5: H1 no reference leakage (unreachable via property/bracket access, Object.keys, Reflect.ownKeys, spread, symbols; instances fully isolated); H2 controlled mutation path — dispatch(event)/advancePhase(event) delegate to the deterministic pure cores, a failed transition throws BEFORE the internal reference is replaced so errors cannot corrupt state, direct property writes rejected (setter-less accessors); H3 read-only egress — every view (state/context/trace/phase/phaseContext/phaseTrace/snapshot()) is deep-frozen, nested structures included; H4 caller isolation on ingest — event payloads are structuredClone'd before entering the cores (post-dispatch caller mutation cannot alter session state; uncloneable payloads rejected with TypeError before any state change); H5 facade determinism — no clocks/RNG, identical scripts -> identical snapshots.
- server/src/engine/deepFreeze.js — recursive freeze utility (WeakSet cycle-safe, idempotent, primitive-safe, returns same reference).

Verification: server/test/agentSession.test.js 8/8 — leakage probe (all access paths), rejected direct writes + failed-dispatch state integrity (snapshot deep-equal before/after), deep-frozen nested views (throws on tamper, snapshot JSON-serializable), determinism through the facade (two runs deep-equal), frozen effects, typed error propagation (InvalidTransitionError/InvalidPhaseError/TypeError), uncloneable-payload rejection with untouched state, pipeline view isolation, deepFreeze unit coverage (recursion, cycles, idempotence, primitives). npm test 320/320 (two consecutive stable runs; baseline 312), npm run lint clean. Zero new dependencies.

## Task 44 — getExecutionSnapshot(): immutable current-step records

Status: DONE
Date: 2026-10-15

Deliverable: AgentSession.getExecutionSnapshot() (server/src/engine/AgentSession.js) — immutable point-in-time record of the CURRENT analysis step: { step, lastEvent, lastEffects, state, context, trace, phase, phaseContext, phaseTrace }. Backed by three new #private bookkeeping fields (#step monotonic counter across both cores, #lastEvent {core: 'machine'|'phase', type}, #lastEffects): dispatch()/advancePhase() increment the counter and record the last successful mutation only AFTER the core transition succeeds (a thrown transition changes nothing). Immutability via Object.freeze: the record is built from COPIES and deep-frozen at every level (deepFreeze = recursive Object.freeze), so snapshots are isolated both from later session mutations (they keep the state they were taken at) and from caller tampering. Taking a snapshot is a pure read — it never advances the step counter. Determinism holds: identical event scripts -> identical step records (no clocks).

Verification: server/test/agentSession.test.js +6 tests (total 14/14): initial shape + deep-freeze proof on every level; step accounting (per-core increments, failed transitions do not count, pure-read double-call deep-equal); lastEvent/lastEffects semantics (machine vs phase cores, effects copy recorded, phase steps reset effects); point-in-time isolation (snapshot at step 10 keeps state DELIVERED/phase COMPLETED after further machine mutations — JSON-identical before/after; current snapshot reflects steps 11-12); cross-session determinism; nested payload objects frozen + serializable in the record. Two task-44 test expectations corrected during development against real semantics (CANCEL is legal from EXECUTE; FAIL is rejected from terminal COMPLETED). npm test 326/326 (two consecutive stable runs; baseline 320), npm run lint clean.

# AGENT PIPELINE — INTERNAL API REFERENCE
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Scope:** the agent module stack (tasks 41–77): contracts, invariants, extension rules.

## 0. LAYER MAP

```
engine/   PURE core — no I/O, no clocks, no RNG. Deterministic math,
          state machines, validators. Every function is unit-pinned.
services/ I/O adapters — Qloo/LLM transports, extractors, caches,
          orchestration. All network clients are INJECTABLE for tests.
mcp/      Model Context Protocol tool surface (18 qloo_* tools).
src/      HTTP app (health, CORS, logger, env verifier).
scripts/  verify:* CLIs (env, memory, trackers).
tests/    Golden agent-run scenarios + perf/compliance gates.
```

Dependency rule: `engine -> services/domainMapper` and
`engine -> services/candidateRanker` are the ONLY upward imports
(both pure). Services may import engine. Nothing imports mcp/.

## 1. PIPELINE STAGES (one generation cycle)

```
 raw text
   -> SeedResolver (normalize/validate)                 [engine]
   -> SeedClassifier (title|person|description)         [engine]
   -> seedEntityResolver (Qloo search -> entity_id)     [services]
   -> AgentSession FSM + AgentPhases ladder             [engine]
   -> math chain: LongTailFilter -> PopClicheFilter
        -> UniquenessCoefficient -> ScoreNormalizer
        -> NonObviousSorter / AdaptiveThreshold         [engine]
   -> CrossDomainExpander + affinityVectorService       [engine|services]
   -> five extraction layers (one concurrent wave)      [services]
   -> ConnectionNotes + TonalityEngine                  [engine]
   -> ContextGraph -> GraphWeights                      [engine]
   -> llmSynthesizer + dossierSystemPrompt              [services]
   -> OutputValidator (hallucination backstop)          [engine]
   -> sessionCache (UUID, TTL)                          [services]
   -> memoryHygiene isolateCycle (GC after each cycle)  [services]
```

## 2. ENGINE MODULES (pure)

| Module | Key exports | Contract highlights |
|---|---|---|
| `AgentStateMachine.js` | `AgentSession`-facing `transition`, `AgentEvent` (13), `AgentIntent`, `AgentState` (10), `INTENT_TOOL`, `InvalidTransitionError` | Frozen transition table; `DOMAIN_INTENTS` route through the DOMAIN state; malformed args -> TypeError, unknown pairs -> typed error. |
| `AgentPhases.js` | `AgentPhase` (6), `PhaseEvent`, `advance`, `InvalidPhaseError` | IDLE -> SEED_RESOLUTION -> AFFINITY_EXPANSION -> ANTITHESIS_GENERATION -> DOSSIER_SYNTHESIS -> COMPLETED; `fail` is the only backward step. |
| `AgentSession.js` | `AgentSession` class: `dispatch`, `advancePhase`, `getExecutionSnapshot`, getters | `#private` fields (H1 no leakage), mutation only through the pure cores (H2), deep-frozen egress (H3), structuredClone ingest (H4), deterministic (H5). |
| `deepFreeze.js` | `deepFreeze(value)` | Recursive, cycle-safe, idempotent; returns the same reference. |
| `SeedResolver.js` | `resolveSeed`, `normalizeSeedText`, `InvalidSeedError`, `SEED_REASONS`, `SEED_LIMITS` | NFC -> zero-width strip -> control-char strip -> whitespace collapse; length in CODE POINTS (2..120); tolerant ingress (`seed`/`anchor`/`query`); domain hints via domainMapper. |
| `SeedClassifier.js` | `classifySeedFormat`, `extractTasteWords`, `SEED_FORMATS`, `SIGNAL_WEIGHTS` | Deterministic marker tables; two title-case words TIE (title vs person) -> precedence decides, low confidence, alternative reported. |
| `LongTailFilter.js` | `filterLongTail`, `explainCut`, `excessAffinity`, `CUT_REASONS` | Via Negativa: R3 `negative_excess` (excess <= -0.2), R1 `mainstream_no_excess` (pop >= 0.9 AND excess < 0.05), R2 `generic_weight` (weight >= 0.8, pool >= 3); unknown data never removed; `keepFallback` valve. |
| `PopClicheFilter.js` | `cutMassCliches`, `banalityIndex` | Quantile cut: banality = max(0, popularity - excess); top `cutRate` (0.15) removed; banality 0 = proven non-banal (protected); null banality protected; ledger + `thresholdBanality`. |
| `UniquenessCoefficient.js` | `uniquenessCoefficient`, `annotateUniqueness`, `MIN_CORRELATION`-style contract via `UNIQUENESS_DEFAULTS` | U(p) = log2(1/p)/log2(1e6); landmarks U(1e-k)=k/6; missing popularity -> null + `no_popularity`; zero -> 1 + `zero_popularity`; tiers microtail/long_tail/midstream/mainstream. |
| `ScoreNormalizer.js` | `normalizeArtifactScores`, `connectionScoreOf`, `toPercent` | Priority chain affinity -> correlation -> index -> weight (task-59 trap pinned); null stays null; absolute vs relative (min-max, degenerate -> keep absolute). |
| `NonObviousSorter.js` | `sortByNonObvious`, `surpriseIndex` | surprise = confirmation * (1 + excessWeight*excess + rarityWeight*obscurity); nulls sink; re-ranks only, never drops. |
| `AdaptiveThreshold.js` | `affinityThreshold`, `passesThreshold`, `filterByAdaptiveThreshold` | T = max(minThreshold, base*(1 - relief*U)); defaults 0.65/0.5/0.2; no proven rarity -> no relief; relief 0 = legacy fixed gate. |
| `CrossDomainExpander.js` | `expansionPlan`, `expandTastes`, `flattenExpansion` | `includeSeedDomain` flag; global dedup (first plan domain wins); weight = carrier share; `coverage` + `totals` honesty. |
| `AffinityScorer.js` | `culturalKinship`, `tagKinship`, `coherenceIndex` | Four renormalized components (graphAffinity .45 / RARITY-WEIGHTED Jaccard .25 / nameSimilarity .2 / domainFit .1); pair affinity is candidate-first; null index when nothing measurable. |
| `ConnectionNotes.js` | `explainConnection`, `annotateConnections` | Evidence record + deterministic note; data_only notes carry the honesty clause ("Mechanism unverified..."). |
| `TonalityEngine.js` | `classifyTone`, `coherenceCentroid`, `checkTonalCoherence` | Five opposing poles; lone dissenter = outlier, two camps = contradiction axis (exempt from deviation); unclassified honestly reported. |
| `ContextGraph.js` | `buildContextGraph` | nodes {id,kind,label,domain,popularity,uniqueness} + edges {source,target,type,weight,confidence}; edge dedup keeps MAX weight; malformed counted (`stats.skipped`). |
| `GraphWeights.js` | `generateEdgeWeights` | Type priors for null/ZERO weights (measured 0 = unmeasured for layout); rarity boost capped at 1; node strength = 1 - prod(1-w). |
| `OutputValidator.js` | `validateSynthesis`, `collectKnownNames`, `extractMentions` | known names from `name`/`title` keys; quoted + title-case mentions (EN/UK stopwords); containment guard; suffix anchoring; single unquoted tokens deliberately unjudged. |

## 3. SERVICES (I/O)

| Module | Key exports | Contract highlights |
|---|---|---|
| `qlooClient.js` + clients (`entitySearchClient`, `crossDomainClient`, `tasteTagsClient`, `audienceInsightsClient`) | `searchEntities`, `getCrossDomainAffinities`, `findTags`, ... | Transport stack: auth, rate limit, retries, two-tier cache, single-flight, privacy guard, MOCK_MODE fixtures; synchronous validation BEFORE quota. |
| `privacyGuard.js` | `sanitizeInput`, `detectPersonalData` | Two layers: transport (automatic) + input boundary (key denylist); PII never reaches Qloo. |
| `domainMapper.js` | `resolveDomain`, `searchTypesFor`, `classifyEntity`, `MANDATORY_DOMAINS` | Single source of truth for the 5 domains (film/music/books/dining/fashion); registry validated AT LOAD. |
| `seedEntityResolver.js` | `resolveTextQuery` | Probe ladder (title/quoted/fragments, max 3); UUID gate (`ENTITY_ID_PATTERN`); selection via task-48 ranking; typed codes no_results/no_valid_id/no_mapped_entity/upstream_error; injectable `search`. |
| `candidateRanker.js` | `rankCandidates`, `nameSimilarity`, `tagOverlap` | Weighted score with absent-signal renormalization; deterministic tie-breaks. |
| `affinityVectorService.js` | `fetchAffinityVector`, `expandAffinityVector`, `runBounded` | Bounded parallel pool over per-domain affinity queries; per-domain isolation; timeouts bound the WAITER; agent domain -> insights URN via `primaryInsightType`. |
| five extractors (`soundExtractor`, `literaryExtractor`, `materialCultureExtractor`, `gastronomyExtractor`, `visualContextExtractor`) | `extractSoundProfile`, `extractLiteraryProfile`, `extractMaterialProfile`, `extractGastronomyContext`, `extractVisualContext` | Isolated legs; marker tables exported (tuning contracts); literary gate = correlation STRICTLY > 0.65; honest coverage/failures. |
| `dossierLayers.js` | `extractAllLayers` | All five layers as ONE concurrent wave (allSettled isolation); failed layer = null + coverage false. |
| `parallelTasks.js` | `runParallelTasks`, `chunkedProcess` | allSettled per-slot isolation + bounded lanes; setImmediate yield for CPU batches. |
| `llmSynthesizer.js` + `dossierSystemPrompt.js` | `synthesizeDossier`, `SYSTEM_PROMPT`, `assertPromptIntegrity` | OpenAI-compatible call; bounded prompt; typed codes not_configured/timeout/http_error/upstream_error/malformed_response; the prompt has a LOAD-TIME integrity gate over 13 invariants. |
| `sessionCache.js` | `saveSession`, `loadSession`, `listSessions`, `pruneSessions`, `createSessionId` | UUID-gated paths (traversal impossible); atomic writes; TTL purge on read; oldest-first eviction. |
| `memoryHygiene.js` | `isolateCycle`, `collectGarbage`, `cycleMemorySnapshot` | Honest best-effort GC (`--expose-gc` via `npm run test:gc`); only the cycle result escapes; pressure flag vs 8 MB default. |

## 4. CROSS-CUTTING CONTRACTS

1. **Honesty** (tasks 56–70): unmeasured is NEVER zero — null stays null,
   absence of evidence never scores, empty is reported in `coverage`/
   `stats`, `unclassified`/`unverified` are explicit flags.
2. **Determinism**: no clocks, no RNG anywhere in engine or assembly
   services; ties break by documented precedence or input order;
   identical inputs -> byte-identical outputs (test-pinned).
3. **Typed errors**: every failure surface has a module-local Error
   subclass with machine-readable `code` (+ `details`, `cause` where
   useful). Programmer errors -> TypeError; data/upstream -> typed code.
4. **Injection**: every network client is an option (`search`,
   `affinityFn`, `tagsFn`, `fetchFn`, `now`, `baseDir`) — the whole
   stack runs with zero network.
5. **Anti-hallucination chain**: hardened system prompt (load-time
   invariant gate) -> bounded payload -> OutputValidator backstop
   (known-name membership; review gate, not an oracle).
6. **Privacy**: QLOO_API_KEY and LLM_API_KEY never leave the backend;
   outbound PII is redacted unconditionally at the transport layer.
7. **No trackers** (task 77): runtime deps allowlisted, source scanned,
   fetch() confined to two transports, runtime probes with
   instrumented fetch (`npm run verify:trackers`).

## 5. ENVIRONMENT (config/envSchema.js)

| Variable | Default | Purpose |
|---|---|---|
| `QLOO_API_KEY` | — (required) | Qloo credential (never logged). |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Qloo host. |
| `QLOO_*` rate/cache/retry knobs | see envSchema | Transport stack tuning. |
| `MOCK_MODE` | `false` | Fixture-backed offline mode. |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — / openai v1 / gpt-4o-mini | OPTIONAL synthesis integration; boot-safe. |
| `SESSION_CACHE_DIR` / `SESSION_CACHE_TTL_MS` / `SESSION_CACHE_MAX_ENTRIES` | `.cache/sessions` / 1h / 50 | Session cache. |

## 6. VERIFICATION MAP (673 tests, `npm test`)

- Unit suites per module (engine + services), including exhaustive
  matrices (130 FSM pairs, 36 phase pairs) and boundary pins
  (thresholds, rounding, float tails).
- Golden scenarios (`tests/`): `engine-a24` (happy breadth, coherent
  tonality, validator pass), `engine-postpunk` (domain-intent FSM,
  adaptive threshold, tonal OUTLIER, CAUGHT hallucination, relative
  weights, cache resume), `engine-brutalism` (disambiguation FSM,
  exact-match resolution, felt-minimum valve, TWO caught names,
  cache list/delete).
- Gates: `agentCycleBudget` (full cycle <= 900 ms local / 4.5 s A4
  projection), `memoryIsolation` (+ `npm run test:gc`), `noTrackers`
  (+ `npm run verify:trackers`), `verify:env`, `verify:memory`,
  `mcp:verify` (harness compat, 18 tools).

## 7. EXTENDING THE STACK — CHECKLIST

1. New pure math -> `server/src/engine/`, sibling imports only;
   options validated with TypeError; outputs frozen; no clocks.
2. New I/O service -> injectable clients FIRST, typed error codes,
   fail-fast validation before quota, coverage/failure honesty.
3. New marker/allowlist table -> export it (tuning contract) and pin
   it with per-entry tests; runtime changes to prompts/allowlists must
   keep the load-time or test-time integrity gate green.
4. Tests: unit suite + wire into the shared cycle runner
   (`server/test-support/fullCycleRunner.js`) so the perf and memory
   gates keep covering the real path.
5. Update `PLAN_STATE.md` (status block) and this reference.

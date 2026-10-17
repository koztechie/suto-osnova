# MODES SPECIFICATION — ARCHITECTURE
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Scope:** the three operational modes (PRD section 3): contracts, orchestrators, mode-specific modules, the HTTP surface, isolation, and the extension rules. Companion to `AGENT_PIPELINE.md` (the engine/services module reference).

## 0. THE THREE MODES

The agent runs the SAME six-phase ladder (tasks 41–42) in every mode; a mode CONFIGURES the run, it never forks the phase machine. Each mode selects which extraction layers run, which domains expand, and in which DIRECTION the math chain selects. A mode is resolved from a tolerant ingress (id or alias) by `ModeDispatcher` (task 81) into a frozen RUN PLAN.

| Mode id | Label | Output | Layers | Selection | Requires | Thresholds |
|---|---|---|---|---|---|---|
| `worldbuilder` | Worldbuilder (Character & Scene Dossier) | `mise_en_scene_dossier` | sound, literary, material, gastronomy, visual | `non_obvious_affinity` | — | `THRESHOLD_DEFAULTS` |
| `activation` | Experiential Activation (Live Events) | `activation_curation` | sound, material, gastronomy | `non_obvious_affinity` | audienceInsights | `THRESHOLD_DEFAULTS` |
| `antithesis` | Taste Antithesis (Cultural Divergence) | `cultural_blindspot_report` | sound, literary, material, gastronomy, visual | `lowest_correlation` | antithesis | `null` (honest) |

**Default mode:** `worldbuilder` (a blank ingress resolves to it).

**Aliases** (case/spacing-insensitive, `resolveMode`): worldbuilder → `world_builder | dossier | mise_en_scene`; activation → `experiential_activation | experiential | live_events | live | events`; antithesis → `taste_antithesis | divergence | cultural_divergence | blindspot`. A well-formed-but-unknown string is DATA → typed `InvalidModeError` (`unknown_mode`); a wrong TYPE is a programmer error → `TypeError`.

**Honest `thresholds: null` (antithesis):** the adaptive threshold schedule (task 67) GATES acceptance on affinity; the antithesis run SELECTS the weakest/negative correlations, so no affinity threshold applies. The dispatcher nulls it rather than pretending a gate ran.

## 1. LAYER → DOMAIN MAPPING (LAYER_DOMAINS)

Each extraction layer feeds one of the five mandatory agent domains (task 81, pinned against `domainMapper`):

| Layer | Domain | Qloo entity types |
|---|---|---|
| `sound` | music | `urn:entity:artist` (+ `album` for /search) |
| `literary` | books | `urn:entity:book` |
| `material` | fashion | `urn:entity:brand` CARRIED BY the `urn:tag:genre:brand:fashion` family |
| `gastronomy` | dining | `urn:entity:place` CARRIED BY the restaurant tag family |
| `visual` | film | `urn:entity:movie` + `urn:entity:tv_show` |

`fashion` and `dining` require BOTH the matching type AND the qualifying tag family — a service brand is not fashion, a park is not dining (live-verified; pinned by tasks 108–110 fixtures). The layer set a mode enables determines the domains it expands (via `MANDATORY_DOMAINS` order).

## 2. SELECTION STRATEGIES (SELECTION_STRATEGIES)

- `non_obvious_affinity` (Modes 1 & 2): the math chain (tasks 56–61 + 67) accepts the HIGH-affinity, non-obvious picks. Order: adaptive threshold → long-tail Via Negativa → mass-cliche quantile cut → uniqueness annotation → score normalization → non-obvious sort.
- `lowest_correlation` (Mode 3): the chain's ACCEPTANCE machinery is honestly NOT run (no threshold gate, no long-tail cut, no cliche cut — those CUT weak-affinity rows, which are this mode's EVIDENCE). The raw connection score is INVERTED (`TasteInverter`, task 95): `divergence = 1 - affinity` (unsigned) or `(1 - c) / 2` (signed), sorted divergence DESC. Uniqueness (task 57) still runs — its `mainstream` tier is the sponsorship-risk marker.

## 3. MODE 1 — WORLD BUILDER (Character & Scene Dossier)

**Input:** a cultural anchor (title / person / aesthetic description).
**Output:** a print-ready Mise-en-Scene Dossier.
**Orchestrator:** `runWorldbuilder` (`modes/WorldbuilderMode.js`, task 82).

**Pipeline:** resolve + classify the seed → entity via the probe ladder (UUID gate) → drive the AgentSession FSM + six-phase ladder → expand across ALL FIVE domains → run the math chain (threshold → long-tail → cliche → uniqueness → normalize → non-obvious sort) → extract the FIVE layers in ONE concurrent wave (per-layer isolation) → annotate connections (65) → tonal coherence (66) → context graph + numeric edge weights (68–69) → optional narrative synthesis (62–64, honest `not_configured` skip) → optional session persistence (70).

**Mode-specific modules (tasks 83–86):** `SceneDossierTemplate` (the 5-section frozen contract + anti-hallucination pin), `SceneContext` (era/geography deterministic bias, task 84), `MaterialsSpec` (fabrics/metals/lighting from material markers), `DialogueContext` (voice from the tonality centroid + era vocabulary).

**Injection:** `affinityFn` REQUIRED (both calling conventions); search / searchFn / tagsFn / insightsFn / fetchFn optional; the whole run executes with ZERO network under stubs. `scene` (era + geography) is validated synchronously before any client work (`SceneContextError` vs `TypeError`).

**HTTP:** `POST /api/generate/worldbuilder`. **Control test:** `kyivArchivistScenario` — "Kyiv Underground Archivist" (task 108).

## 4. MODE 2 — EXPERIENTIAL ACTIVATION (Live Events)

**Input:** a headlining artist or festival concept.
**Output:** a curation list (opening acts, brand sponsors, F&B vendors).
**Orchestrator:** `runExperiential` (`modes/ExperientialMode.js`, task 87).

**What makes it ACTIVATION:**
- **Audience insights are a FIRST-CLASS leg** — the headliner is blended into a Qloo audience-insights query (`entityIds` + the scene LOCATION as the venue locality, task 84 integration). The leg degrades HONESTLY: a typed failure lands in the ledger and `audience.available=false`; curation continues on graph evidence alone.
- Expansion targets the THREE activation domains only (music → opening acts, fashion → brand sponsors, dining → vendors); the three activation layers run (sound, material, gastronomy) — no literary/visual quota spend.
- **DUAL-EVIDENCE MARKING:** a pick confirmed by BOTH the taste graph and the audience leg is `dual`, else `confirmed_affinity` (Billboard-grade attribution).

**Mode-specific modules (tasks 88–93, 98):** `AudienceAnalysis` (per-act fingerprints + a BLEED query), `AfterpartyEcosystem` (nightlife venues from venue markers), `OpeningActs` (composite graph/containment/tag-kinship selection with gates), `BrandPartners` (partner brands + the merch direction), `FoodCuration` (the F&B zone map), `ResonanceIndex` (the 0–100% coherence measurement), `SponsorshipBlindspots` (the fail-brand screen).

**Blocks that ride the bundle:** `audience`, `curation` (openingActs/sponsors/vendors), `afterparty`, `foodZones`, `resonance`.

**HTTP:** `POST /api/generate/experiential`. **Control test:** `darkAmbientActivation` — "Dark Ambient Live" (task 109).

## 5. MODE 3 — TASTE ANTITHESIS (Cultural Divergence)

**Input:** a target entity.
**Output:** a "Cultural Blindspot" Report (dramatic conflict, antagonist design, sponsorship risk).
**Orchestrator:** `runAntithesis` (`modes/AntithesisMode.js`, task 94).

**The inverted chain:** the plan carries `selection: lowest_correlation` + `thresholds: null`, so the acceptance machinery is honestly NOT run — the chain's rejects are this mode's EVIDENCE. What runs: the seed/entity resolution, the FSM + ladder (with the ANTITHESIS_READY phase carrying the REAL divergence payload, never a skip marker), the bounded five-domain expansion, `TasteInverter` (task 95) for the inversion, and the `DissonanceFilter` (task 96). NO extraction layers run (the report is built from the inverted vector alone).

**The blindspot block:** a per-domain MATRIX (top `perDomain` weakest correlations; empty domains stay visible with count 0), `conflictDrivers` (the strongest cross-domain divergences), `sponsorshipRisks` (mainstream-tier picks), and a PROTAGONIST FINGERPRINT (task 97: the hero's own strongest affinity per domain — the contrast the antagonist profile builds on).

**Inversion contracts (tasks 95–96):**
- `TasteInverter` (engine): a declared signed `correlation` outranks the unsigned task-60 chain; corrupt values are rejected (never salvaged); signed `(1-c)/2` vs unsigned `1-a`; sorted divergence DESC.
- `DissonanceFilter` (engine): `proven` (a signed negative) > `zero` (a proven zero affinity) > `weak`; the ENCOUNTER axis (task-57 popularity tiers) cuts accidental noise — obscure/unmeasured popularity is graph noise, not opposition (`obscure_unproven` / `unmeasured_encounter`), and `keepMinimal` / `minEncounterTier` tune the strictness.

**Mode-specific modules (tasks 95–97):** `TasteInverter`, `DissonanceFilter`, `AntagonistProfile` (the dramaturg's antagonist-profile generator over the fingerprint + matrix).

**HTTP:** `POST /api/generate/antithesis`. **Control test:** `antithesisControl` — "Mainstream Pop Icon" (task 110).

## 6. HTTP SURFACE (tasks 111–116)

| Route | Method | Mode | Notes |
|---|---|---|---|
| `/api/generate/worldbuilder` | POST | 1 | `{ seed, options?, format? }`; json/markdown/html |
| `/api/generate/experiential` | POST | 2 | same body; the audience leg is required |
| `/api/generate/antithesis` | POST | 3 | same body |
| `/api/categories` | GET | — | the 5 domains + registry metadata (static, cacheable) |
| `/api/health` | GET | — | system + Qloo connectivity |

- **Validation:** a lightweight JSON-Schema subset (`schemaValidator.js`, task 115) with a per-property `errorCode` (INVALID_SEED / INVALID_FORMAT / INVALID_OPTIONS / INVALID_BODY); the free-form `options` are validated by each mode's own `validateOptions`.
- **Formats:** `json` (default) = the standardized envelope (`JsonExporter`, task 103); `markdown` (`MarkdownExporter`, 102); `html` (`HtmlPrintFormatter`, 104/105/106). Every response carries `X-Request-Id`; the document always ends with the DATA SOURCES (106) and PRIVACY NOTICE (107) sections.
- **Spam protection:** a per-client (IP) inbound limiter (`rateLimit.js`, task 116) — a fixed window per client, the limiter running BEFORE body parsing; a burst beyond `INBOUND_RATE_LIMIT` → 429 `RATE_LIMITED` with `Retry-After`. Health/categories are unlimited.

## 7. ISOLATION & DETERMINISM (tasks 117–118)

- **Mode isolation:** the three modes are COMPLETELY isolated — sequential runs leave each other's results byte-identical, concurrent runs (Promise.all) match sequential, each bundle is deep-frozen with no cross-mode fields, the MODES registry is frozen, and options never bleed between modes (`modeIsolation.test.js`, task 118).
- **Generation budget:** Mode 1 (the worst case: 5 domains + 5 layers + LLM synthesis) computes in ~20ms offline; including a realistic ~1.5s LLM call the total stays under the PRD 4.5s budget (`generationBudget.test.js`, task 117).
- **Determinism:** every mode is pure over its injected clients — no clocks, no RNG; identical input + clients → a deep-equal bundle (pinned per mode and by the control scenarios).

## 8. EXTENSION RULES

To add a mode: register it in `MODES` (with its label / output / layers / selection / requires / thresholds) + its aliases; add a `run<Mode>` orchestrator that drives the shared FSM + ladder (never fork the phase machine); add a `LAYOUTS` entry + section-registry entries in `DossierFormatter` (task 101) so the document/Markdown/HTML/JSON surfaces pick it up; add a `POST /api/generate/<mode>` handler (a three-line delegation to `runGenerate`, task 112); add a `handleGenerate...` branch in `app.js`; and add a CONTROL TEST (a deterministic fixture universe + a full-mode assertion set, tasks 108–110). Respect the layer→domain mapping and the per-domain distinct-UUID rule (expandTastes dedups globally).

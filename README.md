# SUTO OSNOVA

[![License: MIT](https://img.shields.io/github/license/koztechie/suto-osnova?color=D4A853&style=flat-square)](LICENSE)
[![tests](https://img.shields.io/github/actions/workflow/status/koztechie/suto-osnova/test.yml?branch=main&label=tests&color=E06338&style=flat-square)](https://github.com/koztechie/suto-osnova/actions/workflows/test.yml)
[![node](https://img.shields.io/badge/node-22%2B-1F2326?style=flat-square)](https://nodejs.org)
[![Qloo API](https://img.shields.io/badge/Qloo%20API-integrated-96A2A8?style=flat-square)](https://www.qloo.com/)

**Cultural taste engine for the agentic era.** Give it a cultural anchor — an artist, a film, a
mood, a place — and it returns a statistically grounded *mise-en-scène dossier*: ranked entities
across five cultural domains, the connections between them, material and sound specs, and an
honest evidence ledger behind every recommendation. All of it computed from real cross-domain
taste affinity delivered by the [Qloo Taste AI](https://www.qloo.com/) API.

Built for the **Qloo Agentic Hackathon** ([Devpost](https://qloo.devpost.com/)).

## Live Demo

[![live demo open app](https://img.shields.io/badge/live%20demo-open%20app-E06338?style=for-the-badge)](https://suto-osnova.netlify.app)

**https://suto-osnova.netlify.app** — the working web application, public and anonymous: no
account, no setup, no paywall.

- **Try it:** tap a preset — *David Lynch Noir*, *Post-Punk Berlin* or *Ambient Festival* — or
  type your own cultural anchor, choose one of the three modes and press **Generate**. The
  dossier arrives with ranked entities across five cultural domains, connections, tonality and
  the live Raw API Call Inspector — exportable as JSON, Markdown or HTML.
- **Availability:** hosted on Netlify, reachable without credentials (the rules section-4
  testing requirement), and guarded by a stability probe that is re-run against production —
  see [docs/HOSTING_STABILITY.md](docs/HOSTING_STABILITY.md).
- **Source:** this repository (public, MIT) — **Release:** `v1.0.0-hackathon`.

## What is SUTO OSNOVA

**The problem — language models are culturally blind.**
A language model can write a paragraph about a film, but it cannot *taste* anything: it has no
measured opinion about what actually connects one cultural artifact to another. Asked for
recommendations it does what statistics do — it averages the training corpus toward the middle,
reproduces generic cultural stereotypes and invents affinities that were never measured
anywhere. For creative work that is fatal: a mise-en-scène needs the only answer averaging
cannot give — **what belongs together, by how much, and what is the evidence.** A plausible
sentence is not a data point.

**The solution — ground every claim in the Qloo taste graph.**
SUTO OSNOVA does not guess cultural relationships, it queries them. [Qloo Taste AI](https://www.qloo.com/)
maintains a cross-domain taste graph of 250M+ entities — film, music, literature, dining,
fashion and beyond — wired together by measured affinities based on real human taste. The engine
resolves your anchor to a graph entity, pulls its cross-domain affinity vector and turns those
scores into a dossier: ranked entities with their affinity numbers, five-domain coverage, and an
explicit failure ledger wherever the graph had nothing to say. The optional narrative prose is
strictly bound to those computed numbers (cited entities and scores, nothing invented), and the
Raw API Call Inspector in the UI exposes the underlying Qloo payload — every claim is one click
from its source.

**In one line:** a language model tells you what *sounds* right; SUTO OSNOVA shows what
*measures* right — and shows its work.

## The three agent modes

| Mode | Output id | Endpoint | Input -> Output |
|---|---|---|---|
| 1. Worldbuilder Mode | `mise_en_scene_dossier` | `POST /api/generate/worldbuilder` | a cultural anchor -> a print-ready mise-en-scene dossier |
| 2. Experiential Activation Mode | `activation_curation` | `POST /api/generate/experiential` | a headliner or festival concept -> a live-event curation list |
| 3. Taste Antithesis Mode | `cultural_blindspot_report` | `POST /api/generate/antithesis` | an anchor -> its measured opposite: a cultural blindspot report |

All three run the **same six-phase ladder** — a mode *configures* the run (which layers, which
domains, which selection direction), it never forks the state machine. `worldbuilder` is the
default mode; every mode accepts aliases (`dossier`, `live_events`, `blindspot`, … — the full
table lives in `server/src/engine/ModeDispatcher.js`). Every mode answers JSON (the standardized
`suto-osnova.dossier/v1` envelope), Markdown or HTML — all three exportable from the UI.

### Worldbuilder Mode (Mode 1 — Character & Scene Dossier)

- **For:** building a scene or a character board from one cultural anchor — or from a pure
  aesthetic description — with the evidence attached to every pick.
- **In:** a title, a person or a taste description; an optional scene context (era + geography)
  that applies a deterministic bias *before* the gate (typed `SceneContextError` for bad values,
  `TypeError` for bad types).
- **Out:** the five-section frozen `SceneDossierTemplate` — ranked entities across ALL FIVE
  domains, the five extraction layers in one bounded wave (sound, literary, material,
  gastronomy, visual), connections with evidence records, tonal coherence, a context graph with
  numeric edge weights, materials spec, dialogue context, and the optional narrative cited to
  the computed numbers.
- **Math direction:** `non_obvious_affinity` — adaptive threshold -> long-tail via-negativa ->
  mass-cliche cut -> uniqueness annotation -> score normalization -> non-obvious sort.
- **Try:** the *David Lynch Noir* preset, or the control scenario anchor *Kyiv Underground
  Archivist*.

### Experiential Activation Mode (Mode 2 — Live Events)

- **For:** live-event curation — a booking or promotion team turning a headliner into a full
  bill: who opens, who sponsors, who feeds the crowd.
- **In:** a headliner artist or a festival concept; a scene location enters as the venue
  locality.
- **Out (`activation_curation`):** `curation` (opening acts, brand sponsors, food & beverage
  vendors), `audience` fingerprints, `afterparty` venues, `foodZones` and the `resonance` index
  (0-100% coherence) — with the honest ledger riding along (`audience.available=false` when the
  audience leg fails; curation continues on graph evidence alone).
- **What makes it *activation*:** audience insights run as a **first-class leg** blended with
  the venue locality; only the three activation domains expand (music -> opening acts, fashion
  -> sponsors, dining -> vendors; layers sound, material, gastronomy — no literary/visual
  quota spend); and every pick is marked `dual` (taste graph and audience leg agree) or
  `confirmed_affinity` (graph only) — dual-evidence attribution.
- **Try:** the *Ambient Festival* preset, or the control scenario anchor *Dark Ambient Live*.

### Taste Antithesis Mode (Mode 3 — Cultural Divergence)

- **For:** dramatic conflict and antagonist design — and the sponsorship-risk screen: what does
  this anchor deliberately NOT connect to?
- **In:** a target entity.
- **Out (`cultural_blindspot_report`):** the `antithesis` block — a per-domain matrix of the
  weakest correlations (empty domains stay visible with `count: 0`), `conflictDrivers` (the
  strongest cross-domain divergences), `sponsorshipRisks` (mainstream-tier picks) and the
  protagonist fingerprint (the hero's own strongest affinity per domain — the contrast the
  antagonist profile is built on).
- **The inversion:** the acceptance machinery is honestly *not* run — `thresholds: null` (no
  gate, no long-tail cut, no cliche cut: those CUT the weak rows that are this mode's evidence).
  `TasteInverter` computes `divergence = 1 - affinity` and sorts divergence descending,
  `DissonanceFilter` narrows the set; uniqueness annotation still runs because its `mainstream`
  tier IS the risk marker. No extraction layers spend quota — the report is built from the
  inverted vector alone.
- **Try:** run any anchor (for example *Post-Punk Berlin*) with the Antithesis mode radio
  selected — the dossier arrives as a blindspot report instead of a scene.

Every mode answers JSON (the standardized `suto-osnova.dossier/v1` envelope), Markdown or HTML
— all three exportable from the UI.

## How it works

1. **Seed resolution** — the anchor is classified and resolved to a Qloo entity. When Qloo
   rejects a record as a taste signal, the resolver walks its ranked alternatives (bounded, and
   only comparably-scored ones: a swap rescues another edition of the same work, never a topic
   jump) and fails with an honest typed `no_usable_signal` when nothing is usable.
2. **Affinity vector** — one insights call per target domain (film, music, books, dining,
   fashion + the seed's own domain) builds the cross-domain taste graph; per-domain failures are
   isolated and reported, never hidden.
3. **Candidate math** — adaptive threshold gating, long-tail via-negativa, mass-cliché cutting
   (which can never empty a non-empty section) and non-obviousness ranking — all deterministic.
4. **Dossier layers** — sound, literary, gastronomy, material-culture and visual extractors run
   as one bounded-parallel wave; each leg is isolated and audited into the failure ledger.
5. **Narrative (optional)** — with `LLM_API_KEY` set, a synthesis pass drafts the prose strictly
   grounded in the computed numbers (entities and scores are cited; nothing is invented). Without
   a key the deterministic dossier still ships complete.

The transport to Qloo sits behind auth, sliding-window rate limiting, bounded retries with
jitter, a disk cache, single-flight de-duplication and a privacy guard. `MOCK_MODE=true` serves
recorded fixtures so the whole pipeline runs offline.

## Architecture — data flow

One generation cycle, from the incoming request to the final dossier:

```
 POST /api/generate/<mode>    { seed, format: json|markdown|html, options }
                 |
                 ▼
 +-----------------------------------------------------------------+
 | GATEWAY    netlify/functions/api.mjs -> server/src/app.js        |
 | path normalize - inbound rate limit (30 req/60 s) - validateBody |
 +---------------------------+-------------------------------------+
                             ▼
 #=================================================================#
 # AGENT STATE MACHINE  server/src/engine/{AgentStateMachine,       #
 #   AgentSession,AgentPhases}.js                                   #
 # events: REQUEST_RECEIVED -> INPUT_VALID -> INTENT_CLASSIFIED ->  #
 #         DOMAIN_RESOLVED -> EXECUTION_SUCCEEDED   (frozen table)  #
 # phases: IDLE -> SEED_RESOLUTION -> AFFINITY_EXPANSION ->         #
 #         ANTITHESIS_GENERATION (explicit skip) ->                 #
 #         DOSSIER_SYNTHESIS -> COMPLETED       (audit snapshot)    #
 #=================================================================#
   | seed: SeedResolver -> SeedClassifier         | anchor entity +
   | -> seedEntityResolver (GET /search)          | 5 target domains
   ▼                                              ▼
 +-----------------------------+   +------------------------------------+
 | SEED RESOLVER               |   | QLOO API  taste-graph transport     |
 | server/src/services/        |-->| rate limit -> retry -> disk cache ->|
 |   seedEntityResolver.js     |<--| single-flight -> privacy guard      |
 | probes -> search -> entity; |   | /search - /v2/insights - tags -     |
 | signal probe: swap a usable |   | audience -> hackathon.api.qloo.com  |
 | alt or typed no_usable_     |   +------------------+-----------------+
 | signal                      |                      |
 +-----------------------------+                      | measured affinity
        candidates + scores (seed domain + 5 domains) <┘
                 |
                 ▼
 +-----------------------------------------------------------------+
 | CANDIDATE MATH   server/src/engine/{AdaptiveThreshold,           |
 |   LongTailFilter,PopClicheFilter}.js - pure & deterministic      |
 +---------------------------+-------------------------------------+
                             ▼
 +-----------------------------------------------------------------+
 | UNIQUENESS FILTER   server/src/engine/UniquenessCoefficient.js   |
 | annotateUniqueness: U(p)=log2(1/p)/log2(1e6) -> microtail ...    |
 | mainstream tiers -> ScoreNormalizer -> NonObviousSorter          |
 | (expansion dedup already ran: first plan domain wins)            |
 +---------------------------+-------------------------------------+
                             ▼
 +-----------------------------------------------------------------+
 | DOSSIER ASSEMBLY   server/src/services/dossierLayers.js          |
 | 5 extraction layers in one bounded wave (sound - literary -      |
 | food - material - visual) + connections + tonality + graph ->    |
 | optional LLM narrative bound to the numbers -> OutputValidator   |
 | (hallucination backstop) -> deep-frozen bundle                   |
 +---------------------------+-------------------------------------+
                             ▼
 +-----------------------------------------------------------------+
 | FINAL DOSSIER   server/src/formatters/{JsonExporter,             |
 |   MarkdownExporter,HtmlPrintFormatter}.js                        |
 | { schema: suto-osnova.dossier/v1,                                |
 |   data: { ranked, layers, connections, ... },                    |
 |   meta: { expansion, coverage, failures, stats } }               |
 +---------------------------+-------------------------------------+
                             ▼
           200 response -> client render (5-domain cards) ->
           export JSON / Markdown / HTML
```

Stage contracts live in [docs/architecture/AGENT_PIPELINE.md](docs/architecture/AGENT_PIPELINE.md).
The `engine/` layer never performs I/O — every network client is injectable, which is exactly how
the whole cycle runs offline under `MOCK_MODE`.

### Qloo API surface

Every taste fact in a dossier originates from the Qloo Taste AI graph
(`https://hackathon.api.qloo.com`), through exactly four endpoints:

| Endpoint | Powers | Client |
|---|---|---|
| `GET /search` | anchor/seed resolution against the graph | `server/src/services/entitySearchClient.js` |
| `GET /v2/insights` | cross-domain affinities — the measured taste vector | `server/src/services/crossDomainClient.js` |
| `GET /v2/tags` | taste-tag catalogs feeding all five extraction layers | `server/src/services/tasteTagsClient.js` |
| `GET /v2/audiences` | audience insight rows for Experiential Mode | `server/src/services/audienceInsightsClient.js` |

One shared transport (`server/src/services/qlooClient.js`): `X-Api-Key`, sliding-window rate limit,
bounded retries, two-tier disk cache, single-flight de-duplication and the unconditional privacy
guard. The optional narrative calls an OpenAI-compatible `chat/completions` and is bound to the
numbers by `OutputValidator` (the hallucination backstop). And when Qloo cannot answer, the agent
returns a typed refusal (e.g. `no_usable_signal`) instead of inventing taste — cultural
intelligence is the differentiator, not decoration.

## Stack

- **Client** — hand-rolled ES modules, zero frameworks, zero runtime dependencies (`client/`).
- **Gateway** — Node.js 22, serverless-first HTTP service (`server/src/`: engine, services,
  modes, formatters, plus an optional [MCP](https://modelcontextprotocol.io/) tool server —
  connect it to any MCP client with [docs/MCP.md](docs/MCP.md)).
- **API** — Qloo Taste AI (`hackathon.api.qloo.com`).
- **Hosting** — Netlify (`netlify.toml`): static client and the v2 function gateway on one
  origin, publicly reachable (rules section 4).

## Quickstart

Prerequisites: Node.js 22+, npm, and a Qloo API key
([request one](https://docs.qloo.com/)) — offline mode works without one.

```bash
git clone https://github.com/koztechie/suto-osnova.git
cd suto-osnova
npm ci
cp .env.example .env          # set MOCK_MODE=true (offline) or your QLOO_API_KEY (live)
```

The preview serves the client source directly, so **no build step is needed locally**
(`npm run build` is for deployment — Netlify executes it via `netlify.toml`). The full
step-by-step guide — installation, environment variables, run variants, verification and
troubleshooting — lives in [docs/LOCAL_RUN.md](docs/LOCAL_RUN.md).

Run the full app locally — the production topology (static client + `/api` proxy), two terminals:

```bash
# terminal 1 — the API gateway
PORT=8787 npm start

# terminal 2 — the client preview server
node scripts/serveClient.mjs  # -> http://localhost:5173
```

Useful variants:

```bash
MOCK_MODE=true PORT=8787 npm start   # offline run over recorded fixtures (no key needed)
npm start                            # the API gateway alone (default port 3000)
npm run mcp                          # the MCP tool server over stdio
```

## Configuration

Everything is driven by environment variables (`.env` locally, the Netlify dashboard in
production). `.env.example` is the template; the full validated schema lives in
`server/src/config/envSchema.js`.

| Variable | Default | Purpose |
|---|---|---|
| `QLOO_API_KEY` | — (required) | Qloo Taste AI credential; server-side only, never shipped to the browser |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Qloo endpoint |
| `MOCK_MODE` | `false` | recorded fixtures instead of live traffic |
| `QLOO_RATE_LIMIT` / `QLOO_RATE_WINDOW_MS` | `5` / `1000` | outbound Qloo request budget |
| `QLOO_CACHE_ENABLED` / `QLOO_CACHE_DIR` | `true` / `.cache/qloo` | disk cache of Qloo responses |
| `INBOUND_RATE_LIMIT` / `INBOUND_RATE_WINDOW_MS` | `30` / `60000` | per-client inbound budget |
| `LLM_API_KEY` | — (optional) | enables the cited narrative synthesis |
| `LLM_BASE_URL` / `LLM_MODEL` | `https://api.openai.com/v1` / `gpt-4o-mini` | OpenAI-compatible endpoint; OpenRouter free models work too |
| `LLM_MAX_TOKENS` / `LLM_TIMEOUT_MS` / `LLM_REASONING` | `800` / `12000` / `off` | synthesis budget and reasoning control |
| `LOG_LEVEL` / `PORT` | `info` / `3000` | logging verbosity / gateway bind port |

## Tests and gates

| Command | What it proves |
|---|---|
| `npm test` | the full offline suite (1201 tests: engine math, transport stack, the three modes, formatters, HTTP surface, MCP, recorded fixtures) |
| `npm run lint` | syntax gate over the server sources |
| `npm run test:stress` | sequential real-mode load against a local server |
| `node tests/hosting-stability.js` | LIVE stability probe of a deployment: TLS, CDN availability and latency, API health, security headers, the three public presets. Exit 0 = STABLE |
| `node scripts/verifyRepoHygiene.mjs` | repository hygiene gate: no test screenshots, logs or profiling artifacts are ever tracked |
| `npm run verify:env` / `verify:memory` / `verify:trackers` / `mcp:verify` | environment, memory-ceiling and no-tracking audits; MCP harness compatibility |

## Deployment

Netlify is the canonical host. `netlify.toml` pins Node 22, the `/api/*` redirect, the SPA
fallback and the security headers (CSP, nosniff, frame-deny, referrer and permissions policy).

```bash
netlify deploy --prod
```

- Stability record of the live host: [docs/HOSTING_STABILITY.md](docs/HOSTING_STABILITY.md)
- Hackathon rules compliance (section 4 — public hosting, public repo, license):
  [docs/HACKATHON_COMPLIANCE.md](docs/HACKATHON_COMPLIANCE.md)

## Repository layout

| Path | Contents |
|---|---|
| `client/` | the zero-dependency web client (source + `public/` launch assets) |
| `server/src/engine/` | deterministic pipeline: seed classifier, resolver wiring, thresholds, filters, ranking |
| `server/src/services/` | Qloo transport stack (client, rate limiter, cache, privacy guard) and the affinity/expansion services |
| `server/src/modes/` | the three agent modes |
| `server/src/formatters/` | JSON / Markdown / HTML exporters |
| `server/src/mcp/` | the Model Context Protocol tool server |
| `netlify/` | the serverless gateway adapter |
| `scripts/` | build, preview and verification tooling |
| `tests/`, `server/test/` | the suite plus the standalone gates |
| `examples/` | two real dossiers generated by the live app (see below) |
| `docs/` | PRD, layout, tech stack, architecture specs, compliance records |
| `PLAN_STATE.md` | the append-only journal — every task with its evidence |

## Documentation

### Example dossiers (real output of the live app, generated 2026-10-22)

- [examples/dossier_david_lynch.md](examples/dossier_david_lynch.md) — Worldbuilder Mode from
  the *David Lynch Noir* preset anchor: top affinities, the scene dossier, tonality, materials
- [examples/dossier_live_festival.md](examples/dossier_live_festival.md) — Experiential
  Activation Mode from a festival anchor (*Glastonbury Festival*): resonance index, curation,
  audience, food zones

### Project documents

- [docs/02_PRD_SCOPE.md](docs/02_PRD_SCOPE.md) — product scope
- [docs/03_LAYOUT.md](docs/03_LAYOUT.md) — information architecture and layout
- [docs/04_TECH_STACK.md](docs/04_TECH_STACK.md) — technology decisions
- [docs/architecture/AGENT_PIPELINE.md](docs/architecture/AGENT_PIPELINE.md) — the agent pipeline
- [docs/architecture/MODES_SPECIFICATION.md](docs/architecture/MODES_SPECIFICATION.md) — mode contracts
- [docs/QLOO_HACKATHON.md](docs/QLOO_HACKATHON.md) — the hackathon's Devpost intel: dates,
  prizes, judges, criteria, submission pillars, full rules index (collected 2026-10-22)
- [docs/SUBMISSION_DRAFT.md](docs/SUBMISSION_DRAFT.md) — paste-ready Devpost submission
  text (all fields), pre-submit checklist, post-close rules
- [AGENTS.md](AGENTS.md) — the engineering rules of this codebase

## License

MIT — see [LICENSE](LICENSE). The license is detectable and displayed in the repository About
column.

# Devpost Submission Draft — SUTO OSNOVA

Paste-ready material for every field of the Devpost "Enter a Submission"
form at [qloo.devpost.com](https://qloo.devpost.com/). Written against
the official rules collected in
[QLOO_HACKATHON.md](QLOO_HACKATHON.md) and verified against the live
application.

**Timing rules (official).** The close is confirmed by FOUR independent official
records (home badge, rules §1, the `/details/dates` table, the JSON-LD `endDate`):
**October 30, 2026, 11:45 pm EDT.** None of these clocks is your local clock —
for an entrant on Kyiv time (UTC+2; Ukraine's seasonal clock change fell on
October 25, 2026, so winter time already applies) the operative moments are:

| Milestone | Official (ET) | UTC | Kyiv (UTC+2) |
|---|---|---|---|
| **Submissions CLOSE (hard deadline)** | Oct 30, 2026, 11:45 pm EDT | Oct 31, 03:45 | **Oct 31, 2026, 05:45** |
| Recommended repo/deployment freeze (this draft) | Nov 1, before judging opens | — | **by end of Nov 1 (Kyiv)** |
| Judging opens | Nov 2, 2026, 12:00 pm EST | Nov 2, 17:00 | Nov 2, 2026, 19:00 |
| Judging ends (dates table) | Nov 5, 2026, 9:00am EST | Nov 5, 14:00 | Nov 5, 2026, 16:00 |
| Winners announced ("on or around") | Nov 5, 2026, 3:00pm EST | Nov 5, 20:00 | Nov 5, 2026, 22:00 |

(US clocks fall back on November 1 — every row from Nov 2 on is already EST/UTC-5;
conversions computed with IANA `America/New_York` + `Europe/Kyiv`, not by hand.)

- Submit **before Oct 31, 2026, 05:45 Kyiv time** — after the period closes the
  submission itself cannot be modified (only the project page in your Devpost
  portfolio). Prepare, verify, paste, submit — now, not on the deadline morning.
- Drafts are allowed: Devpost lets you save a draft and finish later.
- If selected to the Top 3: you must be available to appear live on November 5
  (see the update in [QLOO_HACKATHON.md](QLOO_HACKATHON.md) section 4).

---

## Field 1 — Project name (step 2 "Project overview" — HARD LIMIT 60 characters)

The live Devpost form enforces **60 characters** with a live counter (the
earlier long name was 77 characters and does not fit). Primary:

```
SUTO OSNOVA — agentic cultural intelligence
```

43 characters. Alternates, also within the limit:

- `SUTO OSNOVA — cultural intelligence agent` (41)
- `SUTO OSNOVA: agentic cultural intelligence` (42)
- `SUTO OSNOVA — agents with cultural taste` (40)

## Field 2 — Elevator pitch (same step — HARD LIMIT 200 characters)

```
Agents, but with taste: an agent that stops guessing what people love and measures it on Qloo's taste graph instead.
```

116 characters, fits the 200-character textarea (84 characters left in the counter).

## Field 3 — "What does your project do?" (Markdown — paste as-is)

````markdown
**SUTO OSNOVA** turns a plain cultural anchor — "David Lynch Noir", "Post-Punk Berlin",
"Glastonbury Festival" — into a decision-ready cultural dossier, grounded end to end in
Qloo's taste graph (250M+ entities across music, film/TV, dining, fashion, travel and more).

**Entry category:** an agentic tool (rules option a) — a standalone agent with an
explicit state machine; Qloo is its knowledge layer, not a plugin.

### What it does

Three agent modes, three export formats, one pipeline:

- **Worldbuilder (Character & Scene Dossier)** — anchor to a full mise-en-scène:
  top affinities, sonic architecture, literary substrate, material culture,
  gastronomic topology, visual chiaroscuro — with tonality and connections.
- **Experiential Activation (Live Events)** — festival/event anchors to an event
  resonance index with weighted evidence, curated picks, audience insights and food zones.
- **Taste Antithesis** — the cultural antipode report: what this taste is *not*,
  and where it flips.
- Exports as **JSON envelope** (schema `suto-osnova.dossier/v1`), **Markdown document**
  or **print-ready HTML/PDF**. No account, no storage: the page stores nothing and
  tracks nobody.

### Why Qloo is the differentiator (not an add-on)

Every taste fact comes from exactly four Qloo endpoints — `GET /search` (anchor
resolution), `GET /v2/insights` (cross-domain affinities — the measured vector),
`GET /v2/tags` (taste-tag catalogs for all five extraction layers), `GET /v2/audiences`
(audience rows for events) — over one hardened transport (`X-Api-Key`, sliding-window
rate limit, bounded retries, two-tier cache, single-flight, privacy guard).

Remove the Qloo key and the agent **refuses to invent**: it fails closed with a typed
refusal (e.g. `no_usable_signal`) instead of fabricating taste. The narrative layer is
bound to the measured numbers by a validator (the hallucination backstop). If this app
would work the same without Qloo, it would be the wrong thing — and it demonstrably
would not: the graph *is* the product.

### Technical depth (for the implementation score)

- Vanilla ES6+ client with zero frameworks, Node.js 22 serverless gateway on one
  origin (Netlify), all engine math (`AdaptiveThreshold`, `LongTailFilter`,
  `PopClicheFilter`, `UniquenessCoefficient` — U(p)=log2(1/p)/log2(1e6)) pure and
  deterministic, injectable I/O, offline fixtures under `MOCK_MODE`.
- **Built entirely inside the submission period**: the first commit is 2026-10-15 —
  nothing in the project predates the contest window (verifiable in the public
  commit history).
- A **Raw API Call Inspector** inside the demo: the client call log, live Qloo
  connectivity and the backend's provenance ledger, shown verbatim — judges can audit
  exactly what Qloo was asked.
- An **MCP server** (stdio) exposing the stack's **18 tools** — including the canonical
  `qloo_*` namespace — so any MCP client can drive the same capabilities. The MCP
  surface is validated against the **official Qloo harness** (`npm run mcp:verify`
  drives `@qloo/qloo-harness` through the identical stdio handshake and compares
  protocol, tools and resources side by side).
- 1,200+ tests on every push (GitHub Actions: lint + full suite), plus standalone
  gates for repo hygiene, trackers and hosting stability.

### The case it matters

Cultural decisions — what to stage, shoot, stock, serve or sell — are currently made
from generic model guesses or expensive manual research. SUTO OSNOVA turns a graph
query into a cited, filtered, export-ready dossier in one request: live-event teams
get resonance and curation they can defend, story teams get a scene kit that isn't a
cliché, and every claim carries provenance back to Qloo. The judges can verify all of
it themselves — the demo shows its own wiring.

**It generalizes:** the same measured layer already returns dining recommendations
from the graph (the gastronomy layer and the event food zones are live today), so the
organizers' lateral directions — room moods, health-aware dining, community journeys —
are parameter sets on this pipeline, not new products.

### What makes the idea non-obvious

Most entries ask an LLM to *sound* cultural. SUTO OSNOVA makes culture a **measured
layer**: cross-domain affinity math, a pop-cliché filter, a uniqueness coefficient with
explicit tiers (microtail -> mainstream), and a non-obvious sort — then the LLM only
narrates numbers that already exist. The result is provably grounded, provably
non-generic, and refuses to answer when the graph cannot.
````

## The real Devpost wizard (5 steps — measured from the live form 2026-10-22)

The submission is a **five-step wizard**, not a single page. Map the
fields below onto it:

| Step | Title | What goes in |
|---|---|---|
| 1 | Manage team | Already done (solo entrant — one representative) |
| 2 | Project overview | **Field 1** (Project name, <=60 chars) + **Field 2** (Elevator pitch, <=200 chars) + the **thumbnail upload** (see below) -> Save & continue |
| 3 | Project details | **Field 3** (description, Markdown) + **Field 4** (Try it URL) + **Field 5** (repository) + **Field 6** (technologies) + the **eight screenshots** with the captions from [DEMO_FRAMES.md](DEMO_FRAMES.md) |
| 4 | Additional info | Whatever the step asks — the prepared credits/license text is **Field 7** |
| 5 | Submit | Final review -> submit, then the Submitted-not-Draft receipt check |

**Thumbnail (right rail of step 2):** JPG/PNG/GIF, 5 MB max, the form
hints "best results, use a 3:2 ratio" — upload
`screenshots/cover-devpost-1200x800.png` (3:2) there; keep
`screenshots/cover-devpost-1200x630.png` for the cover/featured use as
the 1200x630 spec requires. Both are pixel-pure Archival Iron (6/6
palette RGB, verified).

## Field 4 — Try it! (demo URL)

```
https://suto-osnova.netlify.app
```

## Field 5 — Code repository

```
https://github.com/koztechie/suto-osnova
```

## Field 6 — Built with (technologies)

```
Qloo Taste AI API, JavaScript ES6+, Node.js 22, Netlify (static + serverless functions), Model Context Protocol (MCP), JSON Schema, Markdown, OpenAI-compatible chat/completions (optional narrative), GitHub Actions
```

## Field 7 — License / additional credits

```
MIT license (LICENSE file at repository root, shown in the repository About section).
Taste intelligence: Qloo Taste AI API. No other third-party services; no trackers, no cookies, no storage.
```

---

## Pre-submit checklist (all five official pillars)

- [ ] **Functional demo** — https://suto-osnova.netlify.app loads anonymously,
      generate a dossier end-to-end once before submitting.
- [ ] **Public repository** — github.com/koztechie/suto-osnova is public, contains
      source, assets and run instructions ([README.md](../README.md)).
- [ ] **Text description** — Field 3 above (matches the app exactly: three modes,
      three formats, inspector, MCP, tests).
- [ ] **External hosting** — live website on Netlify, nothing local-only.
- [ ] **Open-source license in About** — MIT, visible in the repository About section.

**Entrant conditions (beyond the five pillars, rules §3-§4):**

- [ ] **Eligibility** — you are at or above the age of majority where you reside, and
      your country/territory is not excluded (the rules name Brazil, Quebec, Russia,
      Crimea, Cuba, Iran, North Korea, or any other comprehensively sanctioned
      jurisdiction); you are not a Judge, not employed by a Judge and hold no role in
      the hackathon's promotion; no conflict-of-interest exclusion applies to you.
- [ ] **Third-party integrations authorized** — every dependency is open source
      (MIT: `@modelcontextprotocol/sdk`, `zod`, `vite`) or the organizer's own
      material (Qloo API access via the official form, `@qloo/qloo-harness`); the
      optional narrative uses an OpenAI-compatible endpoint under the operator's own
      credentials.

Self-audit evidence per rule: [HACKATHON_COMPLIANCE.md](HACKATHON_COMPLIANCE.md).

## After submitting

- **Verify it actually landed:** open
  https://devpost.com/submit-to/31054-qloo-agentic-hackathon/manage/submissions —
  the entry must read **Submitted**, not "Draft". A saved draft is NOT a
  submission once the period closes; keep a screenshot as your receipt.
- The submission is frozen at the deadline; the Devpost portfolio project page can
  still be updated (that is allowed after close).
- **Operational freeze (read the two official schedules against each other):** the
  rules text has judging ending Nov 5 at 11:45 pm ET, the platform's dates table has
  it ending Nov 5 at 9:00am EST with winners announced at 3:00pm EST — they cannot
  both hold. Treat the **start of judging (November 2) as the hard cutoff**: freeze
  the repository and the deployment on **November 1**, and push nothing risky after
  it — including on deadline day, when field edits are already prohibited.
- Watch the [updates feed](https://qloo.devpost.com/updates) — finalist notifications
  arrive shortly after close.
- Finalists prepare for the November 5 live final; winners are announced on or around
  November 5 at 3:00 pm ET, with prize affidavits due within 10 business days of
  receipt if you win.

## If you win — the money & paperwork runbook (rules §8)

The award is conditional: the rules make it **subject to verification of the identity,
qualifications and role of the winner in creating the submission**, plus completed
Required Forms. Nothing is due today — but slow or incorrect paperwork forfeits the
prize, so prepare now:

- **Identity/role evidence is already consistent** — a single creator, `Eugene
  Kozlovsky`, across all 199 git commits
  (`185587130+koztechie@users.noreply.github.com`), the GitHub profile name and the
  `package.json` `author` field. Make sure your **Devpost account carries the same
  name** — that is where verification stalls if it does not match.
- **The 10-business-day clock:** Required Forms must be returned within **10 business
  days** of being sent. Example: forms arriving Friday **Nov 6, 2026** are due Friday
  **Nov 20, 2026**. Late or wrong forms = delayed payment, **disqualification or
  forfeiture** (the rules say so explicitly).
- **Have ready:** a government ID (identity), your role statement (solo creator — the
  public git history is the evidence), bank details for an electronic transfer or a
  postal address (the prize is wired or mailed), and the tax form — **W-8BEN** for
  non-US residents, **W-9** for US residents. Winners carry all fees/taxes in their
  jurisdiction and **withholding may apply**.
- **Delivery:** within **60 days** of the completed forms being received.
- **One prize per project**; prizes are non-transferable and the Sponsor may substitute
  equal-or-greater value. The separate Calacanis $25,000 investment appears only in the
  home bonus text, not in rules §8 — whether it stacks with a placed prize is
  unspecified: treat it as upside, not as a plan.

Source text for every claim above: [QLOO_HACKATHON.md](QLOO_HACKATHON.md) section 3.

## If you're named a finalist — preparation (update #47166)

Notification arrives **shortly after submissions close** (Oct 31 – Nov 1), and the Top 3
appear live on **November 5, 22:00 Kyiv** (timing table above) to present, answer
questions and learn the result in real time. The preparation window is measured in
days — prepare before you need it.

**Demo run order (about 2 minutes, one browser tab):**

1. Open https://suto-osnova.netlify.app — the footer carries the Qloo attribution, the
   header connectivity reads "Qloo link: online".
2. Preset **David Lynch Noir** (Worldbuilder) → export Markdown → show the dossier.
3. Experiential mode with the anchor **Glastonbury Festival** → show the resonance
   index with its evidence breakdown. **Do NOT demo the "Ambient Festival" preset in
   public** — it currently returns the typed `no_usable_signal` outcome (documented in
   [HOSTING_STABILITY.md](HOSTING_STABILITY.md)); Glastonbury is the verified working
   festival anchor (its dossier is in
   [../examples/dossier_live_festival.md](../examples/dossier_live_festival.md)).
4. Open the **API Inspector** — client call log plus raw Qloo provenance: the live
   proof of "thoroughly and skillfully uses Qloo".

**60-90 second pitch — one sentence per judging criterion (the exact scoring words).**
Order note: tie-breaks are resolved on the first criterion **first — Technological
Implementation**, so lead with implementation depth whenever the question is "why you":

- **Technological Implementation** — four Qloo endpoints behind one hardened transport
  (rate limit, retries, cache, single-flight, privacy guard); deterministic engine math
  testable offline; 1,200+ tests green on every push.
- **Design** — three coherent modes, three formats, one visual language; a product a
  judge can use, not a proof of concept.
- **Potential Impact** — festival and venue curation teams, production/story teams and
  editorial curators each get a defensible, cited dossier in one request instead of
  generic model guesses.
- **Quality of the Idea** — culture as a measured layer (cross-domain affinity math,
  uniqueness tiers, pop-cliche filter) with the LLM bound to validated numbers — the
  opposite of prompting a model to sound cultural.

**Panel lenses to be ready for.** The panel spans the sponsor's engineering
leadership, a director of a frontier AI lab, live-events and entertainment
executives, and an active angel investor — every domain the product already serves:

- *"Where exactly is Qloo used?"* → the four endpoints; the Inspector shows it live.
- *"Where is the agent?"* → the explicit state machine (`IDLE -> SEED_RESOLUTION ->
  AFFINITY_EXPANSION -> ANTITHESIS_GENERATION (explicit skip outside that mode) ->
  DOSSIER_SYNTHESIS -> COMPLETED`, with typed fail paths); the LLM narrates only
  validated numbers.
- *"Would it work without Qloo?"* → no: it fails closed with a typed refusal; the
  graph is the product.
- *"Who pays?"* → festival and venue curation teams, production design teams,
  editorial curators — the dossier replaces hours of manual cultural research per
  anchor.

## Organizer channels — Discord introduction (paste-ready)

The organizers run a Discord (link on the Resources page of the hackathon). A short,
ready-to-paste introduction:

```text
Hello from the SUTO OSNOVA entry — an agent that turns a cultural anchor into a
decision-ready cultural dossier grounded in Qloo's taste graph: search, insights,
tags and audiences behind one hardened transport. Three modes: scene worldbuilding,
live-event activation, taste antithesis. Live demo: https://suto-osnova.netlify.app
— the API Inspector inside shows every raw Qloo call. Public repo, MIT, 1,200+
tests, and the MCP surface is validated against the official qloo-harness
(npm run mcp:verify). Feedback welcome — especially on festival and event use cases.
```

Use it for an introduction, or when the organizers ask for showcase links.

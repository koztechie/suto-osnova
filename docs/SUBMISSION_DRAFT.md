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

## Field 1 — Submission name

```
SUTO OSNOVA — the cultural intelligence agent for mise-en-scene worldbuilding
```

## Field 2 — Short description (one-liner)

```
Agents, but with taste: an agent that stops guessing what people love and measures it on Qloo's taste graph instead.
```

## Field 3 — "What does your project do?" (Markdown — paste as-is)

````markdown
**SUTO OSNOVA** turns a plain cultural anchor — "David Lynch Noir", "Post-Punk Berlin",
"Glastonbury Festival" — into a decision-ready cultural dossier, grounded end to end in
Qloo's taste graph (250M+ entities across music, film/TV, dining, fashion, travel and more).

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
  `qloo_*` namespace — so any MCP client can drive the same capabilities.
- 1,200+ tests on every push (GitHub Actions: lint + full suite), plus standalone
  gates for repo hygiene, trackers and hosting stability.

### The case it matters

Cultural decisions — what to stage, shoot, stock, serve or sell — are currently made
from generic model guesses or expensive manual research. SUTO OSNOVA turns a graph
query into a cited, filtered, export-ready dossier in one request: live-event teams
get resonance and curation they can defend, story teams get a scene kit that isn't a
cliché, and every claim carries provenance back to Qloo. The judges can verify all of
it themselves — the demo shows its own wiring.

### What makes the idea non-obvious

Most entries ask an LLM to *sound* cultural. SUTO OSNOVA makes culture a **measured
layer**: cross-domain affinity math, a pop-cliché filter, a uniqueness coefficient with
explicit tiers (microtail -> mainstream), and a non-obvious sort — then the LLM only
narrates numbers that already exist. The result is provably grounded, provably
non-generic, and refuses to answer when the graph cannot.
````

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
      jurisdiction); no conflict-of-interest exclusion applies to you.
- [ ] **Third-party integrations authorized** — every dependency is open source
      (MIT: `@modelcontextprotocol/sdk`, `zod`, `vite`) or the organizer's own
      material (Qloo API access via the official form, `@qloo/qloo-harness`); the
      optional narrative uses an OpenAI-compatible endpoint under the operator's own
      credentials.

Self-audit evidence per rule: [HACKATHON_COMPLIANCE.md](HACKATHON_COMPLIANCE.md).

## After submitting

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

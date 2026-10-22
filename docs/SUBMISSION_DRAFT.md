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

## Field 3 — About the project (step 3 "Project Story" — Markdown, required)

The Devpost hint asks for a STORY (what inspired you, what you learned,
how you built it, the challenges) and the form ships ready-made section
headings for exactly that shape. Paste this complete Markdown — every
judging criterion is carried inside the story:

````markdown
## Inspiration

The pitch of this hackathon is real: agents can reason and plan, but ask them what people actually love and they guess. I wanted an agent that ANSWERS with evidence — cultural taste measured on Qloo's taste graph instead of model confidence. And as the challenge itself puts it: if the submission would work the same without Qloo, you're building the wrong thing — so the graph had to be the product, not a decoration.

## What it does

SUTO OSNOVA turns a plain cultural anchor ("David Lynch Noir", "Glastonbury Festival") into a decision-ready dossier in one request:

- **Worldbuilder** — mise-en-scene scene dossier: top affinities, sonic, literary, material, gastronomic and visual layers;
- **Experiential** — live-event activation: resonance index with weighted evidence, curation, audience insights, food zones;
- **Taste antithesis** — the cultural antipode with divergence percentages per domain.

Exports as JSON (schema `suto-osnova.dossier/v1`), Markdown, or print-ready HTML/PDF. No accounts, no storage: the page stores nothing and tracks nobody. Live demo: https://suto-osnova.netlify.app

## How I built it

Vanilla ES6+ front end (zero frameworks) over a Node.js 22 serverless gateway on one origin. Every taste fact comes from four Qloo endpoints — `/search`, `/v2/insights`, `/v2/tags`, `/v2/audiences` — behind one hardened transport: X-Api-Key, sliding-window rate limit, bounded retries, two-tier cache, single-flight, privacy guard. The engine math (adaptive thresholds, pop-cliche filter, a uniqueness coefficient) is pure and deterministic, so the whole cycle also runs offline against recorded fixtures. The optional LLM narrative is bound to the measured numbers by a validator. The MCP surface (18 tools, qloo_* namespace) is validated against the official Qloo harness (`npm run mcp:verify`), and 1,200+ tests run on every push. Everything was built inside the submission period — first commit 2026-10-15, full history public.

## Challenges I ran into

Qloo rejects some entities as signals — even against their own domain. Rather than paper over that, the resolver PROBES the signal and swaps in a comparably-scored alternative, or fails closed with a typed refusal (`no_usable_signal`): a wrong answer is never worth a fabricated one. Balancing the uniqueness filter — measuring how un-crowded a taste is without burying genuinely popular picks — took real iteration.

## Accomplishments that I'm proud of

- The **API Inspector**: the demo shows its own wiring — the client call log, live Qloo transport state (rate limiter, cache counters) and the backend's provenance ledger, verbatim. Judges can audit exactly what Qloo was asked.
- A fail-closed agent: when Qloo cannot answer, it refuses instead of inventing taste.
- A permanent uptime sentinel guarding the demo through the judging window, and pixel-locked brand assets (the cover is palette-pure down to the pixel).

## What I learned

How far cross-domain affinity math takes you: one anchor seeds five domains at once, and measured divergence is a far better editorial signal than a model's confidence score.

## What's next for SUTO OSNOVA — agentic cultural intelligence

The measured layer already returns dining recommendations from the graph — the hackathon's lateral directions (room moods, health-aware dining, community journeys) are parameter sets on this pipeline, not new products. Next: more presets for events and studios, and deeper MCP integration for any AI agent.
````
## Field 4 — Try it! (demo URL)

```
https://suto-osnova.netlify.app
```

## Field 5 — Code repository

```
https://github.com/koztechie/suto-osnova
```

## Field 6 — Built with (step 3 — select2 tags, required, up to 25)

**A space COMMITS the current text as a tag in this widget — never type
a space inside a tag.** Type one of the exact tokens below and press
Enter (or click the matching single-token suggestion if the dropdown
offers it). Recommended order — 10 tags, all space-free:

```
JavaScript
Node.js
Netlify
HTML5
CSS3
Markdown
JSON
QlooAPI
MCP
GitHubActions
```

- `QlooAPI` = the Qloo Taste AI API (the graph every taste fact comes
  from); `MCP` = Model Context Protocol; `GitHubActions` = the CI that
  runs the suite.
- If a multi-word phrase was already committed by accident (e.g. you
  typed "Qloo Taste AI API" and got the chips `Qloo`, `Taste`, `AI`,
  `API`), click the small × on each junk chip inside the Built with box
  first, then add the correct token. Ten tags total, the limit is 25.

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

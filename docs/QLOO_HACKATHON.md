# Qloo Agentic Hackathon — Devpost Intelligence Report

Single-file digest of everything publicly available on
[qloo.devpost.com](https://qloo.devpost.com/) at collection time.

**Provenance.** Collected 2026-10-22 over HTTPS with `curl` using a Chrome
User-Agent (a plain fetcher receives HTTP 403 — Devpost blocks it); content
extracted from the pages' own HTML and the JSON-LD `Event` block
(`#challenge-json-ld`). Only ANONYMOUS surfaces were reachable — logged-in
views (submission management, participant roster) are out of scope. Every
section names its source page. Facts are transcribed or minimally
paraphrased; nothing is inferred.

---

## 1. Snapshot

| Field | Value | Source |
|---|---|---|
| Name | Qloo Agentic Hackathon | home, JSON-LD |
| Tagline | "Agents, but with taste." | home `<title>` / meta |
| URL | https://qloo.devpost.com/ | JSON-LD `url` |
| Devpost hackathon ID | 31054 (from the manage URL `submit-to/31054-qloo-agentic-hackathon`) | home links |
| Sponsor & Administrator | Qloo, 100 Crosby Street, New York, New York, 10012, United States | rules §2 |
| Platform organizer record | Devpost, Inc. | JSON-LD `organizer` |
| Format | Online event, Public, free to enter ("NO PURCHASE OR PAYMENT NECESSARY") | home, rules header |
| Participants | 2,137 | home sidebar `Participants (2137)` |
| Cash pool | $25,000 in prizes (+ a separate personal $25,000 bonus investment, see §4) | home |
| Categories shown | Qloo; Machine Learning/AI | home sidebar |
| Deadline | **October 30, 2026 @ 11:45 pm EDT** | home badge, JSON-LD `endDate` |
| Status at collection | Open — "Join hackathon", submissions open, gallery not yet published | home, /submissions |
| Entry eligibility line | "Above legal age of majority in country of residence"; "All countries/territories, excluding standard exceptions" | home sidebar |

## 2. Key dates (both official records, verbatim — they disagree, see note)

**Schedule table (`/details/dates`, verbatim rows):**

| Period | Begins | Ends |
|---|---|---|
| Submissions | September 30 at 9:30am EDT | October 30 at 11:45pm EDT |
| Judging | November 02 at 12:00pm EST | November 05 at 9:00am EST |
| Winners Announced | November 05 at 3:00pm EST | |

**Official Rules §1 (verbatim):**

- Registration & Submission Period: September 30, 2026 (9:00 am Eastern Time)
  – October 30, 2026 (11:45 pm Eastern Time).
- Judging Period: November 2, 2026 (12:00 pm Eastern Time) – November 5, 2026
  (11:45 pm Eastern Time).
- Winners Announced: on or around November 5, 2026 (3:00 pm Eastern Time).

**JSON-LD:** `startDate` 2026-09-30T09:30:00-04:00, `endDate`
2026-10-30T23:45:00-04:00.

**Discrepancies recorded, not resolved:** (a) submissions open 9:00 am ET per
the rules vs 9:30am EDT per the schedule and JSON-LD; (b) judging ends
November 5 at 11:45 pm ET per the rules vs 9:00am EST per the schedule
table. The judging window (starts Nov 2, 12:00 pm ET) and the winners moment
(Nov 5, 3:00 pm ET) agree across sources.

**As of collection (2026-10-22): 8 days remain to the submission deadline.**

## 3. Prizes (rules §8 + home)

| Place | Prize | Qty |
|---|---|---|
| First Place | $15,000 USD cash | 1 |
| Second Place | $6,000 USD cash | 1 |
| Third Place | $4,000 USD cash | 1 |

- Each Project is eligible to win **one (1) prize**; prizes non-transferable;
  the Sponsor may substitute equal-or-greater value.
- Award is subject to identity/qualification/role verification and completed
  winner affidavits ("Required Forms"); forms due within **10 business days**
  of being sent; delivery within **60 days** of receipt of completed forms.
- Winners pay their own fees/taxes; US residents may file W-9, others
  W-8BEN; withholding may apply.

## 4. Bonus challenge + the live final

- **BONUS (home description):** "Entrepreneur extraordinaire JASON
  CALACANIS … will personally invest an additional $25,000 into his favorite
  entry." A personal investment on top of the $25,000 prize pool.
- **Live final (update #47166, the only update so far):** on
  **November 5th the Top 3 Finalists appear on air with Jason Calacanis,
  Cedric the Entertainer, and Alex Elias, who will pick the winner.** All
  three finalists present to the judges, answer questions, and learn the
  result in real time. Finalists are notified shortly after the hackathon
  closes; **finalists must be available to appear and for preparation
  beforehand** — logistics follow with the notification.

## 5. Judges (home page, verbatim roles)

| Judge | Role |
|---|---|
| Jason Calacanis | American Entrepreneur & Angel Investor / Bestie |
| Mike Diolosa | CTO, Qloo |
| Nicole Seligman | Member / OpenAI Board of Directors |
| Todd Boehly | Co-founder, Chairman, & Chief Executive Officer / Eldridge Industries |
| Cedric the Entertainer | American Actor, Comedian, Producer, and TV Host |
| Michael Abrams | EVP Strategic Initiatives / Live Nation Entertainment |

## 6. Judging process and criteria (rules §6 + home)

- The Sponsor and Administrator hold sole discretion over eligibility and
  methodology; evaluation "may utilize expert panels, peer review, automated
  AI-driven analysis, or any combination"; judges may change; one or more
  rounds/panels possible.
- **Stage One — pass/fail:** does the idea meet a baseline of viability
  (fits the theme, reasonably applies the featured APIs/SDKs).
- **Stage Two — four equally weighted criteria** (verbatim):

  1. **Technological Implementation** — How thoroughly and skillfully does
     the project use Qloo? Does the code reflect genuine effort and a
     working, non-trivial implementation?
  2. **Design** — Does the project deliver a complete, coherent product
     experience, not just a technical proof of concept?
  3. **Potential Impact** — Does the project make a credible, specific case
     for solving a real problem for a real audience and does the solution
     actually address that problem based on what's demonstrated?
  4. **Quality of the Idea** — Is this a creative, non-obvious use of Qloo
     and does the team demonstrate genuine understanding of the problem
     space they're working in?

- **Tie-breaking:** compare scores on the first applicable criterion above,
  then the next; if still tied on all criteria, the judges' panel votes.

## 7. What to Build (home "Requirements" + rules §4 Project Requirements)

- A **working software application that integrates the Qloo API** and either
  (a) functions as an agentic tool, (b) is built using an agent framework,
  or (c) integrates Qloo into an existing agent.
- **Cultural intelligence must be the differentiator:** the agent should
  outperform generic LLM-only approaches because it has Qloo's API and
  taste graph (250M+ entities across music, film, dining, fashion and
  more). Verbatim bar: "If your submission would work the same without
  Qloo, you're building the wrong thing."
- We are explicitly NOT after demos of what LLMs can already do — the
  ask is the use case where cultural knowledge separates "technically
  functional" from "actually good."
- Functionality: installable and running consistently on its intended
  platform, functioning as depicted/described in the submission.
- New & existing projects both eligible; a pre-existing project must have
  gained its Qloo integration after the start of the submission period,
  and the entrant explains the significant update.
- Third-party SDK/API/data integrations require the proper authorization
  under their terms.
- Lateral examples the organizers give: room-by-room lighting choices from
  an electrician's agent; senior dining matched to taste AND health
  constraints; rare-disease journeys matching information + community +
  next steps.

## 8. What to Submit — five mandatory items (home, verbatim intent)

1. **A link to a functional demo application** — live, working, tryable
   end-to-end.
2. **A URL to a public code repository** (GitHub, GitLab or Bitbucket) with
   all source, assets and run instructions; public **and open source, with
   the license file detectable and visible in the About section** of the
   repository.
3. **A text description** of what the project does: key features and what
   makes it Qloo-powered.
4. **External hosting / fully published** — a live website or web app, or a
   hosted APK / TestFlight build. Local-only or private-access builds do
   not qualify.
5. **An open-source license file visible in About** (repeated as its own
   pillar on the home page).

- Explicit note: **demo videos are NOT required** — the organizers replaced
  the video ask with things judges can actually use.
- Draft submissions may be saved before the deadline; after the period
  closes the submission cannot be changed (only the project page in the
  portfolio), except narrow fixes permitted by Sponsor/Devpost for
  infringing or personally identifiable content, keeping the entry
  substantively the same (rules §5).

## 9. Eligibility (rules §3)

**Open to:** individuals at or above the age of majority where they reside;
teams of such individuals; organizations existing at time of entry. One
person may join multiple teams and also enter individually; a team must
appoint one authorized Representative for the submission.

**Closed to (summary):** residents/domiciles of sanctioned jurisdictions —
explicitly listed: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea
and any comprehensively OFAC-sanctioned country; Promotion Entities (the
Sponsor/Administrator and anyone involved in design, production, paid
promotion, execution or distribution) and their immediate family/household;
any Judge or a Judge's employer; affiliates of the above; anyone whose
participation would create a real or apparent conflict of interest.

## 10. How to enter (rules §4, paraphrased)

1. Click **Join Hackathon** on qloo.devpost.com (free Devpost account).
2. Obtain access to the required tooling/platforms — entry constitutes
   consent for Sponsor and Devpost to collect/maintain entrant information
   to run and publicize the hackathon.
3. **Get Qloo API access by filling the Google Form:**
   https://docs.google.com/forms/d/1G_udB8rJTlSwwCx9LF1vaftYI4Qf459ZXIKqLPElWc8/edit?ts=6ab52b48
4. Complete every required field on the **"Enter a Submission"** page
   during the submission period.

## 11. Resources (resources page, all links verified HTTP 200 at collection)

| Resource | URL |
|---|---|
| API key request (Google Form) | https://docs.google.com/forms/d/1G_udB8rJTlSwwCx9LF1vaftYI4Qf459ZXIKqLPElWc8/edit?ts=6ab52b48 |
| Official starter kit (repo) | https://github.com/qloo/qloo-hackathon-kit |
| Organizers' Discord | https://discord.gg/rF9PKsD5Q7 |
| Official guide (incl. key instructions) | https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key |

- Resource page text: "We've built a whole kit to get you started working
  with Qloo! … Use it like a regular repo: leave comments and raise issues
  if you have some ideas and feedback!"

## 12. Updates feed (/updates)

Exactly **one** update exists:

| # | Slug | Posted | Title |
|---|---|---|---|
| 47166 | `top-3-finalists-to-appear-live-for-final-judging` | about 11 hours before collection (2026-10-21/22) | TOP 3 FINALISTS TO APPEAR LIVE FOR FINAL JUDGING!!! |

Full substance reproduced in §4 above.

## 13. Site map (probe results, 2026-10-22)

**HTTP 200:** `/`, `/rules`, `/resources`, `/updates`, `/submissions`,
`/participants`, `/details/dates`,
`/updates/47166-top-3-finalists-to-appear-live-for-final-judging`

**HTTP 404:** `/judges`, `/faq`, `/prize`, `/prizes`, `/terms`,
`/submission`, `/reference`, `/score`, `/timeline`, `/about`,
`/discussions`, `/gallery`, `/entries`

(There is no standalone judges, prizes, FAQ, terms or discussions page —
judges/prizes/criteria live on the Overview; discussions tab is inactive.)

## 14. Gallery and roster status

- `/submissions` (the project gallery) returns verbatim: **"The hackathon
  managers haven't published this gallery yet, but hang tight!"** — no
  competitor entries are visible during the competition.
- `/participants` exposes the aggregate only (2,137); the roster is not
  enumerable anonymously.
- Consequence: no public competitive intelligence (entry counts, rival
  tech) exists before winners.

## 15. Official rules — index of all 15 sections

| # | Section | Substance |
|---|---|---|
| 1 | Dates and Timing | Submission / judging / winners windows (see §2) |
| 2 | Sponsor and Administrator | Qloo, 100 Crosby Street, New York, NY 10012 |
| 3 | Eligibility | Who is in / out (see §9) |
| 4 | How To Enter | Registration, tooling access, API form, submission form (see §10) |
| 5 | Submission Modifications | Drafts before close; narrow post-close fixes only |
| 6 | Judges & Criteria | Two stages, four equal criteria, tie-break (see §6) |
| 7 | Intellectual Property Rights | Entrants keep IP; Sponsor gets a non-exclusive judging license; Sponsor/Devpost may promote submissions and contributor likeness during the event and for three years after |
| 8 | Prizes | $15K/$6K/$4K, one prize per project, verification, taxes (see §3) |
| 9 | Entry Conditions and Release | Binding rules, no confidential/fiduciary relationship, indemnification |
| 10 | Publicity | Promotion rights as in §7 |
| 11 | General Conditions | Sponsor discretion, no substitution obligations beyond stated |
| 12 | Limitations of Liability | No indirect damages; caps on liability |
| 13 | Disputes | Governed by the substantive law of the State of New York, USA |
| 14 | Additional Terms | Devpost Terms of Service incorporated by reference (conflicts resolved in favor of these Official Rules for this event) |
| 15 | Entrant's Personal Information | Devpost Privacy Policy applies; contact via the hackathon manager email on the Rules page |

Also: submissions must not infringe third-party rights or contain malicious
code (rules §7 warranties); reCAPTCHA protects the site (Google Privacy
Policy and Terms of Service apply, home footer).

## 16. Complete outbound link inventory (all pages)

- Google Form (API keys): https://docs.google.com/forms/d/1G_udB8rJTlSwwCx9LF1vaftYI4Qf459ZXIKqLPElWc8/edit?ts=6ab52b48
- Starter kit: https://github.com/qloo/qloo-hackathon-kit
- Discord: https://discord.gg/rF9PKsD5Q7
- Official guide: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key
- Devpost ToS: https://info.devpost.com/terms (rules §14)
- Devpost privacy: https://info.devpost.com/privacy (rules §15)
- Submission manage (login): https://devpost.com/submit-to/31054-qloo-agentic-hackathon/manage/submissions
- Schedule page: https://qloo.devpost.com/details/dates
- Update permalink: https://qloo.devpost.com/updates/47166-top-3-finalists-to-appear-live-for-final-judging
- Event image (JSON-LD): https://d112y698adiu2z.cloudfront.net/photos/production/challenge_photos/005/363/781/datas/original.png

## 17. Relevance to SUTO OSNOVA

- **Deadline: Oct 30, 2026, 11:45 pm EDT — 8 days from collection.** After
  it closes, submissions are frozen.
- The five submission pillars map 1:1 onto our state — live demo
  (https://suto-osnova.netlify.app), public MIT repository with the license
  in About, text description, external hosting, source + instructions —
  evidence recorded per clause in [HACKATHON_COMPLIANCE.md](HACKATHON_COMPLIANCE.md).
- The judging criteria (§6) are the rubric to optimize against:
  non-trivial Qloo usage (the transport/inspector/provenance surfaces),
  coherent product experience (three agent modes, three formats),
  credible impact case, non-obvious use of Qloo.
- Finalist availability (§4): appearing on air November 5 is a
  prerequisite for the top 3 — plan for it if selected.

## 18. Fetch log

| URL | HTTP | Bytes |
|---|---|---|
| https://qloo.devpost.com/ | 200 | 144,143 |
| https://qloo.devpost.com/rules | 200 | 162,132 |
| https://qloo.devpost.com/resources | 200 | 119,562 |
| https://qloo.devpost.com/updates | 200 | 120,064 |
| https://qloo.devpost.com/submissions | 200 | 119,161 |
| https://qloo.devpost.com/participants | 200 | 119,270 |
| https://qloo.devpost.com/details/dates | 200 | 120,107 |
| https://qloo.devpost.com/updates/47166-top-3-finalists-to-appear-live-for-final-judging | 200 | 120,165 |
| 13 listed paths in §13 | 404 | — |
| 4 external links in §11 | 200 (follow redirects) | — |

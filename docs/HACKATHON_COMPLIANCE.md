# Hackathon Rules §4 — Mandatory Public Hosting: Compliance Record

**Requirement source:** Qloo Agentic Hackathon Official Rules, section **4. How To Enter**
(<https://qloo.devpost.com/rules>, retrieved 2026-10-21).
**Subject:** SUTO OSNOVA — `https://suto-osnova.netlify.app` + `https://github.com/koztechie/suto-osnova`
**Recorded:** 2026-10-21 (release tag `v1.0.0-hackathon`, head `f5ed16f` or later).
**Status: COMPLIANT** — every public-access clause of §4 is satisfied and freshly verified.

## The clauses (verbatim from §4)

1. **[124] Demo link** — "Provide a link to a functional demo application".
2. **[125] Public repository + visible license** — "Provide a URL to your public code repository for
   judging and testing on either GitHub, GitLab or Bitbucket. The repository must contain all
   necessary source code, assets, and instructions required for the project to be functional. The
   repository must be public and open source by including an open source license file. This license
   should be detectable and visible at the top of the repository page (in the About section)."
3. **[132] Unrestricted testing access** — "Access must be provided to an Entrant's working Project
   for judging and testing by providing a link to a website, functioning demo, or a test build. If
   Entrant's website is private, Entrant must include login credentials in its testing instructions.
   The Entrant must make the Project available free of charge and without any restriction, for
   testing, evaluation and use by the Sponsor, Administrator and Judges until the Judging Period
   ends."

## Compliance evidence (measured 2026-10-21, all access ANONYMOUS — no credentials)

| §4 clause | Requirement | Evidence | Status |
|---|---|---|---|
| [124] | Link to a functional demo application | `https://suto-osnova.netlify.app` — `GET /` → **HTTP 200**, no redirect, 0.52 s; the app's full stability probe (`node tests/hosting-stability.js`) → **STABLE 13/13, exit 0** (TLS DigiCert 149 d; static CDN 12/12 p95 157 ms; API health 6/6 p95 297 ms `qloo=ok`; security headers + immutable assets; `/api/categories` 200/5; the three public demo presets: two live dossiers `ranked>0`, one typed handled content outcome, 0 crashes) | MET |
| [132] | Access free of charge and WITHOUT ANY restriction | Anonymous `GET /` → 200 with the application HTML (no 401/403, no login redirect — `redirect_url` empty); anonymous `GET /api/health` → 200; `HEAD /` → 200. No password, no account, no paywall anywhere in the flow | MET |
| [125] | Public repo, complete source, instructions | `github.com/koztechie/suto-osnova` — anonymous `api.github.com` → `private: false`, `visibility: public`, **307 tracked files** (source, tests, docs, build config, `PLAN_STATE.md` journal); `README`/`AGENTS.md`/`docs/` carry the setup and run instructions; repo hygiene gate CLEAN | MET |
| [125] | Open-source license, detectable & visible in About | Anonymous `api.github.com` → `license: "MIT License" (spdx MIT)`; GraphQL `repository.licenseInfo {name:"MIT License", key:"mit"}` (the exact object the About column renders); the rendered page carries `"license":{"spdxId":"MIT","name":"MIT License"}` and the About anchor `/blob/main/LICENSE` (see task 198 record) | MET |

## Reproduce the verification

```bash
# 1. public demo, stability of the hosted app (exit 0 = STABLE)
node tests/hosting-stability.js
# 2. anonymous access — must be 200 with NO redirect (no auth wall)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://suto-osnova.netlify.app/
curl -s -o /dev/null -w '%{http_code}\n' https://suto-osnova.netlify.app/api/health
# 3. public repository + license detection (no token required)
curl -s https://api.github.com/repos/koztechie/suto-osnova \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['private'], d['visibility'], d['license']['name'])"
```

## Notes

- The demo is hosted on Netlify's free tier; the deployed state matches release tag
  `v1.0.0-hackathon` (tasks 193/195). The GitHub repository was switched to PUBLIC in task 197
  after a full secret scan of HEAD and history (zero keys/tokens found); `.env` is and always was
  untracked.
- Submission materials must be in English (§4 Language Requirements) — this record and the
  repository documentation are in English.

## Re-audit (measured 2026-10-22 — T-8 days before the deadline)

Five pillars re-verified live the day the submission material was frozen into
[SUBMISSION_DRAFT.md](SUBMISSION_DRAFT.md):

| Pillar | Live result (2026-10-22) | Status |
|---|---|---|
| Functional demo | anonymous `GET /` → 200; `GET /api/health` → 200 | MET |
| Public repository | `gh api repos/koztechie/suto-osnova` → `private=false`, license `MIT`, About name `MIT License` | MET |
| Instructions to run | `README.md` (22 KB) + `docs/` + `AGENTS.md` present | MET |
| External hosting, fully published | Netlify production — no local-only step exists in the flow | MET |
| License visible in About | `LICENSE` at root; GitHub About renders `MIT License` | MET |
| Access free, no restriction | anonymous 200 with no redirect; tracker gate `VERIFY: PASS`; repo hygiene `CLEAN` | MET |

Post-close rule (§5): the submission itself is frozen at 2026-10-30 23:45 EDT — paste the
draft before then.

## Warranty compliance (rules §7 — measured 2026-10-22)

Beyond the five §4 pillars, the rules make every entrant WARRANT two things. Both
verified with evidence:

| Warranty | Evidence | Status |
|---|---|---|
| No third-party rights infringed | All shipped media is ORIGINAL and self-generated: `client/public/{favicon.svg,favicon.ico,social-card.png}` come from `scripts/monogramIcon.mjs` (the SVG carries the generator comment); the tracked-media allowlist gate (`scripts/verifyRepoHygiene.mjs`) permits nothing else; zero external `url(http…)` in the built CSS (no third-party fonts or images); cultural names/titles appear only as factual taste-anchor data; the organizers' own wording is quoted only inside the submission draft, attributed to their sections | MET |
| No malicious code | `eval(` / `new Function(` count = 0 in the client source AND in the shipped bundle (now a permanent assertion in `tests/clientBuild.test.js`); exactly one `<script>` in the built HTML, same-origin module; zero external origins baked into the bundle (existing gate); tracker gate `VERIFY: PASS`; CSP `script-src 'self'` with no `unsafe-eval` | MET |

Note: the reCAPTCHA protecting the Devpost form is Google's (their Privacy Policy and
Terms apply to that form); this deployment loads no Google scripts (tracker gate
covers it).

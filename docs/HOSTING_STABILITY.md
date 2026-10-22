# Public Hosting Stability Record — task 193

**Host:** `https://suto-osnova.netlify.app` (Netlify production, site `52afdc2b-b727-46f4-ac8a-6d87e83cc218`)
**Recorded:** 2026-10-21T15:25:45Z — probe exit code 0, **13/13 checks passed**
**Tool:** `node tests/hosting-stability.js [base-url]` (standalone, network-bound; deliberately outside the deterministic `npm test` suite)

## What "full stability" means here

A stable public host must satisfy ALL of:

1. **TLS** — certificate authorized, expiring in >= 7 days.
2. **Static CDN** — `GET /` answers 200 in 12/12 samples with p95 <= 2500 ms.
3. **API** — `GET /api/health` answers 200 in 6/6 samples (paced 3 s apart under the
   30 req/60 s inbound rate limit, so the probe never manufactures 429s), p95 <= 4000 ms,
   payload `status=ok`, `qloo=ok`.
4. **Headers/caching** — the five security headers served by the CDN (CSP, nosniff, DENY,
   referrer, permissions) and `/assets/*` served `public, max-age=31536000, immutable`.
5. **Public demo presets** — the three one-tap flows from `client/index.html`
   (`David Lynch Noir`/worldbuilder, `Post-Punk Berlin`/worldbuilder,
   `Ambient Festival`/experiential): **never a 5xx or opaque answer.** Each must yield
   either a full dossier (200, `suto-osnova.dossier/v1`, ranked > 0) or a **typed structured
   error envelope** (a handled content outcome such as `no_usable_signal`), with >= 2 of 3
   shipping a live dossier.

## Measured result (production, this record's timestamp)

| Check | Result |
|---|---|
| TLS | DigiCert Inc, valid to 2027-03-19 (149 d left) |
| Cold start | `/api/health` 200 in 567 ms after idle spin-down |
| Static CDN | 12/12 x 200 — min 33 / avg 48 / p95 **157 ms** / max 157 ms |
| API health | 6/6 x 200 — min 200 / avg 260 / p95 **297 ms** / max 297 ms, `qloo=ok` |
| Security headers | 3 exact + 2 present (CSP / nosniff / DENY / referrer / permissions) |
| Asset caching | `/assets/favicon-C1FPjF7Y.svg` 200, `public,max-age=31536000,immutable` |
| `/api/categories` | 200 in 504 ms, 5 categories |
| Preset `David Lynch Noir` | dossier **200 in 11.6 s**, ranked=4, domains **5/5** |
| Preset `Post-Punk Berlin` | dossier **200 in 19.1 s**, ranked=10, domains **5/5** |
| Preset `Ambient Festival` | typed **400 `no_usable_signal`** in 581 ms (handled content outcome, 0 crashes) |
| Aggregate | 2/3 live dossiers, **0 crashes** — criterion met |

**RESULT: STABLE — 13/13.**

## Defects found by this probe and fixed (same task)

The first probe run returned **UNSTABLE (9/11): `POST /api/generate/*` -> 500 `INTERNAL`**
on the deployed host. Root causes, in the order they were isolated:

1. **Agent-vocabulary domains were never mapped in the production wiring.**
   `fetchAffinityVector`'s fetchFn contract passes the raw agent domain
   (`books`/`dining`/`fashion`); `defaultFetch` maps it via `primaryInsightType`, but
   `generate.js realClients()` injected the RAW `getCrossDomainAffinities`, whose alias
   table only knows `TARGET_DOMAINS` keys or raw URNs — those three domains failed local
   validation (`INVALID_TARGET_DOMAIN`) on every real generate.
   **Fix:** `domainMapper.toInsightsDomain()` (URN pass-through, agent vocab maps, unknown
   falls through to the client's own guidance) wraps the real client once, covering the
   vector and every extractor. Tests: `toInsightsDomain` unit block + the generateRoute
   "real-client wiring" regression (red without the fix).
2. **Certain entity RECORDS are rejected by Qloo as taste signals** (upstream 400
   `"All of the provided signal.interests.entities were invalid"`, even against their own
   domain). A book/videogame seed whose chosen record was rejected failed all five domains
   at once -> `all_domains_failed` -> 500.
   **Fix:** optional `signalProbe` in `seedEntityResolver` (wired to `options.affinityFn`
   by all three modes): the chosen record is probed (1 call, `take:1`); on an upstream 400
   the resolver walks its ranked alternatives (bounded by `MAX_SIGNAL_PROBES`, and only
   alternatives scoring >= `SWAP_SCORE_FLOOR` (0.9x) of the winner — a swap rescues another
   edition of the same work, never jumps topic: a "festival" anchor cannot swap to a mall
   food court). Nothing usable -> typed **400 `no_usable_signal`** (honest content answer,
   never a 500). Transport/5xx probe failures never demote. Live proof: seed
   "The Dunwich Horror" now swaps from a rejected record to a usable same-work record and
   returns a dossier (was 500).
3. **The funnel could empty the dossier.** 8 candidates -> long-tail kept 1 (a NORMAL pass,
   so unflagged) -> the cliché valve (`alwaysCutAtLeastOne`) cut the last survivor ->
   ranked=0. The two filters each behaved per spec but compounded to an empty section,
   violating the documented invariant ("an empty dossier section is worse than a few
   honestly flagged survivors").
   **Fix:** `cutMassCliches` never empties a non-empty section (keeps the least-banal of
   the cut, fires only when the cut would empty). Live proof: "A24 Psychological Horror"
   now returns ranked=1 (was 0).

Suite after the fixes: **1194/1194 x2**, lint clean; every fix is red-checked (the
generateRoute regression fails when the mapping wrap is reverted).

## Known non-instability follow-up (quality loop, not hosting)

`Ambient Festival` resolves to `Selected Ambient Works 85-92` (an album Qloo refuses as a
signal). Its search page (`query=Ambient Festival`, take=10) contains **9 `urn:entity:place`
results (malls/festival venues) and 1 album — no mapped, signal-usable music anchor**, and
all score below the swap floor. The probe records this as a **typed, handled 400**, which
meets the stability bar; making the preset produce a dossier requires better candidate
generation for festival-style seeds (search type-scoping / domain hinting) — a
relevance-loop task, deliberately not papered over with a junk anchor swap.

## Re-running

```bash
node tests/hosting-stability.js                        # production (default)
node tests/hosting-stability.js <base-url>             # any deployment
echo $?                                                 # 0 = STABLE, 1 = UNSTABLE
```

Pacing constants: `STATIC_SAMPLES`, `API_SAMPLES`, `API_SPACING_MS` (keeps the probe under
`INBOUND_RATE_LIMIT=30` per `INBOUND_RATE_WINDOW_MS=60000`), `PRESET_MIN_DOSSIERS`,
latency bounds `STATIC_P95_MS`/`API_P95_MS`, budget `GENERATE_MAX_MS=26000` (the pinned
Netlify function timeout), `TLS_MIN_DAYS=7`.

## Permanent uptime sentinel (rules section 4, "running consistently")

`.github/workflows/uptime.yml` — a keyless cron (every 4 hours, plus
`workflow_dispatch` on demand) proving the public surface exactly as the judges see
it: the homepage must serve the app shell with the inlined stylesheet, and
`/api/health` must answer 200 with `"status":"ok"` (backend up AND Qloo reachable —
a degraded gateway answers 503 and trips the sentinel). A failed run emails the
repository owner automatically (GitHub default). No secrets in CI by design: the
deployed function carries the Qloo key; the sentinel checks only the outside. It
blankets the judging window (November 2-5) without any manual action.

**Removed by design (ToS compliance):** the workflow previously contained a second
job auto-fetching the ORGANIZERS' updates feed on qloo.devpost.com. After reading the
Devpost Terms of Service (info.devpost.com/terms — "Uses manual or automated software,
devices, scripts robots, or other means or processes to access, 'scrape,' 'crawl'..."
is prohibited), that job was deleted: third-party automated access is out of bounds
even at 6 requests/day. The official, ToS-clean update channel for a participant is
Devpost's own email notification (enabled by joining the hackathon) plus a manual
look at /updates — instructions in docs/SUBMISSION_GUIDE_UA.md. The sentinel's own
deployment checks (fully ours) remain.

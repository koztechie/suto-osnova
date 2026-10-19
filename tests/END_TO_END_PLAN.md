# END-TO-END TEST PLAN — SUTO OSNOVA
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Scope owner:** Lead Systems Architect
**Status:** ACTIVE — the executable contract for system-level verification
**Companion gate:** `tests/e2ePlan.test.js` (pins every reference in this document against the live tree — the plan cannot rot)

---

## 0. PURPOSE & SCOPE

End-to-end testing proves the WHOLE stack works as one system: a real browser runs the vanilla
client, the client talks only to the local Node gateway, the gateway orchestrates the engine and
the Qloo transport, and a judge reads a grounded cultural dossier. Unit and component gates pin
the parts; this plan pins the journeys.

IN SCOPE (12 journeys, E2E-01..E2E-12): boot, connectivity states, all three generation modes,
combobox hints, export triptych, clipboard, the Raw API Call Inspector, keyboard-only operation,
responsiveness + reduced motion, honesty and resilience (zero external origins, error surfaces).

OUT OF SCOPE: Qloo's own API correctness (asserted as SHAPE/PROVENANCE, never exact values — the
live graph changes); LLM synthesis quality (reports `not_configured` without `LLM_API_KEY` by
design); visual pixel diffing (no screenshot baseline tooling in the zero-dependency tree).

## 1. SYSTEM UNDER TEST & TOPOLOGY

```
[ Browser: client/index.html + client/src/* ]
        |  fetch() — SAME ORIGIN ONLY, never a third-party host
[ Preview server: scripts/serveClient.mjs  (CLIENT_PORT, default 5173) ]
        |  /api/* proxy
[ Node gateway: server/src/app.js  (API_PORT or PORT, e.g. 8787) ]
        |  engine (modes worldbuilder|experiential|antithesis) + formatters
[ Qloo transport: MOCK (fixtures) or LIVE (QLOO_API_KEY) ]
```

Two runtime profiles:

| Profile | How | Determinism | Use |
|---|---|---|---|
| MOCK | `MOCK_MODE=true` — `server/src/mocks/qlooFixtures.js` answers the gateway | Fully deterministic shapes; thin pools intentionally empty some domains | Default for ALL journeys; CI-safe |
| LIVE | real `QLOO_API_KEY` in `.env`; MOCK off | Non-deterministic values; shapes stable | Pre-demo smoke only; assertions reduced to shape + provenance |

FIXTURE ANCHORS (stable seeds the mock gateway understands): `David Lynch Noir`, `Post-Punk Berlin`,
`Ambient Festival` — the exact three demo presets in `client/index.html`.

## 2. ENVIRONMENT MATRIX

| Dimension | Values | Automation |
|---|---|---|
| Engine | Chromium (harness browser) | FULL — this plan's snippets |
| Engine | Firefox, WebKit/Safari | MANUAL protocol, section 9 (not launchable in the harness) |
| Viewport | 1080x2400 (portrait phone) | MANUAL + CSS gates |
| Viewport | 1920x1080, 1920x1200 (desktop) | MANUAL + CSS gates |
| Motion | `prefers-reduced-motion: reduce` | CSS gate + MANUAL toggle |
| Network | healthy MOCK | FULL |
| Network | API dead (gateway down) | FULL — E2E-12 |
| Rate limit | `INBOUND_RATE_LIMIT=1` burst | FULL — E2E-12 |

## 3. JOURNEY CATALOGUE

Every journey states Preconditions / Steps / Expected / Automation. "Expected" assertions are
literal — a judge or a script checks them without interpretation.

### E2E-01 — Cold boot & shell render
Preconditions: MOCK gateway up; preview server up.
Steps: open a FRESH tab on `/` (append a unique query param per run); wait for load; read
`document.title`; assert landmarks `header`, `nav`, `main`, `footer` exist.
Expected: title contains `SUTO OSNOVA`; the mode tab bar renders three radios
(`input[name="mode"][value="worldbuilder"|"experiential"|"antithesis"]`); `#seed` is empty and
focusable; `#status` is a `role="status"` live region; the generate button is `type="submit"`
inside `#generate-form`; ZERO console errors; zero requests to non-local origins; FCP entry
present (`performance.getEntriesByName('first-contentful-paint')`).
Automation: harness snippet 4.1; byte-budget proxy gate `tests/fcpBudget.test.js`.

### E2E-02 — Qloo connectivity indicator states
Preconditions: boot complete.
Steps: (a) with MOCK gateway healthy, read `#connectivity-label`; (b) stop the gateway, press
Generate; (c) restart the gateway.
Expected: (a) state `online` (the indicator reads the real `/api/health` `{status, qloo, transport}`);
(b) the indicator degrades to `degraded` (or `offline`) honesty — status line `#status` shows a
`CODE: message` error, never a silent hang, and NO retry storm (bounded single-flight);
(c) the next health poll restores `online` without a page reload.
Automation: harness snippet 4.2; health contract `server/test/healthEndpoint.test.js`.

### E2E-03 — Worldbuilder generation (preset path)
Preconditions: boot; MOCK profile.
Steps: click the `David Lynch Noir` preset (`[data-seed="David Lynch Noir"][data-mode="worldbuilder"]`);
assert `#seed` now equals that seed and the worldbuilder radio is checked; press Generate; wait for
the dossier.
Expected: `#status` progresses (busy tone) then settles `ok`; the progress readout `#progress`
steps and finishes; `#output-text` holds a non-empty dossier; affinity meters render for
`ranked[]` entries reading `connection.percent`; `#domains` shows the domain plate grid
(`#domain-grid`); five featured cards (`#sonic-card`, `#literary-card`, `#material-card`,
`#gastronomy-card`, `#visual-card`) appear when the registry confirms those domains; provenance
rows come from `dossier.meta` (the inspector's envelope section mirrors it).
Automation: harness snippet 4.3; structural gates `tests/demoPresets.test.js`,
`tests/affinityWidget.test.js`, `tests/domainCards.test.js`; route contract
`server/test/generateRoute.test.js`.

### E2E-04 — Experiential generation (activation mode)
Preconditions: boot; MOCK profile.
Steps: click the `Ambient Festival` preset (`[data-mode="experiential"]`); Generate; inspect output.
Expected: `resolveMode('experiential')` parity — the dossier is the ACTIVATION flavor (scene
context and opening acts present in the rendered text); status `ok`; zero console errors.
Automation: harness; parity gate `server/test/modeDispatcher.test.js`,
`server/test/experientialMode.test.js`.

### E2E-05 — Antithesis generation & the Cultural Antipode block
Preconditions: boot; MOCK profile.
Steps: type a free anchor into `#seed` (e.g. `Kyiv underground jazz cafés`); select the antithesis
radio; Generate.
Expected: the antithesis output block renders `#antithesis`; the Cultural Antipode panel lists
matrix entries with verbatim `divergencePercent` values from `dossier.data.antithesis.matrix[]`;
oxide accent styling present; EMPTY matrix leaves the zone visible with an honest empty state
(never a fabricated antithesis).
Automation: harness; gates `tests/antithesisBlock.test.js`, `server/test/antithesisMode.test.js`,
`server/test/mcpTasteAntithesis.test.js`.

### E2E-06 — Anchor combobox hints
Preconditions: boot; MOCK profile.
Steps: focus `#seed`, type two characters; read `#anchor-suggestions`; arrow-down + Enter a hint.
Expected: the listbox opens with category hints sourced from `/api/categories`; selection fills
`#seed`; ARIA combobox contract holds (expanded/activedescendant); with the gateway dead the list
degrades HIDDEN (no broken dropdown).
Automation: harness; gate `tests/anchorInput.test.js`; `server/test/categoriesRoute.test.js`.

### E2E-07 — Export triptych (Markdown / JSON / Print HTML)
Preconditions: a dossier from E2E-03 is on screen.
Steps: (a) press `#action-markdown`; (b) press `#action-json`; (c) press `#action-print` and read
`#print-frame`.
Expected: (a) a download fires with filename from the `dossierFilename` contract
(`suto-osnova-<mode>-dossier.md` family) and non-empty Markdown body; (b) the JSON download parses and
carries the envelope (`data` + `meta`); (c) `#print-frame` is a sandboxed iframe
(`sandbox="allow-modals"` WITHOUT allow-scripts) whose srcdoc holds print-ready HTML; the status
line reports each export `ok`; a failed export surfaces `CODE: message`, never a silent no-op.
Automation: harness; gates `tests/actionsPanel.test.js`, `server/test/markdownExporter.test.js`,
`server/test/jsonExporter.test.js`, `server/test/htmlPrintFormatter.test.js`.

### E2E-08 — Clipboard copy with instant feedback
Preconditions: dossier on screen.
Steps: press `#copy-document`; press a quote-level copy control (`[data-copy]`).
Expected: label flips to the copied state instantly then reverts; clipboard receives the exact
dossier text; a clipboard-denied environment reports an honest error tone (no false "Copied").
Automation: harness; gate `tests/clipboard.test.js`.

### E2E-09 — Raw API Call Inspector
Preconditions: at least one generation performed.
Steps: press `#open-inspector`; read rows; press Escape; reopen; press `#inspector-close`;
press the backdrop `#inspector-backdrop`.
Expected: `#inspector-calls` lists the REAL call log (one row per transport call recorded at the
api.js edge); `#inspector-qloo` shows the last health `qloo`/`transport`; `#inspector-provenance`
mirrors `dossier.meta`; all values rendered via textContent (no HTML injection surface); Escape
and backdrop both close; focus RETURNS to `#open-inspector`.
Automation: harness; gates `tests/inspector.test.js`, `server/test/provenanceTable.test.js`.

### E2E-10 — Keyboard-only operation
Preconditions: boot; no pointing device.
Steps: Tab from the top: skip-link → `#seed` → mode radios (arrow keys move within the group) →
format select → Generate; press `Ctrl+Enter` (and `Cmd+Enter` on macOS) to submit from `#seed`;
restore focus to `#open-inspector` and operate it with Enter/Escape only.
Expected: every stop shows the gold focus frame; radio arrows follow the native tab-group contract;
Ctrl/Cmd+Enter submits; `aria-keyshortcuts` matches behavior; no focus trap outside the open modal.
Automation: harness; gates `tests/keyboard.test.js`, `tests/modeSwitcher.test.js`.

### E2E-11 — Responsiveness & reduced motion
Preconditions: boot.
Steps: (a) set 1080x2400 and resize to 390x844 logical; (b) set 1920x1080 and 1920x1200; (c) enable
OS-level reduced motion and press Generate.
Expected: (a) single-column workspace at narrow width, no horizontal overflow
(`document.documentElement.scrollWidth <= clientWidth`); (b) the two-column workspace
(`minmax(320px,420px) minmax(0,1fr)`) with the desktop cap and safe-area insets respected; (c) the
progress bar renders ONE static frame and the spinner does not animate; generation still completes.
Automation: CSS gates `tests/responsiveLayout.test.js`, `tests/workspaceLayout.test.js`,
`tests/reducedMotion.test.js`, `tests/systemTokens.test.js` (safe-area coverage); sizes MANUAL.

### E2E-12 — Honesty & resilience (negative paths)
Preconditions: MOCK profile; then degrade deliberately.
Steps: (a) audit `performance.getEntriesByType('resource')` after a full run; (b) restart the
gateway with `INBOUND_RATE_LIMIT=1` and fire two rapid generations; (c) stop the gateway mid-flight.
Expected: (a) EVERY resource origin is the local preview host — zero third-party, zero webfonts,
zero trackers; (b) the second call surfaces the rate-limit error tone with its code (429 surface),
the UI stays usable; (c) an in-flight failure resolves to an error status within the client timeout
— no indefinite spinner, no unhandled rejection in the console.
Automation: harness snippet 4.4; gates `server/test/noTrackers.test.js`,
`server/test/rateLimitRoute.test.js`, `server/test/httpErrors.test.js`, `tests/browserCompat.test.js`.

## 4. HARNESS AUTOMATION PROTOCOL (executable snippets)

All snippets run inside the agent harness `execute` tool against `tools.browser.*`. Servers:

```
MOCK_MODE=true PORT=8787 INBOUND_RATE_LIMIT=500 node --env-file=.env server/src/index.js
CLIENT_PORT=5173 API_PORT=8787 node scripts/serveClient.mjs
```

4.1 BOOT (E2E-01) — open a fresh tab (unique query param defeats cache), then evaluate:

```
(() => ({
  title: document.title,
  landmarks: ['header','nav','main','footer'].map((t) => !!document.querySelector(t)),
  radios: document.querySelectorAll('input[name="mode"]').length,
  fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  external: performance.getEntriesByType('resource')
      .filter((r) => !r.name.includes(location.host)).map((r) => r.name),
}))()
```

4.2 CONNECTIVITY (E2E-02) — after stopping the gateway, evaluate `#connectivity` state and the
`#status` text; assert both report the failure honestly; restart and re-evaluate.

4.3 GENERATION (E2E-03) — click the preset element, then the submit button, then poll until
`#output-text` is non-empty (poll with a bounded loop of `evaluate` calls; NEVER a bare sleep):

```
document.querySelector('[data-seed="David Lynch Noir"]').click();
document.querySelector('#generate-form button[type="submit"]').click();
```

then a bounded poll reading `document.querySelector('#output-text').textContent.length`.

4.4 HONESTY AUDIT (E2E-12) — the `external` array from 4.1 must be empty after ANY journey; the
Inspector (`#inspector-calls` rows) must equal the number of recorded transport calls.

## 5. TRACEABILITY MATRIX

| Journey | Automated gate(s) already in suite | Residual MANUAL risk |
|---|---|---|
| E2E-01 | tests/clientStructure.test.js, tests/fcpBudget.test.js, tests/semanticMarkup.test.js | none in Chromium |
| E2E-02 | server/test/healthEndpoint.test.js, tests/titlebar.test.js (indicator states) | live state transitions |
| E2E-03 | tests/demoPresets.test.js, tests/affinityWidget.test.js, tests/domainCards.test.js, server/test/generateRoute.test.js | end-to-end timing feel |
| E2E-04 | server/test/modeDispatcher.test.js, server/test/experientialMode.test.js | none |
| E2E-05 | tests/antithesisBlock.test.js, server/test/antithesisMode.test.js | none |
| E2E-06 | tests/anchorInput.test.js, server/test/categoriesRoute.test.js | keyboard listbox feel |
| E2E-07 | tests/actionsPanel.test.js, server/test/{markdownExporter,jsonExporter,htmlPrintFormatter}.test.js | browser download UX |
| E2E-08 | tests/clipboard.test.js | OS clipboard prompt |
| E2E-09 | tests/inspector.test.js, server/test/provenanceTable.test.js | none |
| E2E-10 | tests/keyboard.test.js, tests/modeSwitcher.test.js | macOS Cmd modifier |
| E2E-11 | tests/responsiveLayout.test.js, tests/reducedMotion.test.js, tests/workspaceLayout.test.js | real device sizes |
| E2E-12 | server/test/noTrackers.test.js, server/test/rateLimitRoute.test.js, server/test/httpErrors.test.js | live Qloo outage |

## 6. FLAKE-CONTROL RULES (non-negotiable)

1. NO bare `sleep` waits — every wait is a bounded POLL on a state marker (`#status` tone,
   `#output-text` length, `#connectivity` state), max 30 iterations.
2. Every browser run opens a FRESH tab with a unique query param; the previous tab is discarded.
3. MOCK profile is the default for every journey; LIVE runs never gate merges.
4. Port hygiene: preview 5173, gateway 8787 by convention; tests use ephemeral ports and kill
   their children in `finally`.
5. One journey failure does not cascade: E2E-04..E2E-09 each re-establish their own dossier.
6. All servers are stopped after a session (`pkill -f "[s]erveClient.mjs"` — bracket the pattern
   so the shell cannot match its own command line).

## 7. ENTRY / EXIT CRITERIA

ENTRY: `npm test` fully green (the structural floors under every journey); `npm run lint` clean;
MOCK gateway boots; preview server boots.

EXIT (all must hold, in Chromium, MOCK profile): 12/12 journeys pass; ZERO console errors across
the whole session; ZERO non-local resource origins; every export produces a non-empty artifact;
Inspector rows match the recorded call count; keyboard-only path completes E2E-03 end to end.
RESIDUAL: the MANUAL matrix of section 2 (Firefox/WebKit/real viewports) is executed once per demo
and signed off in `PLAN_STATE.md` with evidence lines.

## 8. ARTIFACTS & EVIDENCE

Per session: journey pass/fail table (this document's section 3 numbering), the Inspector call-log
count, the external-origin audit result, and Lighthouse numbers (Accessibility/Best-Practices/SEO —
baseline 1.0/1.0/1.0 from the task 157 run). Evidence is appended to the ROOT `PLAN_STATE.md`
(never `docs/PLAN_STATE.md`).

## 9. MANUAL PROTOCOL — engines & devices the harness cannot launch

Anti-fragile steps, valid for any machine, any year:

1. Start the two servers with the section 4 commands.
2. Open `http://localhost:5173/` in Firefox (current ESR or stable) and in Safari (macOS).
3. Run E2E-01..E2E-12 Steps verbatim; the "Expected" lists are literal checklists — tick each line.
4. DevTools console, paste once per session:
   `performance.getEntriesByType('resource').filter((r) => !r.name.includes(location.host)).length`
   — must print `0` after a full run.
5. Responsive: DevTools device toolbar -> iPhone/Android preset (>=1080x2400 class), then a
   1920x1080 window; tick E2E-11 expectations.
6. Reduced motion: OS accessibility setting, reload, Generate — the progress bar must paint one
   static frame.
7. Record results (engine, version, date, pass/fail per journey, anomalies) in the root
   `PLAN_STATE.md`.

## 10. FUTURE AUTOMATION TRACK (optional, zero-install today)

The tree ships ZERO dependencies by policy; the harness protocol above is the current automation.
When a CI budget allows a runner, Playwright is the recommended single addition — the plan's
journeys map 1:1 onto specs. Ready-to-add skeleton (do not install without an explicit decision):

```
// e2e/worldbuilder.spec.js  (future)
const { test, expect } = require('@playwright/test');
test('E2E-03 preset -> dossier', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  await page.click('[data-seed="David Lynch Noir"]');
  await page.click('#generate-form button[type="submit"]');
  await expect(page.locator('#status')).toContainText('ok', { timeout: 30000 });
  expect(await page.locator('#output-text').textContent()).toBeTruthy();
  const external = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .filter((r) => !r.name.includes(location.host)).length);
  expect(external).toBe(0);
});
```

Until then, section 4 + section 9 ARE the executable E2E suite.

---
*This document is a living contract: `tests/e2ePlan.test.js` validates every id, route, script,
test file and preset seed it references against the real tree. A rename anywhere breaks the gate,
not a demo.*

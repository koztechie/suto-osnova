# LOCAL RUNBOOK — installation, environment, launch

Step-by-step instructions for running SUTO OSNOVA locally. Every command below was executed on
this checkout (Node v22) and every error message quoted is the real one the code emits.

## 0. What a local run gives you

- an **API gateway** (the same handler the Netlify serverless adapter wraps), and
- a **client preview** that reproduces the production topology exactly (static host + `/api`
  proxy in one process), on `http://localhost:5173`;
- an **offline mode** over recorded Qloo fixtures (`MOCK_MODE=true`) — no key, zero quota;
- the **full test suite** (1201 tests) — offline, no credentials required.

## 1. Prerequisites

| Tool | Version | Check | Install if missing |
|---|---|---|---|
| Node.js | 22 or newer | `node --version` | `nvm install 22 && nvm use 22`, or <https://nodejs.org> |
| npm | bundled with Node | `npm --version` | ships with Node |
| git | any recent | `git --version` | <https://git-scm.com> |
| Qloo API key | hackathon key | — | request via the [Qloo key request guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key) — only needed for LIVE mode |
| LLM key (optional) | any OpenAI-compatible endpoint | — | only for the narrative synthesis; offline mode works without it |

## 2. Installation

```bash
git clone https://github.com/koztechie/suto-osnova.git
cd suto-osnova
npm ci            # exact lockfile install — use npm ci, not npm install
npm run lint      # sanity gate: exits 0 and prints nothing when the sources parse
```

## 3. Environment configuration

```bash
cp .env.example .env
```

Then edit `.env`:

1. **First run — stay offline (recommended):** set
   `MOCK_MODE=true`. The gateway serves hand-recorded fixtures from
   `server/src/mocks/qlooFixtures.js`; no key is consulted, no quota is burned.
2. **Live mode — one required variable:** put your key into `QLOO_API_KEY=...`.
   The configuration layer validates at boot and refuses to start without it — the exact
   failure is `{"field":"QLOO_API_KEY","message":"QLOO_API_KEY is required"}`.
3. **Optional narrative:** append `LLM_API_KEY=...` (plus `LLM_BASE_URL` / `LLM_MODEL` /
   `LLM_MAX_TOKENS` / `LLM_TIMEOUT_MS` / `LLM_REASONING` if you need overrides). Without the
   key the dossier still ships — the synthesis step reports `not_configured` honestly.
4. **Everything else has safe documented defaults** in `.env.example` (outbound limit 5 req/s,
   disk cache on, `PORT=3000`, `LOG_LEVEL=info`); the full validated schema with every variable
   is `server/src/config/envSchema.js`.

`.env` is gitignored — the repository hygiene and secrets gates guarantee it can never be
committed.

## 4. Launch (two terminals)

**Terminal 1 — the API gateway:**

```bash
MOCK_MODE=true PORT=8787 npm start        # offline first run
# or, with QLOO_API_KEY set and MOCK_MODE removed:
PORT=8787 npm start                       # live Qloo traffic
```

Verify it before continuing:

```bash
curl -s http://127.0.0.1:8787/api/health
# expect: {"status":"ok", ...} (qloo reports "ok" in live/mock, "disabled" if mocked off without a key)
```

**Terminal 2 — the client preview:**

```bash
node scripts/serveClient.mjs              # CLIENT_PORT=5173 API_PORT=8787 by default
```

Open <http://localhost:5173> — tap a preset (*David Lynch Noir*, *Post-Punk Berlin*,
*Ambient Festival*) or type an anchor, choose a mode, press **Generate**; the dossier renders
from the fixtures in offline mode.

> The preview serves the **client source** directly (`index.html` loads `./src/css/main.css`
> and `./src/js/main.js`), so no build step is needed for local work — `npm run build`
> exists for deployment (Netlify executes it via `netlify.toml`). Client edits show up on a
> browser reload.

## 5. Run variants

| Goal | Command |
|---|---|
| API only (default port 3000) | `npm start` |
| Watch mode (auto-restart on server edits) | `npm run dev` |
| Offline everything | `MOCK_MODE=true PORT=8787 npm start` + the preview |
| Custom ports | `PORT=8080 npm start`, `CLIENT_PORT=5175 API_PORT=8080 node scripts/serveClient.mjs` |
| MCP tool server (stdio) | `npm run mcp` — harness check: `npm run mcp:verify` |
| Stop | `Ctrl+C` in both terminals |

## 6. Verification before you push

```bash
npm test        # the full offline suite: 1201 tests (3 skip by design when .env is absent)
npm run lint    # syntax gate over server/src
node scripts/verifyRepoHygiene.mjs   # no test screenshots/logs ever tracked
```

Optional deeper gates: `npm run test:stress` (sequential real-mode load against a local
server), `npm run verify:env` / `verify:memory` / `verify:trackers` audits, and
`node tests/hosting-stability.js <base-url>` for a live deployment. CI runs the same
`npm ci -> lint -> test` sequence on every push (`.github/workflows/test.yml`).

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| boot aborts with `QLOO_API_KEY is required` | `.env` missing or empty | create `.env` from `.env.example` and set the key (or `MOCK_MODE=true` to stay offline) |
| UI banner `PREVIEW_PROXY_DOWN` | the gateway is not listening on `API_PORT` | start terminal 1; if you changed its port, launch the preview with a matching `API_PORT=` |
| HTTP 429 with `RATE_LIMITED` | inbound budget (30 req / 60 s per client) | pace your requests, or raise `INBOUND_RATE_LIMIT` in `.env` |
| slow first generate | cold Qloo disk cache | expected once; reset with `rm -rf .cache/qloo` |
| `EADDRINUSE` | another process owns the port | pick another: `PORT=8080 npm start` / `CLIENT_PORT=5175 ...` |
| client edit not visible | stale tab | reload the browser — the preview serves source files, no rebuild |
| Qloo 429s from upstream | key quota pressure | the transport already backs off (`QLOO_MAX_RETRIES`); lower `QLOO_RATE_LIMIT` |

## 8. Teardown

```bash
rm -f .env               # back to a clean checkout (never was committed)
rm -rf .cache/qloo dist build   # optional: drop cache and build outputs
```

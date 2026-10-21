# MCP — connect SUTO OSNOVA as a tool server

SUTO OSNOVA exposes its verified cultural-intelligence stack over the
[Model Context Protocol](https://modelcontextprotocol.io/) on the **stdio** transport, built on
the official `@modelcontextprotocol/sdk`. Any MCP-capable client (Claude Desktop, Claude Code,
Cursor, OpenCode, custom agents) can drive it as a set of tools. The surface is **read-only**
queries; the Qloo API key stays inside the spawned server process, never in the client.

## 1. Prerequisites

- Node.js 22+ available as `node` on the PATH the client uses (the client spawns the server
  itself — your shell aliases do not apply).
- The repository cloned and installed (`npm ci` — see [LOCAL_RUN.md](LOCAL_RUN.md)).
- `.env` in the repository root with `QLOO_API_KEY=...` for live Qloo traffic — **or** set
  `MOCK_MODE=true` inside `.env` to run the whole MCP surface offline over recorded fixtures
  (no key, no quota).

## 2. What you get

**18 tools** (verified live over stdio: `initialize` -> `tools/list`):

| Group | Tools |
|---|---|
| Entity & taste queries | `search_entities`, `find_tags`, `get_cross_domain_affinities`, `get_audience_insights`, `search_audiences` |
| Local (no network) | `group_entities_by_domain`, `detect_personal_data` (PII findings are masked) |
| Canonical `qloo_*` forms of the above | `qloo_search_entities`, `qloo_search_audiences`, `qloo_find_tags`, `qloo_get_cross_domain_affinities`, `qloo_get_audience_insights`, `qloo_group_entities_by_domain`, `qloo_detect_personal_data` |
| Extended `qloo_*` capabilities | `qloo_resolve_entity`, `qloo_cross_correlate`, `qloo_taste_antithesis`, `qloo_capabilities` (works offline, no credential) |

**2 resources:** `qloo://contracts/suto-osnova` (the tool contract, `application/json`) and
`qloo://domains` (the domain map).

Every network tool rides the project transport stack: `X-Api-Key`, sliding-window rate limiting
(`QLOO_RATE_LIMIT`, default 5 req/s), bounded retries, a two-tier cache, single-flight
de-duplication and the unconditional privacy guard.

## 3. Client configuration

The portable configuration block (absolute paths — clients do **not** inherit your shell's
working directory, so relative paths are the classic failure):

```json
{
  "mcpServers": {
    "suto-osnova": {
      "command": "node",
      "args": [
        "--env-file=/ABSOLUTE/PATH/to/suto-osnova/.env",
        "/ABSOLUTE/PATH/to/suto-osnova/server/src/mcp/server.js"
      ]
    }
  }
}
```

Where that block goes:

| Client | Location |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | CLI: `claude mcp add suto-osnova -- node --env-file=/ABS/PATH/.env /ABS/PATH/server/src/mcp/server.js` |
| Cursor | `~/.cursor/mcp.json` (or `<project>/.cursor/mcp.json`) |
| Any other MCP client | its `mcpServers`-equivalent entry — the `command`/`args` pair above is the portable part |

`--env-file` points Node at the project `.env` (Node 22 loads it before the server starts), so
the key and the offline switch live in ONE place. After saving the config, **restart the MCP
client** and open its MCP/Tools panel: the `suto-osnova` server must list 18 tools.

## 4. Verify the connection

**A. Repository harness (fastest, offline):**

```bash
npm run mcp:verify
```

Drives the full stdio handshake and asserts: `initialize` negotiation, snake_case tool names
with JSON schemas, the canonical `qloo_*` namespace overlap, `qloo_capabilities` working with no
credential, `qloo://contracts/*` resources reading as `application/json`, and strict NDJSON
purity on stdout. Exit 0 = PASS.

**B. Official MCP Inspector (interactive):**

```bash
npx @modelcontextprotocol/inspector \
  node --env-file=/ABSOLUTE/PATH/.env /ABSOLUTE/PATH/server/src/mcp/server.js
```

Open the inspector, press Connect: `tools/list` must return 18 tools; call `qloo_capabilities`
(no credential needed) or `search_entities` with `{"query": "Blade Runner"}`.

**C. Inside the client:** ask it — *"list your MCP tools"*, then *"use `search_entities` to find
Blade Runner"*. A correct answer means the round trip works end to end.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| server not listed / no tools | config file in the wrong place, malformed JSON, or relative paths | validate the JSON (it must parse), use absolute paths, restart the client |
| spawn fails with `QLOO_API_KEY is required` | `.env` not passed or empty | keep `--env-file=/ABS/.env` as the first arg, or set `MOCK_MODE=true` in `.env` to run offline |
| protocol errors / garbage on connect | something wrote to stdout | stdout is reserved for MCP NDJSON — all logging must go to stderr (the server already does; never wrap it in an echoing shell) |
| first tool call is slow | cold disk cache | expected once; reset with `rm -rf .cache/qloo` |
| HTTP 429 in the tool result | upstream Qloo quota | the transport already backs off; lower `QLOO_RATE_LIMIT` in `.env` |
| tools appear but calls time out | client timeout too tight for a full generate-scale query | call the smaller read tools first; check the client's MCP timeout setting |

## 6. Teardown

Remove the `suto-osnova` entry from the client config (and the `claude mcp add` equivalent:
`claude mcp remove suto-osnova`) and restart the client. Nothing else is installed — the server
runs from the repository checkout only.

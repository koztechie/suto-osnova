# TECH STACK & CODING GUIDELINES
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Paradigm:** Zero-Framework, High-Performance, Secure-by-Design

## 1. TECHNOLOGY STACK
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Properties.
- **Backend:** Node.js (v22+), ES Modules (`"type": "module"`).
- **Network:** Native Web `fetch()` API (both client and server).
- **Deployment:** Vercel (Serverless functions / Edge).
- **Integration:** Qloo REST API, Model Context Protocol (MCP) SDK.

## 2. STRICT BANS (FORBIDDEN TECHNOLOGIES)
- FORBIDDEN: Frontend frameworks/libraries (React, Vue, Angular, Svelte, jQuery).
- FORBIDDEN: CSS frameworks/utility libraries (Tailwind, Bootstrap, Sass/Less). All CSS MUST be vanilla, utilizing CSS variables.
- FORBIDDEN: Heavy network clients (Axios, Request). Use native `fetch()`.
- FORBIDDEN: CommonJS (`require()`, `module.exports`). Use strict ES Modules (`import`, `export`).

## 3. STATE & DATA MUTATION RULES
- Encapsulate all state within ES6 Classes using `#private` fields.
- FORBIDDEN: Global window variable pollution.
- Mutations MUST occur through explicit setter methods with rigorous boundary checking (clamping, type verification).
- Read operations MUST return deep copies or `Object.freeze()` snapshots to prevent accidental referential mutation by the UI layer.

## 4. ERROR HANDLING & RESILIENCE
- All asynchronous operations MUST be wrapped in `try/catch` blocks.
- Unhandled Promise Rejections are considered fatal architectural flaws.
- Network requests MUST implement an Exponential Backoff retry mechanism (max 3 attempts) for HTTP 429 (Rate Limit) and HTTP 503 (Service Unavailable) responses from Qloo API.
- The server MUST catch all upstream errors and return sanitized JSON responses to the client. FORBIDDEN to leak stack traces or Qloo internal error strings to the presentation layer.

## 5. VISUAL & AESTHETIC DISCIPLINE
- FORBIDDEN: Use of any Unicode emojis in the codebase, UI strings, or console logs.
- COLOR INVARIANTS: You MUST use ONLY the Archival Iron Palette tokens defined in `client/src/css/tokens.css`.
  - `--bg`: `#101114`
  - `--surface`: `#1F2326`
  - `--muted`: `#96A2A8`
  - `--gold`: `#D4A853`
  - `--rust`: `#E06338`
  - `--text`: `#F4EFE6`
- Hardcoded hex values outside of the token definition file are strictly FORBIDDEN.
- ACCESSIBILITY: All text-to-background contrast ratios MUST meet or exceed WCAG AAA (8.4:1 minimum).

## 6. PERFORMANCE & HARDWARE CONSTRAINTS (AMD A4 TARGET)
- SERVER MEMORY: Node.js instances MUST operate under 60MB RAM footprint. Clear temporary caching structures aggressively.
- PAYLOAD SIZES: Incoming request bodies MUST be constrained to 1MB max.
- DOM MANIPULATION: Minimize layout thrashing. Perform DOM updates using `DocumentFragment` or batch updates.
- BUNDLE SIZE: The total uncompressed client bundle (HTML/CSS/JS) MUST NOT exceed 180KB.

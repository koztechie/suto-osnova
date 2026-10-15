# ARCHITECTURE & DIRECTORY LAYOUT
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Pattern:** Secure Serverless Proxy + Vanilla SPA

## 1. SYSTEM TOPOLOGY
The architecture enforces strict separation between the stateless presentation layer and the secure API gateway.
[ CLIENT (Vanilla JS) ] <--(REST/JSON)--> [ SERVER (Node.js/Vercel) ] <--(REST/MCP)--> [ QLOO API & LLM ]

## 2. DIRECTORY STRUCTURE
You MUST adhere exactly to this filesystem taxonomy. FORBIDDEN to create new root directories.

/ (Repository Root)
├── client/                 # Presentation layer (Vanilla JS, Zero Frameworks)
│   ├── public/             # Static assets (favicon, opengraph images)
│   ├── src/
│   │   ├── css/            # Archival Iron Palette tokens, structural CSS
│   │   ├── js/
│   │   │   ├── api.js      # Client-to-Server fetch wrappers
│   │   │   ├── state.js    # Immutable state container (frozen snapshots)
│   │   │   └── ui.js       # DOM manipulation and event listeners
│   └── index.html          # Semantic HTML5 entry point
├── server/                 # Secure API Gateway & MCP Server
│   ├── src/
│   │   ├── config/         # Environment variables validation (env.js)
│   │   ├── mcp/            # Model Context Protocol tool registrations
│   │   ├── routes/         # HTTP endpoints (modes handlers)
│   │   ├── services/       # Qloo REST client, LLM integration
│   │   └── engine/         # Core logic (AffinityScorer, CrossDomainExpander)
│   ├── tests/              # Automated logic tests
│   └── index.js            # Node.js entry point
├── docs/                   # AI Governance and Project Documentation
│   ├── architecture/       # AI rules, PRD, layouts, tech stack
│   └── audit/              # Cleanup and status reports
├── scripts/                # Build and utility scripts (Bash/Node)
├── package.json            # Dependencies and npm scripts (type: module)
├── vercel.json             # Deployment routing configuration
├── .env.template           # Safe environment variable template
├── .gitignore              # Security and cache exclusion rules
└── PLAN_STATE.md           # Immutable task log and state machine

## 3. ARCHITECTURAL INVARIANTS
- SECURE PROXY: The `client` MUST NEVER call the Qloo API directly. All requests MUST route through `server` to protect `QLOO_API_KEY`.
- SINGLE SOURCE OF TRUTH: CSS custom properties in `client/src/css/tokens.css` dictate all visual styling. Inline styles are FORBIDDEN.
- STATE ISOLATION: Client state MUST be managed via an ES Class with `#private` fields to prevent global window object pollution.
- DATA FLOW: Server responses MUST conform to strict JSON schemas. Server MUST intercept and handle all upstream HTTP 429/500 errors from Qloo, returning sanitized HTTP 400/500 to the client without leaking stack traces.

## 4. MCP (MODEL CONTEXT PROTOCOL) INTEGRATION
- The `server/src/mcp/` module acts as the translator between LLM tool-calling and the Qloo Taste Graph.
- Registered tools MUST include explicit JSON Schema definitions for their inputs.
- The heavy agentic workflow executes entirely on the backend to preserve memory on low-end devices (AMD A4 constraint); the client only renders the resulting JSON dossier.

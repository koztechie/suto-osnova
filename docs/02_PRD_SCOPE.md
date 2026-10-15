# PRODUCT REQUIREMENTS & SCOPE (PRD)
**Project:** SUTO OSNOVA (Qloo Agentic Hackathon)
**Target:** $15,000 Grand Prize (Qloo)

## 1. VISION & CORE VALUE
SUTO OSNOVA is an autonomous cultural intelligence and mise-en-scène worldbuilding agent.
Problem: LLMs hallucinate generic cultural stereotypes.
Solution: SUTO OSNOVA leverages Qloo's cross-domain taste graph (250M+ entities) via REST/MCP to engineer mathematically grounded cultural dossiers based on real human affinities across music, film, literature, dining, and fashion.

## 2. STRICT SCOPE BOUNDARIES (VIA NEGATIVA)
- IN SCOPE: Stateless Node.js backend proxying Qloo API requests.
- IN SCOPE: Model Context Protocol (MCP) tool registration.
- IN SCOPE: Vanilla JS single-page application (SPA) client.
- IN SCOPE: LocalStorage for session caching.
- OUT OF SCOPE (FORBIDDEN): User authentication (OAuth/JWT), relational databases (PostgreSQL/MySQL), persistent user profiles, payment gateways.
- OUT OF SCOPE (FORBIDDEN): Heavy UI frameworks (React, Vue, Tailwind).

## 3. FUNCTIONAL REQUIREMENTS: THE 3 MODES

### 3.1 Mode 1: Worldbuilder (Character & Scene Dossier)
- INPUT: Cultural anchor (e.g., "A24 Psychological Horror" or "1970s Post-Punk Berlin").
- PROCESS: Agent resolves the entity via Qloo, extracts top affinity vectors across 5 domains (Sound, Text, Material, Gastronomy, Visual).
- OUTPUT: A print-ready "Mise-en-Scène Dossier" detailing mathematically correlated music, books, fashion brands, and dining venues for writers/directors.

### 3.2 Mode 2: Experiential Activation (Live Events)
- INPUT: Headlining artist or festival concept.
- PROCESS: Agent queries Qloo audience insights and cross-domain affinities.
- OUTPUT: Curation list for opening acts, hyper-relevant brand sponsors, and local food/beverage vendors that statistically align with the target audience.

### 3.3 Mode 3: Taste Antithesis (Cultural Divergence)
- INPUT: Target entity.
- PROCESS: Agent isolates entities with the lowest or negative correlation vectors in the Qloo graph.
- OUTPUT: A "Cultural Blindspot" report used to engineer dramatic conflict, design antagonistic characters, or identify sponsorship risks.

## 4. USER STORIES
- AS A screenwriter, I WANT TO input a movie reference SO THAT I get a statistically accurate list of books and music my character would consume.
- AS AN event producer, I WANT TO input a band name SO THAT I can identify non-obvious brand sponsors with high audience affinity.
- AS A systems architect, I WANT TO view the raw Qloo API payload SO THAT I can verify the absence of LLM hallucinations.

## 5. TECHNICAL PERFORMANCE & ACCEPTANCE CRITERIA
- PERFORMANCE: Full 5-domain cross-correlation cycle must execute in <4.5 seconds on a baseline AMD A4 architecture.
- PAYLOAD: Maximum API response payload processed by the client must not exceed 1MB.
- ACCESSIBILITY: 100% compliance with WCAG AAA 8.4:1 minimum contrast using the Archival Iron Palette.
- RELIABILITY: 0% crash rate handling Qloo API rate limits (HTTP 429) via exponential backoff.
- DEPLOYMENT: Successfully deployed and publicly accessible on Vercel without exposing the `QLOO_API_KEY` to the client browser.

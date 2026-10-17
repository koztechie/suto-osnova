/**
 * PrivacyNotice (task 107) — the PRIVACY & NO-PERSONAL-DATA disclaimer
 * block carried by every dossier document.
 *
 * HONESTY DISCIPLINE: the notice states only what the system ACTUALLY
 * enforces — no fabricated legal claims (no GDPR/CCPA certification
 * is asserted). Every line is grounded in the implemented posture:
 *   - the agent models the TASTE of cultural ENTITIES, never people
 *     (privacyGuard's foundational rule);
 *   - PII detected in a request (email / IP / phone / SSN / credit
 *     card / JWT) is REDACTED at the transport layer or REJECTED at
 *     the input boundary with HTTP 400 PII_DETECTED — enforced
 *     unconditionally (privacyGuard + httpErrors);
 *   - no tracking / analytics / advertising cookies (the task-77
 *     no-trackers audit: a runtime-dependency allowlist, zero
 *     trackers);
 *   - the Qloo API key is a server-side credential, never sent to
 *     the browser (the deployment contract);
 *   - session records store the cultural anchor and curation
 *     results, not user identity (sessionCache's stored shape).
 *
 * The block is FIXED (a policy statement, not data), so it appears
 * on every document regardless of mode. Deterministic, zero emojis.
 *
 * Surfaces: PRIVACY_NOTICE (the exported constant text),
 * renderPrivacyNotice() (the section body). Pinned by
 * server/test/privacyNotice.test.js.
 */

/**
 * The fixed disclaimer text: an ALL-CAPS lead label, one honest
 * framing line, then the enforced guarantees as bullets.
 */
export const PRIVACY_NOTICE = Object.freeze([
  'PRIVACY NOTICE — no personal data is collected',
  'This dossier is generated from cultural-entity taste data (artists, films, books, places, brands) resolved through the Qloo API. It contains no personal data about any individual.',
  '   - Personal data is never collected or stored — the agent models the taste of cultural entities, never people.',
  '   - Any personal data detected in a request (email, IP address, phone number, SSN, credit card, JWT) is redacted before it leaves the server, or the request is rejected with HTTP 400 PII_DETECTED — enforced unconditionally by the privacy guard.',
  '   - No tracking, analytics, or advertising cookies are set.',
  '   - The Qloo API key is a server-side credential and is never sent to the browser.',
  '   - Session records store the cultural anchor and curation results, not user identity.',
].join('\n'));

/** The section body (the fixed notice). */
export function renderPrivacyNotice() {
  return PRIVACY_NOTICE;
}

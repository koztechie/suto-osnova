/**
 * SponsorshipBlindspots (task 98) — SPONSORSHIP BLINDSPOT DETECTION:
 * screens a sponsor shortlist for the brands that would FAIL at an
 * event, so a producer can cut them BEFORE the booking.
 *
 * THE PREMISE (the defensive half of task 91's positive selection):
 * a naive curator books sponsors by prominence; the graph can prove
 * which of those picks carry measurable RESONANCE RISK. A brand is
 * a blindspot when it sits where the audience has no taste signal —
 * five deterministic, machine-readable flags decide (each with an
 * exported tuning floor, never an invented threshold):
 *
 *   taste_blindspot            graph affinity to the anchor at/below
 *                              graphFloor (default 0.2) — the brand
 *                              sits in the taste graph's blindspot;
 *   audience_blindspot         audience-insights affinity at/below
 *                              audienceFloor (default 0.2) — the
 *                              measured audience does not align;
 *   single_evidence            the pick is confirmed by only ONE leg
 *                              (not dual, task 87) — elevated risk;
 *   low_recognition            popularity below recognitionFloor
 *                              (default 0.05) — the audience never
 *                              encountered it, so it cannot resonate
 *                              on site (the task-96 encounter axis);
 *   mass_market_no_justification popularity at/above massFloor
 *                              (default 0.5) AND a taste/audience
 *                              blindspot — a mainstream name with no
 *                              taste alignment: reads inauthentic,
 *                              the highest fail risk.
 *
 * RISK SCORE: the renormalized weighted mean (task-48 discipline) of
 * the MEASURED danger axes only — taste danger (1 - affinity),
 * audience danger (1 - audienceAffinity), recognition danger
 * (1 - popularity), evidence danger (dual 0 / single 0.5). An axis
 * with no data is RENORMALIZED OUT, never scored as zero; a
 * candidate with NOTHING measurable is `unverifiable` and forced to
 * high risk (an unprovable sponsor is an unjustifiable booking).
 *
 * VERDICT: high_risk (a core taste/audience blindspot, >= 3 flags,
 * or unverifiable) > elevated (1-2 flags) > clear (no flags).
 * Every flag is ledgered per candidate; nothing is silently dropped.
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * detectSponsorshipBlindspots(candidates, options),
 * piecesFromActivationBundle(bundle) (adapter over a runExperiential
 * bundle: sponsor picks enriched with ranked popularity + the
 * audience top list), renderSponsorshipBlindspots(report). Pinned by
 * server/test/sponsorshipBlindspots.test.js.
 */

/** Module version. */
export const SPONSORSHIP_BLINDSPOTS_VERSION = 1;

/** The five machine-readable blindspot flags (exported vocabulary). */
export const BLINDSPOT_FLAGS = Object.freeze({
  TASTE: 'taste_blindspot',
  AUDIENCE: 'audience_blindspot',
  SINGLE_EVIDENCE: 'single_evidence',
  LOW_RECOGNITION: 'low_recognition',
  MASS_MARKET: 'mass_market_no_justification',
  UNVERIFIABLE: 'unverifiable',
});

/** Machine-readable reasons for the same vocabulary. */
export const BLINDSPOT_REASONS = BLINDSPOT_FLAGS;

/** Documented floors + weights (exported tuning contract). */
export const SPONSORSHIP_TUNING = Object.freeze({
  graphFloor: 0.2,
  audienceFloor: 0.2,
  recognitionFloor: 0.05,
  massFloor: 0.5,
  weights: Object.freeze({ taste: 0.35, audience: 0.35, recognition: 0.15, evidence: 0.15 }),
});

/** Evidence strength (the task-87 labels -> a 0..1 leg count). */
const EVIDENCE_STRENGTH = Object.freeze({
  dual: 1,
  confirmed_affinity: 0.5,
  audience_insight: 0.5,
});

/** The verdict ladder (exported). */
export const RISK_VERDICTS = Object.freeze({
  HIGH: 'high_risk',
  ELEVATED: 'elevated',
  CLEAR: 'clear',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Screen a sponsor shortlist for resonance-risk blindspots.
 *
 * @param {ReadonlyArray<object>} candidates rows carrying {name,
 *        affinity?, audienceAffinity?, popularity?, evidence?, id?,
 *        domain?} — the piecesFromActivationBundle shape or any
 *        equivalent.
 * @param {object} [options] { tuning } floors/weights overrides.
 * @returns {Readonly<object>} the frozen report.
 */
export function detectSponsorshipBlindspots(candidates, options = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('detectSponsorshipBlindspots: candidates must be an array');
  }
  const tuning = { ...SPONSORSHIP_TUNING, ...(options.tuning ?? {}) };
  for (const key of ['graphFloor', 'audienceFloor', 'recognitionFloor', 'massFloor']) {
    if (typeof tuning[key] !== 'number' || !Number.isFinite(tuning[key])
      || tuning[key] < 0 || tuning[key] > 1) {
      throw new TypeError(`detectSponsorshipBlindspots: tuning.${key} must be in 0..1`);
    }
  }
  const weights = { ...SPONSORSHIP_TUNING.weights, ...(options.tuning?.weights ?? {}) };
  for (const [key, value] of Object.entries(weights)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`detectSponsorshipBlindspots: tuning.weights.${key} must be >= 0`);
    }
  }

  const rows = [];
  const blindspots = [];
  const clear = [];
  const byFlag = Object.fromEntries(Object.values(BLINDSPOT_FLAGS).map((f) => [f, 0]));
  let highRisk = 0;
  let elevated = 0;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object'
      || typeof candidate.name !== 'string') continue;
    const affinity = finite(candidate.affinity);
    const audienceAffinity = finite(candidate.audienceAffinity);
    const popularity = finite(candidate.popularity);
    const strength = EVIDENCE_STRENGTH[candidate.evidence] ?? null;

    const flags = [];
    const tasteBlind = affinity !== null && affinity <= tuning.graphFloor;
    const audienceBlind = audienceAffinity !== null && audienceAffinity <= tuning.audienceFloor;
    if (tasteBlind) flags.push(BLINDSPOT_FLAGS.TASTE);
    if (audienceBlind) flags.push(BLINDSPOT_FLAGS.AUDIENCE);
    if (strength !== null && strength < 1) flags.push(BLINDSPOT_FLAGS.SINGLE_EVIDENCE);
    if (popularity !== null && popularity < tuning.recognitionFloor) {
      flags.push(BLINDSPOT_FLAGS.LOW_RECOGNITION);
    }
    if (popularity !== null && popularity >= tuning.massFloor && (tasteBlind || audienceBlind)) {
      flags.push(BLINDSPOT_FLAGS.MASS_MARKET);
    }

    // The renormalized danger score over the MEASURED axes only.
    const axes = [];
    if (affinity !== null) axes.push({ key: 'taste', danger: 1 - affinity });
    if (audienceAffinity !== null) axes.push({ key: 'audience', danger: 1 - audienceAffinity });
    if (popularity !== null) axes.push({ key: 'recognition', danger: 1 - popularity });
    if (strength !== null) axes.push({ key: 'evidence', danger: 1 - strength });

    let riskScore = null;
    if (axes.length > 0) {
      const weightSum = axes.reduce((sum, axis) => sum + weights[axis.key], 0);
      riskScore = weightSum > 0
        ? round12(axes.reduce((sum, axis) => sum + weights[axis.key] * axis.danger, 0) / weightSum)
        : null;
    } else {
      // Nothing measurable: an unprovable sponsor is an
      // unjustifiable booking — forced to high risk, honestly.
      flags.push(BLINDSPOT_FLAGS.UNVERIFIABLE);
    }

    const verdict = (tasteBlind || audienceBlind || flags.length >= 3
      || flags.includes(BLINDSPOT_FLAGS.UNVERIFIABLE))
      ? RISK_VERDICTS.HIGH
      : (flags.length > 0 ? RISK_VERDICTS.ELEVATED : RISK_VERDICTS.CLEAR);
    if (verdict === RISK_VERDICTS.HIGH) highRisk += 1;
    else if (verdict === RISK_VERDICTS.ELEVATED) elevated += 1;

    for (const flag of flags) byFlag[flag] += 1;

    const row = Object.freeze({
      id: candidate.id ?? null,
      name: candidate.name,
      domain: candidate.domain ?? null,
      affinity,
      audienceAffinity,
      popularity,
      evidence: candidate.evidence ?? null,
      flags: Object.freeze(flags),
      riskScore,
      riskPercent: riskScore === null ? 100 : Math.round(riskScore * 100),
      verdict,
      note: flags.length > 0
        ? `resonance risk: ${flags.join(', ')}`
        : 'dual-aligned, recognized, no measurable resonance risk',
    });
    rows.push(row);
    if (verdict === RISK_VERDICTS.CLEAR) clear.push(row);
    else blindspots.push(row);
  }

  // Blindspots first, risk DESC, then name.
  const byRisk = (a, b) =>
    (b.riskScore ?? 1) - (a.riskScore ?? 1) || a.name.localeCompare(b.name);
  rows.sort(byRisk);
  blindspots.sort(byRisk);
  clear.sort(byRisk);

  return Object.freeze({
    version: SPONSORSHIP_BLINDSPOTS_VERSION,
    tuning: Object.freeze({ ...tuning, weights: Object.freeze({ ...weights }) }),
    candidates: Object.freeze(rows),
    blindspots: Object.freeze(blindspots),
    clear: Object.freeze(clear),
    summary: blindspots.length > 0
      ? `${blindspots.length} of ${rows.length} sponsor candidate(s) carry ` +
        `measurable resonance risk (${highRisk} high, ${elevated} elevated) — ` +
        `screen before booking.`
      : `No measurable resonance risk across ${rows.length} sponsor candidate(s) — ` +
        `all dual-aligned and recognized.`,
    stats: Object.freeze({
      candidates: rows.length,
      blindspots: blindspots.length,
      highRisk,
      elevated,
      clear: clear.length,
      byFlag: Object.freeze({ ...byFlag }),
    }),
  });
}

/**
 * Adapter: a runExperiential() bundle into blindspot candidates —
 * the sponsor picks enriched with the ranked entry's popularity and
 * the audience-insights top list (matched by name, case-insensitive).
 */
export function piecesFromActivationBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.curation) {
    throw new TypeError('piecesFromActivationBundle: expected a runExperiential() bundle');
  }
  const ranked = Array.isArray(bundle.ranked) ? bundle.ranked : [];
  const byName = new Map(ranked.map((entry) => [entry.name, entry]));
  const audience = new Map(
    (Array.isArray(bundle.audience?.top) ? bundle.audience.top : [])
      .map((row) => [String(row?.name ?? '').toLowerCase(), row])
  );

  const sponsors = Array.isArray(bundle.curation?.sponsors)
    ? bundle.curation.sponsors : [];
  return Object.freeze(sponsors.map((sponsor) => {
    const rankedEntry = byName.get(sponsor.name) ?? null;
    const audienceRow = audience.get(String(sponsor.name).toLowerCase()) ?? null;
    return Object.freeze({
      id: rankedEntry?.id ?? null,
      name: sponsor.name,
      domain: sponsor.domain ?? null,
      affinity: sponsor.affinityPercent === null || sponsor.affinityPercent === undefined
        ? null : sponsor.affinityPercent / 100,
      audienceAffinity: audienceRow?.affinityPercent === null
        || audienceRow?.affinityPercent === undefined
        ? null : audienceRow.affinityPercent / 100,
      popularity: finite(rankedEntry?.popularity),
      evidence: sponsor.evidence ?? null,
    });
  }));
}

/**
 * Render the printable screening report (deterministic, zero emojis).
 */
export function renderSponsorshipBlindspots(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.blindspots)) {
    throw new TypeError('renderSponsorshipBlindspots: expected a detectSponsorshipBlindspots() report');
  }
  const lines = [];
  lines.push('SPONSORSHIP BLINDSPOTS — brands that would fail on site');
  lines.push(report.summary);
  if (report.blindspots.length > 0) {
    lines.push('RISK SCREEN:');
    for (const row of report.blindspots) {
      lines.push(
        `   - ${row.name} [${row.verdict.replace(/_/g, ' ')}]` +
          `${row.riskPercent !== null ? ` — ${row.riskPercent}% risk` : ''}: ` +
          `${row.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}`
      );
    }
  }
  if (report.clear.length > 0) {
    lines.push(`CLEARED (${report.clear.length}): ${report.clear.map((r) => r.name).join(', ')}`);
  }
  return lines.join('\n');
}

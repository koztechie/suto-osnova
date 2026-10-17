/**
 * AntagonistProfile (task 97) — ANTAGONIST PROFILE GENERATION for
 * dramaturges: selects the environment that SUBCONSCIOUSLY CONFLICTS
 * with the protagonist, per cultural domain.
 *
 * THE DRAMATURGICAL PREMISE (PRD 3.3's "design antagonistic
 * characters"): a credible antagonist is not merely "opposite" —
 * their WORLD must sit where the HERO is most anchored, so the clash
 * reads as inevitable rather than arbitrary. The tension of a
 * domain-level conflict is therefore the PRODUCT of two MEASURED
 * quantities:
 *
 *     tension = heroAnchor x antagonistDivergence     (both in [0, 1])
 *
 *   - heroAnchor — the protagonist's own strongest affinity in that
 *     domain (the task-97 fingerprint retained by the antithesis
 *     block: the hero's demonstrated taste commitment — how much the
 *     hero CARES about this domain);
 *   - antagonistDivergence — how far the noise-filtered blindspot
 *     pick (task 96) sits from that anchor (how violently the
 *     antagonist's environment CLASHES).
 * A domain only scores when BOTH poles are measured: a hero who is
 * not anchored there has nothing to lose (reason
 * `no_protagonist_anchor`); a domain with no proven opposition is a
 * blindspot GAP (reason `no_antagonist_evidence`) and is reported,
 * never invented. Unmeasured rows yield a null tension, honestly.
 *
 * OUTPUT: the ranked ENVIRONMENT list (tension DESC), the single
 * SIGNATURE conflict (the strongest tension — the character's core
 * dramatic engine), and the honest gap ledger. Names are Qloo
 * entities, never invented; the `rationale` lines are deterministic
 * templates over measured numbers — no psychological invention, the
 * dramaturge writes the character, we supply the evidence.
 *
 * Pure module: no I/O, no clocks, no RNG. Surfaces:
 * buildAntagonistProfile(pieces, options),
 * profileFromAntithesisBundle(bundle),
 * renderAntagonistProfile(profile). Pinned by
 * server/test/antagonistProfile.test.js.
 */

/** Module version. */
export const ANTAGONIST_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const ANTAGONIST_DEFAULTS = Object.freeze({
  limit: 10,
});

/** Machine-readable gap / unmeasured reasons. */
export const ANTAGONIST_REASONS = Object.freeze({
  NO_ANTAGONIST_EVIDENCE: 'no_antagonist_evidence',
  NO_PROTAGONIST_ANCHOR: 'no_protagonist_anchor',
  ANCHOR_NOT_UNSIGNED: 'anchor_not_unsigned',
  SELF_MATCH: 'self_match',
});

const round12 = (value) => Math.round(value * 1e12) / 1e12;
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Build the antagonist profile from the antithesis block's pieces.
 *
 * @param {object} pieces { protagonist: {name, domain, fingerprint},
 *        antithesis: { matrix } } — the task-94/96/97 block shapes.
 * @param {object} [options] { limit (1..50, default 10) }.
 * @returns {Readonly<object>} the frozen profile.
 */
export function buildAntagonistProfile(pieces, options = {}) {
  const protagonist = pieces?.protagonist;
  const antithesis = pieces?.antithesis;
  if (!protagonist || typeof protagonist !== 'object'
    || typeof protagonist.name !== 'string') {
    throw new TypeError('buildAntagonistProfile: pieces must carry a named protagonist');
  }
  if (!antithesis || typeof antithesis !== 'object'
    || !Array.isArray(antithesis.matrix)) {
    throw new TypeError('buildAntagonistProfile: pieces.antithesis must carry a matrix');
  }
  const limit = options.limit ?? ANTAGONIST_DEFAULTS.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('buildAntagonistProfile: limit must be an integer in 1..50');
  }

  const fingerprint = Array.isArray(protagonist.fingerprint)
    ? protagonist.fingerprint : [];
  const heroByDomain = new Map(fingerprint.map((row) => [row.domain, row]));

  const environments = [];
  const gaps = [];
  for (const zone of antithesis.matrix) {
    const hero = heroByDomain.get(zone.domain) ?? null;
    const antagonist = zone.entries?.[0] ?? null;

    if (antagonist === null) {
      gaps.push(Object.freeze({
        domain: zone.domain,
        reason: ANTAGONIST_REASONS.NO_ANTAGONIST_EVIDENCE,
        note: 'no proven opposition in this domain — the blindspot stays a gap',
      }));
      continue;
    }
    if (hero === null || hero.present !== true) {
      gaps.push(Object.freeze({
        domain: zone.domain,
        reason: ANTAGONIST_REASONS.NO_PROTAGONIST_ANCHOR,
        antagonist: antagonist.name,
        note: 'the antagonist environment exists but the hero is not anchored here',
      }));
      continue;
    }
    // A domain whose ONLY measurable candidate is both the hero's
    // anchor and the blindspot pick is a degenerate self-match: the
    // hero would "conflict" with themselves. Never staged.
    if ((hero.id !== null && hero.id === antagonist.id)
      || hero.name === antagonist.name) {
      gaps.push(Object.freeze({
        domain: zone.domain,
        reason: ANTAGONIST_REASONS.SELF_MATCH,
        hero: hero.name,
        note: 'the hero anchor and the blindspot pick are the same entity — no true opposition',
      }));
      continue;
    }

    const heroAnchor = finite(hero.affinity);
    const divergence = antagonist.divergencePercent === null
      ? null : antagonist.divergencePercent / 100;
    if (heroAnchor === null) {
      // A signed hero anchor carries no unsigned affinity — the
      // tension is honestly unmeasurable, never fabricated.
      gaps.push(Object.freeze({
        domain: zone.domain,
        reason: ANTAGONIST_REASONS.ANCHOR_NOT_UNSIGNED,
        hero: hero.name,
        antagonist: antagonist.name,
        note: 'the hero anchor is a signed correlation — no unsigned affinity to multiply',
      }));
      continue;
    }

    const tension = round12(heroAnchor * (divergence ?? 0));
    environments.push(Object.freeze({
      domain: zone.domain,
      hero: Object.freeze({
        name: hero.name,
        id: hero.id ?? null,
        affinity: heroAnchor,
        affinityPercent: hero.affinityPercent,
      }),
      antagonist: Object.freeze({
        name: antagonist.name,
        id: antagonist.id ?? null,
        divergencePercent: antagonist.divergencePercent,
        dissonanceClass: antagonist.dissonanceClass ?? null,
        tier: antagonist.tier ?? null,
      }),
      tension,
      tensionPercent: Math.round(tension * 100),
      rationale: `the hero's ${zone.domain} anchor ${hero.name}` +
        ` (${hero.affinityPercent}%) meets ${antagonist.name}` +
        ` (${antagonist.divergencePercent}% divergence)`,
    }));
  }

  // Tension DESC, then divergence DESC, then domain name.
  environments.sort((a, b) =>
    b.tension - a.tension
    || (b.antagonist.divergencePercent ?? -1) - (a.antagonist.divergencePercent ?? -1)
    || a.domain.localeCompare(b.domain)
  );
  const ranked = Object.freeze(environments.slice(0, limit));
  const signature = ranked.length > 0 ? ranked[0] : null;

  const tensions = ranked.map((env) => env.tension);
  return Object.freeze({
    version: ANTAGONIST_VERSION,
    protagonist: Object.freeze({
      name: protagonist.name,
      domain: protagonist.domain ?? null,
    }),
    environments: ranked,
    signature,
    gaps: Object.freeze(gaps),
    summary: ranked.length > 0
      ? `${ranked.length} conflict environment(s) for the antagonist of ` +
        `${protagonist.name}` +
        `${signature ? ` — signature ${signature.domain} clash against ` +
          `${signature.antagonist.name} (${signature.tensionPercent}% tension)` : ''}.`
      : `No measurable conflict environment for the antagonist of ` +
        `${protagonist.name} — the graph cannot prove a subconscious clash.`,
    stats: Object.freeze({
      domains: antithesis.matrix.length,
      paired: ranked.length,
      gaps: gaps.length,
      maxTension: signature?.tensionPercent ?? null,
      meanTension: tensions.length > 0
        ? Math.round((tensions.reduce((sum, t) => sum + t, 0) / tensions.length) * 100)
        : null,
    }),
  });
}

/**
 * Adapter: an runAntithesis() bundle into an antagonist profile (the
 * block carries both the protagonist fingerprint and the matrix).
 */
export function profileFromAntithesisBundle(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object' || !bundle.antithesis
    || typeof bundle.antithesis !== 'object') {
    throw new TypeError('profileFromAntithesisBundle: expected a runAntithesis() bundle');
  }
  return buildAntagonistProfile({
    protagonist: bundle.antithesis.protagonist,
    antithesis: bundle.antithesis,
  }, options);
}

/**
 * Render the printable character brief (deterministic, zero emojis).
 */
export function renderAntagonistProfile(profile) {
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.environments)) {
    throw new TypeError('renderAntagonistProfile: expected a buildAntagonistProfile() profile');
  }
  const lines = [];
  lines.push(
    `ANTAGONIST PROFILE — the world that subconsciously clashes with ` +
      `${profile.protagonist.name}`
  );
  lines.push(profile.summary);
  if (profile.signature !== null) {
    lines.push(
      `SIGNATURE CONFLICT [${profile.signature.domain}]: ` +
        `${profile.signature.hero.name} vs ${profile.signature.antagonist.name}` +
        ` — ${profile.signature.tensionPercent}% tension`
    );
  }
  for (const env of profile.environments) {
    lines.push(
      `   [${env.domain}] ${env.tensionPercent}% tension — ` +
        `${env.hero.name} (${env.hero.affinityPercent}%) vs ` +
        `${env.antagonist.name} (${env.antagonist.divergencePercent}% divergence)`
    );
  }
  if (profile.gaps.length > 0) {
    lines.push(
      `UNSCORED (${profile.gaps.length}): ` +
        profile.gaps.map((g) => `${g.domain} [${g.reason.replace(/_/g, ' ')}]`).join(', ')
    );
  }
  return lines.join('\n');
}

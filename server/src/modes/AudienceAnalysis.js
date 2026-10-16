/**
 * AudienceAnalysis (task 88) — the AUDIENCE ANALYSIS of a music
 * artist or a festival LINEUP through the live-verified Qloo
 * audience endpoints (getAudienceInsights, /v2/insights).
 *
 * WHAT IT DELIVERS (for the Live Nation / Billboard brief):
 *   - BLENDED LINEUP AUDIENCE — one insights query carrying EVERY
 *     act's entity id (the client's documented multi-entity blend):
 *     who the WHOLE bill appeals to;
 *   - PER-ACT FINGERPRINTS — one insights query per act (isolated:
 *     a failing act degrades honestly and never sinks the lineup);
 *   - CONVERGENCE — affinity entities appearing in the top lists of
 *     TWO OR MORE acts: the audience magnets of the bill (sponsor
 *     and programming gold);
 *   - DIVERGENCE — pairwise audience overlap (|A∩B| / min(|A|,|B|)):
 *     the most divergent pairs first — the booking insight that says
 *     which acts pull DIFFERENT crowds (lineup balance);
 *   - EXPLAINABILITY — the client's attribution pass-through when
 *     present (never reformatted, never invented).
 *
 * INGRESS (tolerant, the house discipline): a single act (string or
 * {id?, name?}) or an ARRAY of up to maxActs (default 10) acts;
 * acts carrying a UUID id skip resolution entirely (a spy proves it);
 * string acts resolve through the probe ladder with the INJECTABLE
 * search — an unresolvable act lands in the ledger (act_unresolved)
 * and the rest of the lineup continues (only an empty lineup throws).
 *
 * DETERMINISM: no clocks, no RNG; query results are normalized to
 * {name, affinityPercent} rows with deterministic ordering; identical
 * input + insightsFn -> deep-equal report (pinned by
 * server/test/audienceAnalysis.test.js). Pure of network by
 * injection: the default insightsFn is the real client.
 */

import { resolveTextQuery } from '../services/seedEntityResolver.js';
import { getAudienceInsights } from '../services/audienceInsightsClient.js';
import { primaryInsightType } from '../services/domainMapper.js';
import { runParallelTasks } from '../services/parallelTasks.js';
import { parseSceneContext } from './SceneContext.js';
import { deepFreeze } from '../engine/deepFreeze.js';

/** Report version. */
export const AUDIENCE_ANALYSIS_VERSION = 1;

/** Documented defaults (exported tuning contract). */
export const AUDIENCE_DEFAULTS = Object.freeze({
  take: 10,
  maxActs: 10,
  concurrency: 4,
});

/** Machine-readable failure codes surfaced by the ledger. */
export const AUDIENCE_CODES = Object.freeze({
  ACT_UNRESOLVED: 'act_unresolved',
  ACT_QUERY_FAILED: 'act_insights_failed',
  BLENDED_QUERY_FAILED: 'blended_insights_failed',
});

/** Typed error: a well-formed request the contract rejects. */
export class AudienceAnalysisError extends Error {
  constructor(message, { code, details, cause } = undefined) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AudienceAnalysisError';
    this.code = code;
    this.details = details;
  }
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;

const normalizeRows = (rows, take) => (Array.isArray(rows) ? rows : [])
  .slice(0, take)
  .map((row) => Object.freeze({
    name: typeof row?.name === 'string' ? row.name : null,
    affinityPercent: typeof row?.affinity === 'number'
      ? Math.round(row.affinity * 100) : null,
  }))
  .filter((row) => row.name !== null);

/** One insights outcome -> the honest report slice. */
const toAudience = (result, take) => {
  if (result.status === 'rejected') {
    return Object.freeze({
      available: false,
      count: 0,
      top: Object.freeze([]),
      explainability: null,
      error: String(result.reason?.code ?? result.reason?.message ?? result.reason).slice(0, 200),
    });
  }
  const value = result.value;
  return Object.freeze({
    available: true,
    count: typeof value?.count === 'number' ? value.count : 0,
    top: Object.freeze(normalizeRows(value?.results, take)),
    explainability: value?.explainability ?? null,
    error: null,
  });
};

const toLineupEntry = (id, name, category) =>
  Object.freeze({ id, name, category: category ?? null });

/**
 * Analyze one artist or a festival lineup.
 *
 * @param {string|object|Array} input single act or act array.
 * @param {object} [options] { take, maxActs, concurrency, targetDomain,
 *        location, scene, insightsFn, search }.
 * @returns {Promise<Readonly<object>>} the frozen report.
 */
export async function analyzeAudience(input, options = {}) {
  const take = options.take ?? AUDIENCE_DEFAULTS.take;
  const maxActs = options.maxActs ?? AUDIENCE_DEFAULTS.maxActs;
  if (!Number.isInteger(take) || take < 1 || take > 50) {
    throw new TypeError('analyzeAudience: take must be an integer in 1..50');
  }
  if (!Number.isInteger(maxActs) || maxActs < 1 || maxActs > 25) {
    throw new TypeError('analyzeAudience: maxActs must be an integer in 1..25');
  }
  if (options.insightsFn !== undefined && typeof options.insightsFn !== 'function') {
    throw new TypeError('analyzeAudience: insightsFn must be a function when given');
  }

  const rawActs = Array.isArray(input) ? input : [input];
  if (rawActs.length === 0) {
    throw new TypeError('analyzeAudience: at least one act is required');
  }
  if (rawActs.length > maxActs) {
    throw new AudienceAnalysisError(
      `lineup of ${rawActs.length} acts exceeds maxActs=${maxActs}`,
      { code: 'lineup_too_large', details: { acts: rawActs.length, maxActs } }
    );
  }
  for (const act of rawActs) {
    if (typeof act !== 'string' && (typeof act !== 'object' || act === null || Array.isArray(act))) {
      throw new TypeError('analyzeAudience: each act must be a string or an object');
    }
  }

  const scene = parseSceneContext(options.scene ?? null);
  const location = options.location ?? scene?.location ?? null;
  const insightsFn = options.insightsFn ?? getAudienceInsights;
  const failures = [];

  // 1. Resolve string acts (id-carrying acts skip resolution — no
  //    client call, spy-pinned); unresolvable acts degrade honestly.
  const lineup = [];
  for (const act of rawActs) {
    if (typeof act === 'object' && typeof act.id === 'string' && act.id.length > 0) {
      lineup.push(Object.freeze({
        resolved: true,
        entry: toLineupEntry(act.id, act.name ?? act.id, act.category ?? act.domain ?? null),
      }));
      continue;
    }
    try {
      const resolved = await resolveTextQuery(typeof act === 'string' ? act : act.name, {
        search: options.search,
        ...(options.domain ? { domain: options.domain } : {}),
      });
      lineup.push(Object.freeze({
        resolved: true,
        entry: toLineupEntry(
          resolved.entity.id, resolved.entity.name, resolved.entity.category
        ),
      }));
    } catch (error) {
      failures.push({
        code: AUDIENCE_CODES.ACT_UNRESOLVED,
        act: typeof act === 'string' ? act : (act?.name ?? null),
        message: String(error?.code ?? error?.message ?? error).slice(0, 200),
      });
      lineup.push(Object.freeze({
        resolved: false,
        entry: Object.freeze({
          id: null,
          name: typeof act === 'string' ? act : (act?.name ?? null),
          category: null,
        }),
      }));
    }
  }
  const resolvedActs = lineup.filter((slot) => slot.resolved).map((slot) => slot.entry);
  if (resolvedActs.length === 0) {
    throw new AudienceAnalysisError(
      'no act of the lineup resolved to a Qloo entity — analysis impossible',
      { code: 'no_resolved_acts', details: { failures } }
    );
  }

  const targetDomain = options.targetDomain
    ?? primaryInsightType(resolvedActs[0].category ?? 'music');
  const query = (entityIds) => insightsFn({
    targetDomain,
    entityIds,
    take,
    ...(location ? { location } : {}),
  });

  // 2. Per-act fingerprints (isolated) + the blended lineup query.
  const perActResults = await runParallelTasks(
    resolvedActs.map((act) => ({ name: act.id, run: () => query([act.id]) })),
    { concurrency: options.concurrency ?? AUDIENCE_DEFAULTS.concurrency }
  );
  let blended;
  try {
    blended = toAudience(
      { status: 'fulfilled', value: await query(resolvedActs.map((act) => act.id)) },
      take
    );
  } catch {
    blended = null;
  }
  const blendedSlot = blended === null
    ? toAudience({ status: 'rejected', reason: { code: 'upstream_error' } }, take)
    : blended;
  if (!blendedSlot.available) {
    failures.push({
      code: AUDIENCE_CODES.BLENDED_QUERY_FAILED,
      message: blendedSlot.error,
    });
  }

  const perAct = Object.freeze(resolvedActs.map((act, index) => {
    const audience = toAudience(perActResults[index], take);
    if (!audience.available) {
      failures.push({
        code: AUDIENCE_CODES.ACT_QUERY_FAILED,
        act: act.name,
        message: audience.error,
      });
    }
    return Object.freeze({ ...act, ...audience });
  }));

  // 3. CONVERGENCE: names in the top lists of >= 2 acts.
  const supporters = new Map();
  for (const act of perAct) {
    if (!act.available) continue;
    for (const row of act.top) {
      const record = supporters.get(row.name) ?? { acts: [], best: 0 };
      record.acts.push(act.name);
      if (row.affinityPercent !== null) record.best = Math.max(record.best, row.affinityPercent);
      supporters.set(row.name, record);
    }
  }
  const convergence = Object.freeze(
    [...supporters.entries()]
      .filter(([, record]) => record.acts.length >= 2)
      .sort((a, b) => b[1].acts.length - a[1].acts.length
        || b[1].best - a[1].best
        || a[0].localeCompare(b[0]))
      .map(([name, record]) => Object.freeze({
        name,
        acts: Object.freeze(record.acts),
        bestAffinityPercent: record.best > 0 ? record.best : null,
      }))
  );

  // 4. DIVERGENCE: pairwise overlap, most divergent pairs first.
  const nameSets = perAct.map((act) => new Set(act.available ? act.top.map((r) => r.name) : []));
  const pairs = [];
  for (let i = 0; i < perAct.length; i += 1) {
    for (let j = i + 1; j < perAct.length; j += 1) {
      const a = nameSets[i];
      const b = nameSets[j];
      const min = Math.min(a.size, b.size);
      let intersection = 0;
      for (const name of a) if (b.has(name)) intersection += 1;
      pairs.push(Object.freeze({
        a: perAct[i].name,
        b: perAct[j].name,
        overlapRatio: min > 0 ? round6(intersection / min) : null,
      }));
    }
  }
  const divergence = Object.freeze(pairs
    .filter((pair) => pair.overlapRatio !== null)
    .sort((x, y) => x.overlapRatio - y.overlapRatio || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)));

  return deepFreeze({
    version: AUDIENCE_ANALYSIS_VERSION,
    targetDomain,
    location,
    lineup: Object.freeze(lineup.map((slot) => slot.entry)),
    blended: blendedSlot,
    perAct,
    convergence,
    divergence,
    stats: Object.freeze({
      acts: lineup.length,
      resolvedActs: resolvedActs.length,
      availableActs: perAct.filter((act) => act.available).length,
      blendedAvailable: blendedSlot.available,
      blendedCount: blendedSlot.count,
      converged: convergence.length,
      pairs: divergence.length,
    }),
    failures: deepFreeze(failures),
  });
}

/**
 * Render the printable audience brief (deterministic, zero emojis).
 */
export function renderAudienceAnalysis(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.perAct)) {
    throw new TypeError('renderAudienceAnalysis: expected an analyzeAudience() report');
  }
  const lines = [];
  lines.push('AUDIENCE ANALYSIS');
  lines.push(`Lineup: ${report.lineup.map((act) => act.name).join(' + ')}`);
  lines.push(`Target: ${report.targetDomain}${report.location ? ` @ ${report.location}` : ''}`);

  lines.push(report.blended.available
    ? `BLENDED AUDIENCE: ${report.blended.count} affinity entit(ies)`
    : 'BLENDED AUDIENCE: unavailable (see ledger)');
  for (const row of report.blended.top) {
    lines.push(`   - ${row.name}${row.affinityPercent !== null ? ` (${row.affinityPercent}%)` : ''}`);
  }

  for (const act of report.perAct) {
    lines.push(act.available
      ? `ACT ${act.name}: ${act.count} affinity entit(ies)`
      : `ACT ${act.name}: unavailable (${act.error})`);
  }

  if (report.convergence.length > 0) {
    lines.push('AUDIENCE MAGNETS (shared by 2+ acts):');
    for (const item of report.convergence) {
      lines.push(`   - ${item.name} [${item.acts.join(', ')}]`);
    }
  }
  if (report.divergence.length > 0) {
    const worst = report.divergence[0];
    lines.push(
      `DIVERGENCE: most distinct pair "${worst.a}" vs "${worst.b}" ` +
        `(overlap ${Math.round(worst.overlapRatio * 100)}%)`
    );
  }
  lines.push(
    `LEDGER: ${report.failures.length} failure(s)` +
      `${report.stats.blendedAvailable ? '' : '; blended unavailable'}`
  );
  return lines.join('\n');
}

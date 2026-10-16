/**
 * ModeDispatcher (task 81) — the WORKING-MODE selector of the agent:
 * a pure, deterministic resolver that turns a user-chosen mode (PRD
 * section 3's three operational modes) into a frozen RUN PLAN — the
 * exact configuration the rest of the pipeline executes against.
 *
 * THE THREE MODES (docs/02_PRD_SCOPE.md section 3):
 *
 *   1. worldbuilder  — Character & Scene Dossier. The full five-layer
 *      extraction (sound, literary, material, gastronomy, visual)
 *      over the expanded affinity graph; selection prizes NON-OBVIOUS
 *      affinity (tasks 56-61 chain); output: a print-ready
 *      mise-en-scene dossier.
 *   2. activation    — Experiential Activation (live events). The
 *      headlining-artist/festival case: audience insights drive the
 *      run and the enabled layers narrow to what an activation can
 *      actually BUY or BOOK — sound (opening acts), material (brand
 *      sponsors), gastronomy (local food/beverage vendors); output: a
 *      curation list.
 *   3. antithesis    — Taste Antithesis (cultural divergence). Same
 *      layers, INVERTED selection: the plan isolates the LOWEST /
 *      negative-correlation entities (the cultural blindspot report
 *      for dramatic conflict and sponsorship-risk analysis); the
 *      affinity threshold schedule honestly does NOT apply (nothing
 *      is being accepted on affinity), hence thresholds = null.
 *
 * THE COMMON LADDER: every mode runs the same six-phase dossier
 * pipeline (AgentPhases, task 42) — a mode CONFIGURES the run, it
 * never forks the phase machine. The plan carries the phase order by
 * reference so consumers and consistency tests share one truth.
 *
 * INGRESS (tolerant, same discipline as SeedResolver task 45):
 *   - null/undefined/empty string -> the documented DEFAULT_MODE
 *     (worldbuilder — the flagship PRD mode);
 *   - a mode id or a case/spacing-insensitive ALIAS ("Taste Antithesis"
 *     -> "taste_antithesis" -> antithesis) via the exported table;
 *   - an object with a string `mode` key (the HTTP/MCP request shape).
 *   An unknown but well-formed STRING is DATA -> typed
 *   InvalidModeError (code `unknown_mode`, machine-readable details);
 *   a wrong TYPE (number, array, ...) is a PROGRAMMER error ->
 *   TypeError. The same split the FSM (task 41) applies.
 *
 * DETERMINISM: no I/O, no clocks, no RNG; resolveMode/dispatchMode
 * are total functions over their ingress contract; identical input ->
 * deep-equal frozen output (pinned by server/test/modeDispatcher.js).
 */

import { PHASE_ORDER } from './AgentPhases.js';
import { THRESHOLD_DEFAULTS } from './AdaptiveThreshold.js';
import { MANDATORY_DOMAINS } from '../services/domainMapper.js';

/** Mode identifiers (exported constants — no string literals elsewhere). */
export const MODE_WORLDBUILDER = 'worldbuilder';
export const MODE_ACTIVATION = 'activation';
export const MODE_ANTITHESIS = 'antithesis';

/** The documented default when no mode is supplied. */
export const DEFAULT_MODE = MODE_WORLDBUILDER;

/**
 * Extraction-layer -> agent-domain mapping. The five layers (tasks
 * 51-55) each feed one of MANDATORY_DOMAINS; exported so the
 * consistency test pins dispatcher plans against domainMapper.
 */
export const LAYER_DOMAINS = Object.freeze({
  sound: 'music',
  literary: 'books',
  material: 'fashion',
  gastronomy: 'dining',
  visual: 'film',
});

/** Selection strategies (the math chain runs in one of two directions). */
export const SELECTION_STRATEGIES = Object.freeze({
  NON_OBSVIOUS_AFFINITY: 'non_obvious_affinity',
  LOWEST_CORRELATION: 'lowest_correlation',
});

/** Machine-readable failure reasons. */
export const MODE_REASONS = Object.freeze({
  UNKNOWN_MODE: 'unknown_mode',
});

/** Typed error: a well-formed mode reference the registry rejects. */
export class InvalidModeError extends Error {
  constructor(message, { reason, details, cause } = undefined) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'InvalidModeError';
    this.reason = reason;
    this.details = details;
  }
}

/**
 * The mode registry. Each entry documents what the pipeline run DOES:
 * which extraction layers are enabled (in extraction order), which
 * selection direction the math chain takes, whether audience insights
 * are an required upstream leg, and whether the antithesis leg is
 * required. Frozen at load.
 */
export const MODES = Object.freeze({
  [MODE_WORLDBUILDER]: Object.freeze({
    id: MODE_WORLDBUILDER,
    label: 'Worldbuilder (Character & Scene Dossier)',
    output: 'mise_en_scene_dossier',
    layers: Object.freeze(['sound', 'literary', 'material', 'gastronomy', 'visual']),
    selection: SELECTION_STRATEGIES.NON_OBSVIOUS_AFFINITY,
    requires: Object.freeze({ audienceInsights: false, antithesis: false }),
    thresholds: Object.freeze({ ...THRESHOLD_DEFAULTS }),
  }),
  [MODE_ACTIVATION]: Object.freeze({
    id: MODE_ACTIVATION,
    label: 'Experiential Activation (Live Events)',
    output: 'activation_curation',
    layers: Object.freeze(['sound', 'material', 'gastronomy']),
    selection: SELECTION_STRATEGIES.NON_OBSVIOUS_AFFINITY,
    requires: Object.freeze({ audienceInsights: true, antithesis: false }),
    thresholds: Object.freeze({ ...THRESHOLD_DEFAULTS }),
  }),
  [MODE_ANTITHESIS]: Object.freeze({
    id: MODE_ANTITHESIS,
    label: 'Taste Antithesis (Cultural Divergence)',
    output: 'cultural_blindspot_report',
    layers: Object.freeze(['sound', 'literary', 'material', 'gastronomy', 'visual']),
    selection: SELECTION_STRATEGIES.LOWEST_CORRELATION,
    requires: Object.freeze({ audienceInsights: false, antithesis: true }),
    // Honest data handling: the affinity threshold schedule (task 67)
    // GATES ACCEPTANCE on affinity — an antithesis run SELECTS the
    // weakest/negative correlations, so no threshold applies.
    thresholds: null,
  }),
});

/**
 * Documented alias table: PRD names and common spellings normalize to
 * registry ids. Normalization before lookup: trim, lowercase, collapse
 * spaces/dashes to underscores.
 */
export const MODE_ALIASES = Object.freeze({
  worldbuilder: MODE_WORLDBUILDER,
  world_builder: MODE_WORLDBUILDER,
  dossier: MODE_WORLDBUILDER,
  mise_en_scene: MODE_WORLDBUILDER,
  activation: MODE_ACTIVATION,
  experiential_activation: MODE_ACTIVATION,
  experiential: MODE_ACTIVATION,
  live_events: MODE_ACTIVATION,
  live: MODE_ACTIVATION,
  events: MODE_ACTIVATION,
  antithesis: MODE_ANTITHESIS,
  taste_antithesis: MODE_ANTITHESIS,
  divergence: MODE_ANTITHESIS,
  cultural_divergence: MODE_ANTITHESIS,
  blindspot: MODE_ANTITHESIS,
});

const normalizeToken = (value) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Predicate: does this value resolve to a registered mode? */
export const isModeId = (value) => {
  if (typeof value !== 'string') return false;
  const token = normalizeToken(value);
  if (token === '') return true; // blank ingress resolves to DEFAULT_MODE
  if (Object.hasOwn(MODES, token)) return true;
  const byAlias = MODE_ALIASES[token];
  return byAlias !== undefined && Object.hasOwn(MODES, byAlias);
};

/**
 * Resolve any supported ingress to a canonical mode id.
 * Throws: TypeError (wrong type / object without string `mode`),
 * InvalidModeError (well-formed string the registry rejects).
 */
export function resolveMode(input) {
  if (input === null || input === undefined) return DEFAULT_MODE;

  if (typeof input === 'object' && !Array.isArray(input)) {
    if (typeof input.mode !== 'string') {
      throw new TypeError('resolveMode: object ingress requires a string `mode` key');
    }
    return resolveMode(input.mode);
  }

  if (typeof input !== 'string') {
    throw new TypeError(
      `resolveMode: expected a mode id string or {mode} object, received ${typeof input}`
    );
  }

  const token = normalizeToken(input);
  if (token === '') return DEFAULT_MODE;

  const byAlias = MODE_ALIASES[token];
  if (byAlias !== undefined && Object.hasOwn(MODES, byAlias)) return byAlias;
  if (Object.hasOwn(MODES, token)) return token;

  throw new InvalidModeError(`Unknown agent mode: ${input}`, {
    reason: MODE_REASONS.UNKNOWN_MODE,
    details: { input, known: Object.keys(MODES) },
  });
}

/** UI/MCP surface: the registry as a frozen summary list. */
export function listModes() {
  return Object.freeze(
    Object.values(MODES).map((mode) =>
      Object.freeze({ id: mode.id, label: mode.label, output: mode.output })
    )
  );
}

/**
 * Dispatch a mode to its frozen RUN PLAN. The plan pins, per mode:
 * the enabled extraction layers, their agent domains (ordered by the
 * MANDATORY_DOMAINS contract), the selection strategy the math chain
 * executes, required upstream legs, the threshold schedule (or an
 * honest null), and the common six-phase ladder by reference.
 */
export function dispatchMode(input) {
  const mode = resolveMode(input);
  const config = MODES[mode];

  const domains = MANDATORY_DOMAINS.filter((domain) =>
    config.layers.some((layer) => LAYER_DOMAINS[layer] === domain)
  );

  return Object.freeze({
    mode: config.id,
    label: config.label,
    output: config.output,
    layers: config.layers,
    domains: Object.freeze(domains),
    selection: config.selection,
    requires: config.requires,
    thresholds: config.thresholds,
    phases: PHASE_ORDER,
  });
}

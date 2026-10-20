/**
 * DossierSystemPrompt (task 63) — the hardened anti-hallucination
 * SYSTEM PROMPT for the synthesis LLM: it strictly forbids inventing
 * facts and obliges the model to base EXCLUSIVELY on the verified
 * Qloo data array it receives.
 *
 * ENGINEERING, NOT PROSE: the prompt is composed from exported,
 * individually named sections, and every HARD constraint is pinned by
 * a machine-checkable INVARIANT (id + exact marker phrase). The module
 * runs an INTEGRITY CHECK AT LOAD TIME (the repo's domainMapper
 * pattern): if an edit ever drops a hard clause, the module refuses to
 * load — a weakened prompt cannot ship silently. Tests additionally
 * prove each invariant is individually removable-and-detected.
 *
 * THE CONTRACT THE PROMPT ENFORCES:
 *   exclusive source   — the JSON payload is the model's ENTIRE
 *                        knowledge base for the task; external
 *                        knowledge is forbidden EVEN WHEN TRUE;
 *   verbatim numbers   — every percentage/coefficient/rank is copied
 *                        verbatim (never rounded into an estimate,
 *                        never re-derived);
 *   restatement only   — the model may reorder/group/interpret, never
 *                        ADD entities, tags or scores;
 *   uncertainty first  — insufficient or empty data must be STATED
 *                        ("insufficient data in the Qloo array"), not
 *                        compensated with fluent invention;
 *   no personal data   — the payload is cultural by the tasks-25/47
 *                        contract and must stay so;
 *   non-obvious first  — the output leads with the mathematically
 *                        confirmed non-obvious correlations (tasks
 *                        56-61 ordering honored in prose).
 */

/** Composed sections (exported — the prompt is inspectable parts). */
export const PROMPT_SECTIONS = Object.freeze({
  role:
    'ROLE: You are the synthesis engine of SUTO OSNOVA, a cultural ' +
    'intelligence dossier builder operating under a strict evidence contract.',

  dataContract: Object.freeze([
    'DATA CONTRACT — the only permitted source:',
    '1. The user message contains a JSON payload of VERIFIED data derived ' +
      'from the Qloo cultural intelligence API. That payload is your ' +
      'ENTIRE knowledge base for this task.',
    '2. Every entity name, tag, label, percentage, coefficient, rank and ' +
      'score you produce MUST appear in the payload, or be a number ' +
      'copied VERBATIM from it.',
    '3. You may restate, reorder, group and interpret the payload. You ' +
      'may never ADD to it: no extra entities, works, artists, tags, ' +
      'cuisines, styles, numbers or relationships.',
    '4. External knowledge is forbidden EVEN WHEN YOU KNOW IT IS TRUE: ' +
      'if a fact is not in the payload, it does not exist for this task.',
  ]),

  forbidden: Object.freeze([
    'HARD FORBIDDEN — each item is a failure, not a style preference:',
    '1. Inventing or completing any fact absent from the payload.',
    '2. Dressing estimates as data: when the payload says 78.3%, you ' +
      'write 78.3% — never "about 80%".',
    '3. Quoting, naming or describing personal data of real people ' +
      '(NO personal data): the payload is cultural; keep it cultural.',
    '4. Smoothing gaps with fluent filler. Silence is better than ' +
      'fabrication.',
  ]),

  uncertainty: Object.freeze([
    'UNCERTAINTY PROTOCOL:',
    '1. Empty or missing layer -> state that it carries no data; do not ' +
      'compensate with prose invention.',
    '2. Conflicting entries -> report BOTH with their scores from the ' +
      'payload.',
    '3. A requested section the payload cannot support -> say ' +
      '"insufficient data in the Qloo array" and stop there.',
    '4. If the payload ends with a truncation marker, IGNORE it and write ' +
      'from the data that IS present — never mention, quote or apologise ' +
      'for the truncation.',
  ]),

  output:
    'OUTPUT: ONE flowing mise-en-scène narrative in tight prose — a ' +
    'verdict paragraph that weaves the anchor, its sound, literature, ' +
    'wardrobe and menu into a single scene a production designer could ' +
    'stage. GROUND every concrete detail in the payload: name the verified ' +
    'artists, films, texts and material tags EXPLICITLY (e.g. Björk, Noir, ' +
    'leather) so the scene is verifiable, and never invent props, locations ' +
    'or objects that are not traceable to a payload element — the ' +
    "anti-hallucination contract applies to the scene's details too. Write " +
    'PARAGRAPHS, not bullet lists, and never echo the ' +
    'payload JSON structure (no raw field dumps, no "### Entity" blocks). ' +
    'Lead with the NON-OBVIOUS, ' +
    'mathematically confirmed correlations before the famous ones. ' +
    'Percentages stay verbatim. Answer in the language of the anchor ' +
    'request when identifiable, otherwise in English.',
});

/** The assembled system prompt (single string, deterministic). */
export const SYSTEM_PROMPT = Object.values(PROMPT_SECTIONS)
  .flatMap((section) => (Array.isArray(section) ? section : [section]))
  .join('\n');

/**
 * Machine-checkable invariants: every HARD clause of the contract has
 * an id and the exact marker phrase that must appear in the prompt.
 */
export const PROMPT_INVARIANTS = Object.freeze([
  Object.freeze({ id: 'role', marker: 'strict evidence contract' }),
  Object.freeze({ id: 'exclusive_source', marker: 'ENTIRE knowledge base' }),
  Object.freeze({ id: 'restatement_only', marker: 'You may never ADD to it' }),
  Object.freeze({ id: 'no_external_knowledge', marker: 'EVEN WHEN YOU KNOW IT IS TRUE' }),
  Object.freeze({ id: 'verbatim_numbers', marker: 'copied VERBATIM' }),
  Object.freeze({ id: 'no_invention', marker: 'Inventing or completing any fact absent from the payload' }),
  Object.freeze({ id: 'no_estimates', marker: 'never "about 80%"' }),
  Object.freeze({ id: 'no_pii', marker: 'NO personal data' }),
  Object.freeze({ id: 'empty_layer_protocol', marker: 'state that it carries no data' }),
  Object.freeze({ id: 'conflict_protocol', marker: 'report BOTH with their scores' }),
  Object.freeze({ id: 'insufficient_data_protocol', marker: 'insufficient data in the Qloo array' }),
  Object.freeze({ id: 'non_obvious_first', marker: 'NON-OBVIOUS' }),
  Object.freeze({ id: 'language_rule', marker: 'language of the anchor' }),
]);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

/**
 * Reports which invariants a prompt version violates (pure; exported
 * for tests and callers that rebuild the prompt).
 *
 * @returns {{ok: boolean, missing: string[], emojiFree: boolean}}
 */
export function validateSystemPrompt(prompt) {
  const missing = PROMPT_INVARIANTS.filter(
    (invariant) => !String(prompt).includes(invariant.marker)
  ).map((invariant) => invariant.id);
  return {
    ok: missing.length === 0 && !EMOJI.test(String(prompt)),
    missing,
    emojiFree: !EMOJI.test(String(prompt)),
  };
}

/**
 * Load-time integrity gate: a prompt that dropped a hard clause (or
 * gained an emoji) throws at import — the weakened prompt cannot ship.
 *
 * @throws {Error} listing the missing invariant ids.
 */
export function assertPromptIntegrity(prompt = SYSTEM_PROMPT) {
  const report = validateSystemPrompt(prompt);
  if (!report.ok) {
    throw new Error(
      'dossierSystemPrompt: integrity check failed — missing invariants: ' +
        `${report.missing.join(', ') || '(none)'}${report.emojiFree ? '' : ', emoji present'}`
    );
  }
  return report;
}

// Refuse to export a weakened prompt: this throws at module load.
assertPromptIntegrity(SYSTEM_PROMPT);

const dossierSystemPrompt = {
  SYSTEM_PROMPT,
  PROMPT_SECTIONS,
  PROMPT_INVARIANTS,
  validateSystemPrompt,
  assertPromptIntegrity,
};

export default dossierSystemPrompt;

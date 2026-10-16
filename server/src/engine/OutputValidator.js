/**
 * OutputValidator (task 64) — deterministic POST-HOC validation of the
 * LLM's prose against the input Qloo entity array: the backstop that
 * catches hallucinated NAMES the hardened prompt (task 63) could not
 * prevent.
 *
 * THE METHOD (no NER model — pure, reproducible text algebra):
 *   1. collectKnownNames(payload) — recursively harvests every `name`
 *      and `title` string from the dossier JSON (entities, tags,
 *      genres, artists, venues — all extractor shapes) into a
 *      normalized set (lowercase, whitespace-collapsed, trailing
 *      parentheticals/quotes stripped);
 *   2. extractMentions(prose) — two deterministic forms:
 *        quoted      — text inside "...", «...”, “...” (strongest:
 *                      an explicit citation);
 *        title_case  — runs of >= 2 capitalized word-tokens (Unicode
 *                      \p{Lu}, so Ukrainian prose works the same),
 *                      with leading function words (EN + UK
 *                      stopwords) trimmed;
 *   3. membership — a mention MATCHES when its normalized form equals
 *      a known name, strips into one (trailing year/parenthetical),
 *      or CONTAINS/IS-CONTAINED-BY a known name (>= 4 chars each side
 *      — "Blade Runner Final Cut" covers "Blade Runner", "Matrix" is
 *      NOT excused for "The Matrix" unless quoted exactly). Two
 *      adjacency guards keep Ukrainian/English prose honest: a
 *      title-case run that SWALLOWS an already-quoted name is
 *      suppressed (the quote is checked on its own), and a run whose
 *      TAIL covers a known name is anchored to real data ("Досьє
 *      Vangelis" passes on its Vangelis tail; "Christopher Nolan"
 *      still fails).
 *
 * VERDICT: {ok, checked, matched, knownCount, hallucinated:[{mention,
 * form, index}]}. ok=false means: review required — a name-shaped
 * phrase the Qloo payload never contained. The validator is a REVIEW
 * GATE, not an oracle: single capitalized words mid-sentence are
 * deliberately NOT extracted (too ambiguous — quoting covers them).
 *
 * Pure engine module: no I/O, no clocks, no RNG.
 */

/** Options contract (exported tuning). */
export const VALIDATOR_DEFAULTS = Object.freeze({
  includeTitleCase: true,
  minRunLength: 2,
  maxMentionLength: 80,
});

/** Function words (EN + UK) trimmed from the head of title-case runs. */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with',
  'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'it',
  'its', 'as', 'by', 'at', 'from', 'but', 'not', 'no', 'yes', 'be',
  'в', 'і', 'а', 'або', 'це', 'цей', 'ця', 'ці', 'та', 'у', 'на',
  'для', 'до', 'що', 'як', 'не', 'з', 'про', 'від', 'зі', 'із',
]);

const normalizeForMatch = (value) =>
  String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .replace(/^[\s"'«»“”‘’.,:;!?—–-]+/, '')
    .replace(/[\s"'«»“”‘’.,:;!?—–-]+$/, '')
    .trim();

/**
 * Recursively collects the known-name set from a dossier payload:
 * every string under a `name`/`title` key, normalized and deduped.
 *
 * @returns {ReadonlySet<string>} frozen-contents set of normalized names.
 */
export function collectKnownNames(payload) {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === 'name' || key === 'title') &&
        typeof child === 'string' &&
        child.trim().length > 0
      ) {
        const normalized = normalizeForMatch(child);
        if (normalized.length > 0) names.add(normalized);
      } else {
        visit(child);
      }
    }
  };
  visit(payload);
  return names;
}

const QUOTED = /["“«]([^"“”«»]{2,80})["”»]/gu;
const NAME_TOKEN = /^[\p{Lu}][\p{L}\p{M}'’.\-]*$/u;

/**
 * Extracts name-shaped mention candidates from prose. Deterministic:
 * quoted segments + capitalized runs (>= minRunLength tokens after
 * trimming leading stopwords).
 *
 * @returns {ReadonlyArray<{mention: string, form: 'quoted'|
 *          'title_case', index: number}>}
 */
export function extractMentions(prose, options = {}) {
  const {
    includeTitleCase = VALIDATOR_DEFAULTS.includeTitleCase,
    minRunLength = VALIDATOR_DEFAULTS.minRunLength,
    maxMentionLength = VALIDATOR_DEFAULTS.maxMentionLength,
  } = options;

  const text = typeof prose === 'string' ? prose : '';
  const found = [];
  const seen = new Set();

  const push = (mention, form, index) => {
    const normalized = normalizeForMatch(mention);
    if (normalized.length < 2 || normalized.length > maxMentionLength) return;
    const key = `${form}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ mention: mention.trim(), form, index });
  };

  for (const match of text.matchAll(QUOTED)) {
    push(match[1], 'quoted', match.index);
  }

  if (includeTitleCase) {
    // A capitalized run that SWALLOWS an already-quoted name adds no
    // information ("Фільм «Матриця»" — the quote is checked on its
    // own) and is suppressed to avoid adjacency false positives.
    const quotedNorms = found
      .filter((m) => m.form === 'quoted')
      .map((m) => normalizeForMatch(m.mention));

    const tokens = text.split(/\s+/);
    let offset = 0;
    let run = [];
    let runStart = 0;

    const flush = () => {
      if (run.length > 0) {
        while (run.length > 0 && STOPWORDS.has(run[0].toLowerCase())) run.shift();
        if (run.length >= minRunLength) {
          const joined = run.join(' ');
          const normalized = normalizeForMatch(joined);
          if (!quotedNorms.some((q) => normalized.includes(q))) {
            push(joined, 'title_case', runStart);
          }
        }
      }
      run = [];
    };

    for (const token of tokens) {
      const clean = token.replace(
        /^[^\p{L}\p{N}]+|[^\p{L}\p{N})’'.\-]+$/gu,
        ''
      );
      if (clean.length > 0 && NAME_TOKEN.test(clean)) {
        if (run.length === 0) runStart = offset;
        run.push(clean);
      } else {
        flush();
      }
      offset += token.length + 1;
    }
    flush();
  }

  return Object.freeze(found);
}

/** True when a normalized mention is covered by the known-name set. */
function isKnown(mention, knownNames, form) {
  if (knownNames.has(mention)) return true;
  const covered = (candidate) => {
    if (candidate.length < 4) return false;
    for (const known of knownNames) {
      if (known.length < 4) continue;
      if (known.startsWith(candidate) || candidate.startsWith(known)) return true;
    }
    return false;
  };
  if (covered(mention)) return true;

  // SUFFIX ANCHORING (title_case only): a capitalized run may carry a
  // common-word preamble ("Досьє Vangelis", "Фільм Матриця") — when
  // its TAIL covers a known name, the run is anchored to real data.
  if (form === 'title_case') {
    const tokens = mention.split(' ');
    for (let k = 1; k < tokens.length; k += 1) {
      const suffix = tokens.slice(k).join(' ');
      if (knownNames.has(suffix) || covered(suffix)) return true;
    }
  }
  return false;
}

/**
 * Validates LLM prose against the input Qloo payload.
 *
 * @param {string} text the model output.
 * @param {object} payload the SAME dossier payload sent to the model.
 * @param {object} [options] VALIDATOR_DEFAULTS overrides.
 * @returns {Readonly<{ok, checked, matched, knownCount, hallucinated:
 *          Array<{mention, form, index}>}>} frozen; ok=false => review
 *          required (name-shaped phrase absent from the payload).
 */
export function validateSynthesis(text, payload, options = {}) {
  const resolved = { ...VALIDATOR_DEFAULTS, ...options };
  const knownNames = collectKnownNames(payload);
  const mentions = extractMentions(text, resolved);

  const hallucinated = [];
  let matched = 0;

  for (const candidate of mentions) {
    if (isKnown(normalizeForMatch(candidate.mention), knownNames, candidate.form)) {
      matched += 1;
    } else {
      hallucinated.push(
        Object.freeze({
          mention: candidate.mention,
          form: candidate.form,
          index: candidate.index,
        })
      );
    }
  }

  return Object.freeze({
    ok: hallucinated.length === 0,
    checked: mentions.length,
    matched,
    knownCount: knownNames.size,
    hallucinated: Object.freeze(hallucinated),
  });
}

const outputValidator = {
  validateSynthesis,
  collectKnownNames,
  extractMentions,
  VALIDATOR_DEFAULTS,
  STOPWORDS,
};

export default outputValidator;

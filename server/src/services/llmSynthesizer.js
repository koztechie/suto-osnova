/**
 * LlmSynthesizer (task 62) — the DOSSIER_SYNTHESIS bridge: direct
 * calls to an OpenAI-COMPATIBLE chat completions API (the de-facto
 * standard the hackathon models expose) that turn the deterministic
 * dossier data (tasks 41-61) into natural language.
 *
 * BOUNDARY CONTRACT: everything UPSTREAM of this module is pure and
 * deterministic (engine math, verified Qloo data, privacy-guarded
 * text); everything DOWNSTREAM is prose. The module itself adds NO
 * logic of its own — it builds a bounded prompt, performs ONE HTTP
 * call, and validates the response shape.
 *
 * PROMPT (buildSynthesisPrompt, pure and exported):
 *   - system message: the synthesizer persona and hard rules (use the
 *     provided percentages verbatim, name the non-obvious correlations
 *     first, never invent entities, NO personal data — the dossier
 *     payload is cultural by the tasks-25/47 contract);
 *   - user message: the dossier as JSON, with every top-level array
 *     bounded to `maxEntriesPerLayer` (default 25) and the whole blob
 *     capped at `maxPromptChars` (default 24000) with an explicit
 *     truncation marker — token burn stays bounded by construction.
 *
 * TRANSPORT: POST {LLM_BASE_URL}/chat/completions with
 * `Authorization: Bearer LLM_API_KEY` (a CREDENTIAL — accepted
 * verbatim, never logged), {model, messages, temperature (0.2: prose
 * consistency over creativity), max_tokens}. A per-call AbortController
 * bounds the WAIT (default 30s). The fetch function is INJECTABLE —
 * the whole module is testable with zero network.
 *
 * CONFIG (config/env.js, optional by design — the server boots and
 * serves WITHOUT it): LLM_API_KEY (absent -> typed
 * `llm_not_configured` at call time, never at boot), LLM_BASE_URL
 * (default https://api.openai.com/v1), LLM_MODEL (default
 * gpt-4o-mini).
 *
 * FAILURE MODEL (typed LlmSynthesisError): not_configured, timeout,
 * http_error (non-2xx with status), upstream_error (transport, cause
 * preserved), malformed_response (no usable content — including
 * content-parts arrays, which are joined). Response `usage` is
 * captured when present.
 */

import { env } from '../config/env.js';
import { SYSTEM_PROMPT } from './dossierSystemPrompt.js';

// The hardened anti-hallucination prompt (task 63) is the single
// source of truth in dossierSystemPrompt — re-exported here so the
// synthesizer surface stays one import.
export { SYSTEM_PROMPT };

/** Typed error for synthesis failures. */
export class LlmSynthesisError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'LlmSynthesisError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const LLM_CODES = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  TIMEOUT: 'timeout',
  HTTP_ERROR: 'http_error',
  UPSTREAM_ERROR: 'upstream_error',
  MALFORMED_RESPONSE: 'malformed_response',
});

/** Documented defaults (exported tuning contract). */
export const LLM_DEFAULTS = Object.freeze({
  temperature: 0.2,
  maxTokens: 1200,
  timeoutMs: 30_000,
  maxEntriesPerLayer: 8,
  maxPromptChars: 24_000,
});

const MAX_PROMPT_DECIMALS = 4;

/**
 * Rounds a float to a sane precision for the PROMPT. This is NOT the
 * LLM rounding an estimate (the contract forbids that) — it PRESENTS
 * the measured value at a readable precision, so the model copies a
 * clean number (0.9455) verbatim instead of 16 noise decimals
 * (0.9454803725829012). It also shrinks the payload, which is what
 * caused prompt truncation on data-heavy dossiers.
 */
const roundNum = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 10 ** MAX_PROMPT_DECIMALS) / 10 ** MAX_PROMPT_DECIMALS
    : value;

/**
 * Recursively bounds EVERY array (nested ones included — the old
 * top-level-only bound let genreTags/edges balloon the payload past
 * maxPromptChars, truncating it mid-JSON and making the model narrate
 * the truncation) and rounds floats.
 */
const boundAndRound = (value, maxEntries) => {
  if (Array.isArray(value)) {
    return value.slice(0, maxEntries).map((entry) => boundAndRound(entry, maxEntries));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = boundAndRound(entry, maxEntries);
    return out;
  }
  return roundNum(value);
};

/**
 * Builds the bounded synthesis prompt (pure, exported, tested).
 *
 * @param {object} dossier the deterministic dossier record.
 * @param {object} [options] {maxEntriesPerLayer, maxPromptChars}.
 * @returns {Readonly<{system: string, user: string, truncated:
 *          boolean, bytes: number}>} frozen.
 */
export function buildSynthesisPrompt(dossier, options = {}) {
  const {
    maxEntriesPerLayer = LLM_DEFAULTS.maxEntriesPerLayer,
    maxPromptChars = LLM_DEFAULTS.maxPromptChars,
  } = options;

  const bounded = {};
  for (const [key, value] of Object.entries(dossier ?? {})) {
    bounded[key] = boundAndRound(value, maxEntriesPerLayer);
  }

  let payload = JSON.stringify(bounded);
  let truncated = false;
  if (payload.length > maxPromptChars) {
    payload = `${payload.slice(0, maxPromptChars)}\n...[truncated]`;
    truncated = true;
  }

  return Object.freeze({
    system: SYSTEM_PROMPT,
    user: `Dossier data (JSON):\n${payload}`,
    truncated,
    bytes: payload.length,
  });
}

/**
 * Reads the LLM config at CALL time (env is loaded once per process).
 * Explicit options override the environment — intended for tests and
 * self-hosted endpoints; the credential is never echoed anywhere.
 */
function llmConfig(overrides) {
  const intFromEnv = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  };
  return {
    apiKey: overrides.apiKey ?? (typeof env.LLM_API_KEY === 'string' ? env.LLM_API_KEY : ''),
    baseUrl: overrides.baseUrl ?? env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    model: overrides.model ?? env.LLM_MODEL ?? 'gpt-4o-mini',
    // Tunable without a code change: reasoning-capable models spend
    // max_tokens on their thinking and can leave `content` EMPTY if the
    // budget is too small — raise LLM_MAX_TOKENS for those.
    maxTokens: intFromEnv(env.LLM_MAX_TOKENS, LLM_DEFAULTS.maxTokens),
    timeoutMs: intFromEnv(env.LLM_TIMEOUT_MS, LLM_DEFAULTS.timeoutMs),
  };
}

/** Tolerant content extraction: string, content-parts array, or an
 *  object with a text field. Reasoning models sometimes return the
 *  answer under a different key; we deliberately do NOT fall back to
 *  the reasoning/thinking field (that is not the final answer). */
function extractContent(payload) {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
    if (joined.length > 0) return joined;
  }
  if (content && typeof content === 'object' && typeof content.text === 'string' && content.text.length > 0) {
    return content.text;
  }
  // Legacy completions shape (some OpenAI-compatible endpoints).
  const legacy = payload?.choices?.[0]?.text;
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return null;
}

const defaultFetch = (url, init) => fetch(url, init);

/**
 * Synthesizes natural-language prose from a deterministic dossier.
 *
 * @param {object} dossier the dossier record (anchor + layers).
 * @param {object} [options] model/temperature/maxTokens/timeoutMs/
 *        maxEntriesPerLayer/maxPromptChars overrides; injectable
 *        fetchFn for tests.
 * @returns {Promise<Readonly<{text, model, usage, mode, prompt}>>}
 *          frozen record; usage null when the API omitted it.
 * @throws {LlmSynthesisError} not_configured | timeout | http_error |
 *         upstream_error | malformed_response.
 */
export async function synthesizeDossier(dossier, options = {}) {
  const {
    temperature = LLM_DEFAULTS.temperature,
    fetchFn = defaultFetch,
    ...promptOptions
  } = options;

  const config = llmConfig(options);
  if (config.apiKey.length === 0) {
    throw new LlmSynthesisError(
      'LLM synthesis is not configured (set LLM_API_KEY; the server ' +
        'runs without it, synthesis fails at call time by design)',
      { code: LLM_CODES.NOT_CONFIGURED }
    );
  }
  // Explicit option > env (LLM_MAX_TOKENS/LLM_TIMEOUT_MS) > default.
  const maxTokens = options.maxTokens ?? config.maxTokens;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;

  const prompt = buildSynthesisPrompt(dossier, promptOptions);
  const body = {
    model: promptOptions.model ?? config.model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchFn(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError' || controller.signal.aborted) {
      throw new LlmSynthesisError(
        `LLM synthesis exceeded ${timeoutMs}ms`,
        { code: LLM_CODES.TIMEOUT, details: { timeoutMs }, cause }
      );
    }
    throw new LlmSynthesisError('LLM transport failure', {
      code: LLM_CODES.UPSTREAM_ERROR,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response || typeof response.ok !== 'boolean') {
    throw new LlmSynthesisError('LLM response was not a fetch response', {
      code: LLM_CODES.MALFORMED_RESPONSE,
    });
  }
  if (!response.ok) {
    throw new LlmSynthesisError(
      `LLM endpoint answered HTTP ${response.status}`,
      { code: LLM_CODES.HTTP_ERROR, details: { status: response.status } }
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new LlmSynthesisError('LLM response was not valid JSON', {
      code: LLM_CODES.MALFORMED_RESPONSE,
      cause,
    });
  }

  // OpenAI-compatible endpoints (incl. OpenRouter) can return HTTP 200
  // with an embedded `error` object when the upstream fails or the free
  // tier rate-limits — surface THAT message instead of a vague failure.
  if (payload?.error) {
    const detail =
      typeof payload.error === 'string' ? payload.error : (payload.error.message ?? JSON.stringify(payload.error));
    throw new LlmSynthesisError(`LLM upstream error: ${detail}`, {
      code: LLM_CODES.UPSTREAM_ERROR,
      details: { provider: payload.error.type ?? null, status: payload.error.code ?? null },
    });
  }

  const text = extractContent(payload);
  if (text === null) {
    // Include a diagnostic shape so the NEXT failure reveals whether the
    // model returned reasoning-only, an empty message, or another shape.
    const shape = JSON.stringify(payload?.choices?.[0]?.message ?? payload?.choices?.[0] ?? payload).slice(0, 300);
    throw new LlmSynthesisError(
      `LLM response carried no usable message content (shape: ${shape})`,
      { code: LLM_CODES.MALFORMED_RESPONSE, details: { shape } }
    );
  }

  const usage = payload?.usage && typeof payload.usage === 'object'
    ? Object.freeze({
        promptTokens: Number.isFinite(payload.usage.prompt_tokens)
          ? payload.usage.prompt_tokens
          : null,
        completionTokens: Number.isFinite(payload.usage.completion_tokens)
          ? payload.usage.completion_tokens
          : null,
      })
    : null;

  return Object.freeze({
    text,
    model: typeof payload?.model === 'string' ? payload.model : body.model,
    usage,
    mode: 'live',
    prompt: Object.freeze({ bytes: prompt.bytes, truncated: prompt.truncated }),
  });
}

const llmSynthesizer = {
  synthesizeDossier,
  buildSynthesisPrompt,
  LlmSynthesisError,
  LLM_CODES,
  LLM_DEFAULTS,
  SYSTEM_PROMPT,
};

export default llmSynthesizer;

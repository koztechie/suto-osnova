/**
 * Privacy guard: guarantees Qloo's foundational rule — ZERO personal data
 * (names, emails, IP addresses, phones …) in outbound requests.
 *
 * Qloo is a privacy-first cultural intelligence API: it models TASTE of
 * cultural entities, never individuals. Sending user PII to Qloo would
 * violate both the product philosophy and the hackathon data rules. This
 * module is the enforcement point, applied at TWO layers:
 *
 * 1. TRANSPORT LAYER (automatic, wired into `qlooClient.qlooRequest`):
 *    every outgoing request's query params and JSON body pass through
 *    `sanitizeTransportValue` — a deep walk that redacts UNAMBIGUOUS PII
 *    patterns in string values AND in object keys that are themselves
 *    PII (e.g. a map keyed by email addresses). Headers are deliberately
 *    NOT touched: `X-Api-Key` is a credential, not personal data, and
 *    redacting it would break authentication. The guard is unconditional
 *    — a guarantee cannot have an off switch; `X-Api-Key`-style secrets
 *    are excluded from the redaction set precisely so the guard never
 *    breaks legitimate traffic.
 *
 * 2. INPUT BOUNDARY (`sanitizeInput` / `assertNoPersonalData`): for API
 *    handlers accepting user payloads. Adds a KEY DENYLIST on top of the
 *    pattern redaction: fields like `email`, `user`, `first_name`,
 *    `phone`, `ssn`, `address` are redacted wholesale — including their
 *    nested subtrees — because a structured personal field cannot be
 *    reliably distinguished from legitimate data by patterns alone.
 *
 * What is redacted automatically (unambiguous in ANY context):
 *   email, ipv4, ipv6, ssn, credit card (Luhn-verified), JWT, phone.
 *
 * What is DETECT-ONLY (reported, never auto-redacted): name-like
 * self-disclosure phrases ("my name is …"). Reason: this agent's domain
 * IS cultural titles containing conversational English — Eminem's song
 * "My Name Is", Logic's "1-800-273-8255", Taylor Swift's album "1989",
 * "Beverly Hills 90210" — and blind name/phone heuristics would mangle
 * legitimate entity queries. Patterns cannot prove a string is a person;
 * personal NAMES are therefore guaranteed at the input-boundary layer
 * (key denylist: name/first_name/… fields), while free text gets
 * detection + reporting so the caller can react. The phone pattern IS
 * redacted by default (phones rarely appear as entity names; tune via
 * `options.phones` if a title collides).
 *
 * Findings never echo the raw PII: every finding carries a MASKED
 * preview (first/last 2 chars) so reports and logs stay clean.
 */

/** PII classes the guard knows about. */
export const PII_TYPES = Object.freeze([
  'email',
  'ipv4',
  'ipv6',
  'ssn',
  'credit_card',
  'jwt',
  'phone',
  'name_hint',
  'denylisted_key',
]);

export const REDACTED = '[REDACTED]';

/**
 * Unambiguous PII patterns. Order matters: cards (Luhn-verified) run
 * BEFORE phones so a 16-digit card never degrades into a phone hit.
 * IPv6 requires either "::" compression or the full 8-group form, which
 * keeps timestamps like "T06:00:00" (seen in Qloo opening-hours data)
 * from ever matching.
 */
const PATTERNS = [
  {
    type: 'email',
    // pragmatic RFC-lite: local@domain.tld with dots/hyphens/plus-tags
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'ipv4',
    // each octet 0-255 validated in the guard below (regex is structural)
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    validate: (m) => m.split('.').every((o) => Number(o) <= 255),
  },
  {
    type: 'ipv6',
    // compressed form (contains "::") or the full 8-group form
    regex: /\b(?:[0-9a-f]{1,4}:){1,7}:(?::?[0-9a-f]{0,4}){0,7}\b|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi,
    validate: (m) => m.includes(':') && m.split(':').length >= 3,
  },
  {
    type: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: 'credit_card',
    // 13-19 digits with space/dash separators; Luhn-verified to kill FPs
    regex: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: (m) => {
      const digits = m.replace(/[ -]/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i -= 1) {
        let d = Number(digits[i]);
        if (alt) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        alt = !alt;
      }
      return sum % 10 === 0;
    },
  },
  {
    type: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    type: 'phone',
    // separator-joined groups only (555-123-4567, (555) 123-4567,
    // +1 555 123 4567, 1-800-273-8255) — bare digit runs (years, zip
    // codes, album titles like "1989") never match.
    regex: /\b(?:\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g,
  },
];

/**
 * DETECT-ONLY name hints: self-disclosure phrases. Reported, never
 * auto-redacted (see module header: "My Name Is" is a real song title).
 */
const NAME_HINTS = [
  { type: 'name_hint', regex: /\bmy name is\b/gi },
  { type: 'name_hint', regex: /\bname\s*[:=]\s*[A-Za-z]{2,}/gi },
  { type: 'name_hint', regex: /\bcall me\b/gi },
];

/**
 * Structured-field denylist for `sanitizeInput` (input-boundary layer
 * only). Keys are normalized (lowercased, separators stripped) before
 * lookup, so `first_name`, `firstName`, and `FIRST-NAME` all match.
 */
const DENYLISTED_KEYS = new Set([
  'name', 'firstname', 'lastname', 'middlename', 'fullname', 'username',
  'nickname', 'user', 'userid', 'userinfo', 'customer', 'customername',
  'contact', 'contactname', 'contactemail',
  'email', 'emailaddress', 'mail',
  'ip', 'ipaddress', 'ipaddr', 'ipv4', 'ipv6',
  'phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell',
  'ssn', 'socialsecuritynumber', 'nationalid',
  'password', 'passwd', 'pwd', 'secret', 'token', 'accesstoken',
  'refreshtoken', 'apikey', 'apisecret', 'authorization', 'cookie', 'sessionid',
  'creditcard', 'cardnumber', 'ccnumber', 'cvv', 'cvc',
  'dob', 'dateofbirth', 'birthday', 'birthdate',
  'passport', 'passportnumber',
  'address', 'street', 'postalcode', 'zipcode',
]);

const normalizeKey = (key) => key.toLowerCase().replace(/[-_.\s]/g, '');

/** Error thrown by assertNoPersonalData; carries MASKED findings only. */
export class PrivacyError extends Error {
  constructor(message, { findings = [] } = {}) {
    super(message);
    this.name = 'PrivacyError';
    this.code = 'PII_DETECTED';
    this.findings = findings;
  }
}

/** Masked preview: first 2 + last 2 chars — never the raw value. */
function mask(sample) {
  if (sample.length <= 4) return '***';
  return `${sample.slice(0, 2)}…${sample.slice(-2)}`;
}

/** Human summary, e.g. "email×2, ipv4×1" — safe for logs. */
export function redactionSummary(findings) {
  const counts = new Map();
  for (const f of findings) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => `${t}×${n}`).join(', ');
}

/**
 * Applies the PII patterns to one string.
 * @returns {{ value: string, findings: object[] }}
 */
export function sanitizeText(text, { phones = 'redact' } = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { value: text, findings: [] };
  }
  let value = text;
  const findings = [];

  for (const { type, regex, validate } of PATTERNS) {
    if (type === 'phone' && phones === 'ignore') continue;
    regex.lastIndex = 0;
    value = value.replace(regex, (match) => {
      if (validate && !validate(match)) return match;
      if (type === 'phone' && phones === 'detect') {
        findings.push({ type, masked: mask(match), location: 'value' });
        return match; // detect-only: keep the text intact
      }
      findings.push({ type, masked: mask(match), location: 'value' });
      return REDACTED;
    });
  }
  return { value, findings };
}

/** Detect-only pass: name hints + everything sanitizeText would catch. */
function collectNameHints(text, path, findings) {
  if (typeof text !== 'string') return;
  for (const { regex } of NAME_HINTS) {
    regex.lastIndex = 0;
    const m = regex.exec(text);
    if (m) {
      findings.push({
        type: 'name_hint',
        masked: mask(m[0]),
        path,
        location: 'value',
      });
    }
  }
}

/**
 * Deep, pattern-only sanitization of any JSON-ish value (strings AND
 * object keys are scanned; structure is preserved). Used by the
 * TRANSPORT layer for query params and request bodies — no key denylist,
 * because endpoint params like `filter.address` are legitimate while
 * their VALUES still go through pattern redaction.
 *
 * @returns {{ value: any, findings: object[] }}
 */
export function sanitizeTransportValue(value, options = {}) {
  const findings = [];
  const seen = new WeakSet();

  const walk = (node, path, depth) => {
    if (typeof node === 'string') {
      const { value: clean, findings: hits } = sanitizeText(node, options);
      for (const hit of hits) findings.push({ ...hit, path });
      return clean;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) return '[Circular]';
      if (depth >= (options.maxDepth ?? 8)) return '[Truncated]';
      seen.add(node);
      return node.map((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    }
    if (node && typeof node === 'object') {
      if (seen.has(node)) return '[Circular]';
      if (depth >= (options.maxDepth ?? 8)) return '[Truncated]';
      seen.add(node);
      const out = {};
      for (const [key, val] of Object.entries(node)) {
        // Keys themselves can be PII (maps keyed by email addresses).
        const { value: cleanKey, findings: keyHits } = sanitizeText(key, options);
        for (const hit of keyHits) {
          findings.push({ ...hit, path, location: 'key' });
        }
        const childPath = path ? `${path}.${cleanKey}` : cleanKey;
        // A key may collide after redaction — first occurrence wins,
        // later duplicates collapse (documented, privacy-safe).
        if (!(cleanKey in out)) out[cleanKey] = walk(val, childPath, depth + 1);
      }
      return out;
    }
    return node; // numbers, booleans, null pass through untouched
  };

  return { value: walk(value, '', 0), findings };
}

/**
 * INPUT-BOUNDARY sanitization: transport patterns PLUS the key denylist
 * (personal fields redacted wholesale, including nested subtrees).
 *
 * @param {any} input   JSON-ish user payload (string, object, array).
 * @param {object} [options]
 * @param {string[]} [options.allowKeys]  Keys exempt from the denylist
 *                                        (e.g. entity-search tool params).
 * @returns {{ value: any, findings: object[] }}
 */
export function sanitizeInput(input, options = {}) {
  const allow = new Set((options.allowKeys ?? []).map(normalizeKey));
  const findings = [];
  const seen = new WeakSet();

  const walk = (node, path, depth) => {
    if (typeof node === 'string') {
      const { value: clean, findings: hits } = sanitizeText(node, options);
      for (const hit of hits) findings.push({ ...hit, path });
      return clean;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) return '[Circular]';
      if (depth >= (options.maxDepth ?? 8)) return '[Truncated]';
      seen.add(node);
      return node.map((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    }
    if (node && typeof node === 'object') {
      if (seen.has(node)) return '[Circular]';
      if (depth >= (options.maxDepth ?? 8)) return '[Truncated]';
      seen.add(node);
      const out = {};
      for (const [key, val] of Object.entries(node)) {
        const normalized = normalizeKey(key);
        if (DENYLISTED_KEYS.has(normalized) && !allow.has(normalized)) {
          // Personal field: redact the WHOLE subtree — a structured name/
          // email/IP can be nested arbitrarily deep inside it.
          findings.push({
            type: 'denylisted_key',
            masked: mask(key),
            path: path ? `${path}.${key}` : key,
            location: 'key',
          });
          out[key] = REDACTED;
          continue;
        }
        const childPath = path ? `${path}.${key}` : key;
        out[key] = walk(val, childPath, depth + 1);
      }
      return out;
    }
    return node;
  };

  const value = walk(input, '', 0);
  // Name-hint detection on the final string values (detect-only).
  const scan = (node, path) => {
    if (typeof node === 'string') {
      collectNameHints(node, path, findings);
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => scan(item, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        scan(v, path ? `${path}.${k}` : k);
      }
    }
  };
  scan(value, '');
  return { value, findings };
}

/**
 * Detects personal data without modifying anything (audit/report tool).
 * @returns {object[]} masked findings
 */
export function detectPersonalData(input, options = {}) {
  return sanitizeInput(input, { ...options, allowKeys: [] }).findings;
}

/**
 * Hard gate: throws `PrivacyError` (with masked findings) when personal
 * data is present; returns the input untouched when clean. For callers
 * that must FAIL rather than redact.
 * @throws {PrivacyError}
 */
export function assertNoPersonalData(input, options = {}) {
  // detectPersonalData returns the findings ARRAY directly.
  const findings = detectPersonalData(input, options);
  if (findings.length > 0) {
    throw new PrivacyError(
      `personal data detected (${redactionSummary(findings)}) — refusing to proceed`,
      { findings }
    );
  }
  return input;
}

const privacyGuard = {
  PII_TYPES,
  REDACTED,
  PrivacyError,
  sanitizeText,
  sanitizeTransportValue,
  sanitizeInput,
  detectPersonalData,
  assertNoPersonalData,
  redactionSummary,
};

export default privacyGuard;

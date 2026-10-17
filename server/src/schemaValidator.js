/**
 * Lightweight JSON Schema validator (task 115) — a dependency-free
 * SUBSET of JSON Schema for request-body validation.
 *
 * WHY A SUBSET (not a library): the project's discipline is zero
 * framework bloat and a measured dependency budget; the generate
 * routes need only a handful of keywords. This validator is literal
 * JSON Schema (a standard format), adds ZERO dependencies, and stays
 * decoupled from Zod (an MCP-layer concern). It is pure and total.
 *
 * SUPPORTED KEYWORDS:
 *   type                  'object'|'string'|'number'|'integer'|
 *                         'array'|'boolean'|'null'
 *   required              [property names] (object)
 *   properties            { name: subschema } (object, recursed)
 *   additionalProperties  false rejects unknown keys (object)
 *   enum                  [allowed values]
 *   minLength / maxLength (string)
 *   minimum / maximum     (number/integer)
 *   minItems / maxItems   (array)
 *   pattern               (string regex source)
 *   errorCode             PROJECT EXTENSION: the machine-readable code
 *                         surfaced when THIS property fails, so a route
 *                         can map a schema failure to its HTTP envelope
 *                         code without string-matching messages.
 *
 * validateSchema(data, schema) -> { valid, errors: [{path, code,
 * message}] }; errors are reported in declaration order (required
 * first, then properties), so a caller that throws the FIRST error
 * gets a deterministic, stable code.
 */

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const matchesType = (value, type) => {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' && Number.isFinite(value);
  if (type === 'integer') return actual === 'number' && Number.isInteger(value);
  return actual === type;
};

const joinPath = (parent, name) => (parent ? `${parent}.${name}` : name);

/**
 * Validate `data` against a JSON-Schema subset document.
 *
 * @param {*} data the parsed request value.
 * @param {object} schema the schema (subset, see the header).
 * @param {string} [path] the recursion path (internal).
 * @returns {{valid: boolean, errors: Array<{path, code, message}>}}
 */
export function validateSchema(data, schema, path = '') {
  const errors = [];
  const here = path || '(root)';
  const code = schema.errorCode ?? 'INVALID_REQUEST';

  // A type mismatch means we cannot descend — report and stop.
  if (schema.type && !matchesType(data, schema.type)) {
    errors.push({ path: here, code, message: `expected ${schema.type}` });
    return { valid: false, errors };
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push({ path: here, code, message: `must be one of ${schema.enum.join(' | ')}` });
  }

  if (schema.type === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path: here, code, message: `must be at least ${schema.minLength} character(s)` });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({ path: here, code, message: `must be at most ${schema.maxLength} character(s)` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) {
      errors.push({ path: here, code, message: 'does not match the required pattern' });
    }
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path: here, code, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path: here, code, message: `must be <= ${schema.maximum}` });
    }
  }

  if (schema.type === 'object') {
    for (const name of schema.required ?? []) {
      if (data[name] === undefined) {
        const sub = schema.properties?.[name];
        errors.push({
          path: joinPath(path, name),
          code: sub?.errorCode ?? code,
          message: `${name} is required`,
        });
      }
    }
    for (const [name, sub] of Object.entries(schema.properties ?? {})) {
      if (data[name] === undefined) continue; // already reported by `required`
      errors.push(...validateSchema(data[name], sub, joinPath(path, name)).errors);
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(data)) {
        if (!Object.hasOwn(schema.properties ?? {}, name)) {
          errors.push({ path: joinPath(path, name), code, message: `unknown property "${name}"` });
        }
      }
    }
  }

  if (schema.type === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path: here, code, message: `must have at least ${schema.minItems} item(s)` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ path: here, code, message: `must have at most ${schema.maxItems} item(s)` });
    }
  }

  return { valid: errors.length === 0, errors };
}

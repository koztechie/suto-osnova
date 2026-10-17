/**
 * Lightweight JSON Schema validator gate (task 115):
 *   - the supported keyword subset (type / required / properties /
 *     additionalProperties / enum / length / range / items / pattern);
 *   - the errorCode extension + the deterministic error order
 *     (required first, then properties in declaration order);
 *   - the number/integer finite checks and the array-not-object rule;
 *   - the GENERATE_REQUEST_SCHEMA integration (the exact route codes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { validateSchema } = await import('../src/schemaValidator.js');
const { GENERATE_REQUEST_SCHEMA, GENERATE_FORMATS } = await import('../src/generate.js');

const codes = (result) => result.errors.map((e) => e.code);

test('type matching: object / string / number / integer / array / boolean / null', () => {
  assert.equal(validateSchema({}, { type: 'object' }).valid, true);
  assert.equal(validateSchema('x', { type: 'string' }).valid, true);
  assert.equal(validateSchema(5, { type: 'number' }).valid, true);
  assert.equal(validateSchema(5, { type: 'integer' }).valid, true);
  assert.equal(validateSchema([], { type: 'array' }).valid, true);
  assert.equal(validateSchema(true, { type: 'boolean' }).valid, true);
  assert.equal(validateSchema(null, { type: 'null' }).valid, true);

  assert.equal(validateSchema('x', { type: 'object' }).valid, false);
  assert.equal(validateSchema([], { type: 'object' }).valid, false,
    'an array is NOT an object in this subset');
  assert.equal(validateSchema(null, { type: 'object' }).valid, false);
  assert.equal(validateSchema(5.5, { type: 'integer' }).valid, false);
  assert.equal(validateSchema(NaN, { type: 'number' }).valid, false,
    'NaN is not a finite number');
  assert.equal(validateSchema(Infinity, { type: 'number' }).valid, false);
});

test('required, properties recursion, paths, and additionalProperties', () => {
  const schema = {
    type: 'object',
    required: ['seed'],
    properties: {
      seed: { type: 'string' },
      nested: { type: 'object', properties: { n: { type: 'integer' } } },
    },
  };
  assert.equal(validateSchema({ seed: 'x' }, schema).valid, true);
  const missing = validateSchema({}, schema);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.errors.map((e) => e.path), ['seed']);

  const nested = validateSchema({ seed: 'x', nested: { n: 'no' } }, schema);
  assert.equal(nested.valid, false);
  assert.deepEqual(nested.errors.map((e) => e.path), ['nested.n'], 'the path recurses');

  const closed = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.equal(validateSchema({ a: 'x', b: 1 }, closed).valid, false);
  assert.deepEqual(validateSchema({ a: 'x', b: 1 }, closed).errors.map((e) => e.path), ['b']);
});

test('enum, length, range, items, pattern', () => {
  assert.equal(validateSchema('pdf', { type: 'string', enum: ['json', 'html'] }).valid, false);
  assert.equal(validateSchema('json', { type: 'string', enum: ['json', 'html'] }).valid, true);

  assert.equal(validateSchema('ab', { type: 'string', minLength: 3 }).valid, false);
  assert.equal(validateSchema('abcd', { type: 'string', maxLength: 3 }).valid, false);
  assert.equal(validateSchema('abc1', { type: 'string', pattern: '^[a-z]+$' }).valid, false);

  assert.equal(validateSchema(5, { type: 'number', minimum: 10 }).valid, false);
  assert.equal(validateSchema(50, { type: 'number', maximum: 10 }).valid, false);
  assert.equal(validateSchema(10, { type: 'number', minimum: 10, maximum: 10 }).valid, true);

  assert.equal(validateSchema([], { type: 'array', minItems: 1 }).valid, false);
  assert.equal(validateSchema([1, 2, 3], { type: 'array', maxItems: 2 }).valid, false);
});

test('the errorCode extension + deterministic error order', () => {
  const schema = {
    type: 'object',
    errorCode: 'INVALID_BODY',
    required: ['seed'],
    properties: {
      seed: { type: 'string', errorCode: 'INVALID_SEED' },
      format: { type: 'string', enum: ['json'], errorCode: 'INVALID_FORMAT' },
    },
  };
  // required first -> the seed code.
  assert.deepEqual(codes(validateSchema({}, schema)), ['INVALID_SEED']);
  // a property failure -> its own code.
  assert.deepEqual(codes(validateSchema({ seed: 'x', format: 'pdf' }, schema)), ['INVALID_FORMAT']);
  // a non-object body -> the root code.
  assert.deepEqual(codes(validateSchema('nope', schema)), ['INVALID_BODY']);
  // multiple property errors keep DECLARATION order (seed before format).
  assert.deepEqual(codes(validateSchema({ seed: 1, format: 'pdf' }, schema)),
    ['INVALID_SEED', 'INVALID_FORMAT']);
});

test('the generate request schema maps to the exact route codes', () => {
  assert.deepEqual([...GENERATE_FORMATS], ['json', 'markdown', 'html']);
  assert.deepEqual(codes(validateSchema({}, GENERATE_REQUEST_SCHEMA)), ['INVALID_SEED']);
  assert.deepEqual(codes(validateSchema({ seed: 'x', format: 'pdf' }, GENERATE_REQUEST_SCHEMA)),
    ['INVALID_FORMAT']);
  assert.deepEqual(codes(validateSchema({ seed: 'x', options: [] }, GENERATE_REQUEST_SCHEMA)),
    ['INVALID_OPTIONS']);
  assert.deepEqual(codes(validateSchema({ seed: 42 }, GENERATE_REQUEST_SCHEMA)), ['INVALID_SEED']);
  assert.deepEqual(codes(validateSchema(null, GENERATE_REQUEST_SCHEMA)), ['INVALID_BODY']);
  assert.deepEqual(codes(validateSchema([], GENERATE_REQUEST_SCHEMA)), ['INVALID_BODY']);
  // A free-form options OBJECT passes the envelope (the mode validates its own keys).
  assert.equal(validateSchema({ seed: 'x', options: { topN: 3 } }, GENERATE_REQUEST_SCHEMA).valid,
    true);
  assert.equal(validateSchema({ seed: 'x', format: 'markdown' }, GENERATE_REQUEST_SCHEMA).valid,
    true);
});

test('determinism and the empty-schema edge', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const a = validateSchema({ a: 1 }, schema);
  const b = validateSchema({ a: 1 }, schema);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  // An empty schema accepts anything.
  assert.equal(validateSchema({ anything: true }, {}).valid, true);
});

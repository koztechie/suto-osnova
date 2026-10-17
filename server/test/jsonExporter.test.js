/**
 * JsonExporter gate (task 103) — the standardized JSON export:
 *   - the CLOSED, VERSIONED envelope (schema/version/mode/output/
 *     requestId/seed/entity) with the explicit data/meta split;
 *   - the closed-contract guarantee (internal keys dropped);
 *   - the JSON-safety transform (non-finite -> null; dropped slots
 *     keep array positions);
 *   - determinism (no clock unless the caller injects `now`), the
 *     compact/pretty string forms, the TypeError matrix, zero
 *     emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'json-exporter-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const {
  exportJson, stringifyJson, DOSSIER_SCHEMA, JSON_EXPORTER_VERSION,
  DATA_KEYS, META_KEYS,
} = await import('../src/formatters/JsonExporter.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { runAntithesis } = await import('../src/modes/AntithesisMode.js');
const {
  searchStub, affinityStub, tagsStub,
} = await import('../test-support/fullCycleRunner.js');

const shared = () => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: async () => ({ results: [] }),
  tagsFn: tagsStub,
  synthesis: false,
});

test('the closed, versioned envelope over a real activation bundle', async () => {
  const bundle = await runExperiential('Static Ash Live', shared());
  const env = exportJson(bundle);

  assert.equal(env.schema, DOSSIER_SCHEMA);
  assert.equal(env.version, JSON_EXPORTER_VERSION);
  assert.equal(env.mode, 'activation');
  assert.equal(env.output, 'activation_curation');
  assert.equal(env.requestId, bundle.requestId);
  assert.deepEqual({ ...env.seed }, { ...bundle.seed });

  // The stable identity triple — no internal extras.
  assert.deepEqual(Object.keys(env.entity).sort(), ['category', 'id', 'name']);
  assert.equal(env.entity.name, bundle.entity.name);

  // data = the domain payload; meta = the provenance/ledger.
  assert.ok(env.data.audience && env.data.curation, 'activation payload rides `data`');
  assert.ok(env.meta.stats && Array.isArray(env.meta.failures), 'the ledger rides `meta`');
  assert.ok('expansion' in env.meta && 'chain' in env.meta);
  assert.ok(!('session' in env), 'the internal FSM record is NOT part of the contract');
  assert.ok(Object.isFrozen(env));
});

test('the closed-contract guarantee: unknown bundle keys are dropped', async () => {
  const bundle = await runExperiential('Static Ash Live', shared());
  const tainted = { ...bundle, internalSecret: 'should-not-leak' };
  const env = exportJson(tainted);
  assert.ok(!('internalSecret' in env), 'only the listed keys leave the system');
  for (const key of Object.keys(env)) {
    assert.ok(['schema', 'version', 'mode', 'output', 'requestId', 'seed',
      'entity', 'data', 'meta'].includes(key)
      || key === 'generatedAt', `unexpected envelope key ${key}`);
  }
  // Every data/meta key is on the exported contract lists.
  for (const key of Object.keys(env.data)) assert.ok(DATA_KEYS.includes(key));
  for (const key of Object.keys(env.meta)) assert.ok(META_KEYS.includes(key));
});

test('json-safety: non-finite -> null, dropped slots keep positions', () => {
  const env = exportJson({
    mode: 'activation',
    curation: { sponsors: [{ name: 'X', bad: Infinity }, { name: 'Y', gone: undefined }] },
  });
  assert.equal(env.data.curation.sponsors[0].bad, null, 'Infinity -> honest null');
  assert.equal(env.data.curation.sponsors[0].name, 'X');
  assert.ok(!('gone' in env.data.curation.sponsors[1]), 'undefined dropped from objects');
  // Round-trips through the string form.
  const parsed = JSON.parse(stringifyJson({
    mode: 'activation', curation: { sponsors: [{ bad: Infinity }] },
  }));
  assert.equal(parsed.data.curation.sponsors[0].bad, null);
});

test('determinism and the string forms', async () => {
  const bundle = await runExperiential('Static Ash Live', shared());
  assert.equal(stringifyJson(bundle), stringifyJson(bundle), 'byte-identical');
  const parsed = JSON.parse(stringifyJson(bundle));
  assert.deepEqual(JSON.parse(JSON.stringify(exportJson(bundle))), parsed,
    'the object and string forms agree');
  const compact = stringifyJson(bundle, { indent: 0 });
  assert.ok(!compact.includes('\n'), 'compact form is a single line');
  assert.deepEqual(JSON.parse(compact), parsed);
  assert.ok(!/\p{Extended_Pictographic}/u.test(compact), 'zero emojis');
});

test('the caller-injected timestamp, and its honest absence', async () => {
  const bundle = await runExperiential('Static Ash Live', shared());
  const stamped = exportJson(bundle, { now: '2026-01-01T00:00:00Z' });
  assert.equal(stamped.generatedAt, '2026-01-01T00:00:00Z');
  assert.ok(!('generatedAt' in exportJson(bundle)), 'no clock unless injected');
});

test('the antithesis payload and the TypeError matrix', async () => {
  const antithesis = await runAntithesis('Static Ash Live', shared());
  const env = exportJson(antithesis);
  assert.equal(env.output, 'cultural_blindspot_report');
  assert.ok(env.data.antithesis, 'the antithesis block rides `data`');

  for (const bad of [null, {}, { mode: 42 }]) {
    assert.throws(() => exportJson(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => exportJson({ mode: 'activation' }, { now: 42 }), TypeError);
  assert.throws(() => stringifyJson({ mode: 'activation' }, { indent: 9 }), TypeError);
  assert.throws(() => stringifyJson({ mode: 'activation' }, { indent: -1 }), TypeError);
});

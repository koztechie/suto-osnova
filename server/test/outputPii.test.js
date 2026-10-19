/**
 * OUTPUT PII verification suite (task 165) — proves the data this
 * system EMITS carries no personal information.
 *
 * The transport side (outbound params/bodies) is pinned in
 * privacyGuard.test.js and the log scrubber in logger tests. This
 * suite owns the OUTPUT seam: a user may paste an anchor containing an
 * email/phone/SSN, and before the task-165 ingress guard that text was
 * echoed VERBATIM into `seed.normalized` / `anchor` and therefore into
 * every export format. Verified while writing: all three modes leaked
 * the raw PII (probe recorded in PLAN_STATE); the fix redacts at the
 * SINGLE choke point (normalizeSeedText), which is both the search
 * query and the echoed output value.
 *
 * Scanning uses the system's OWN detector (detectPersonalData) so the
 * gate cannot drift from the guard it verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'output-pii-test-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { normalizeSeedText, resolveSeed } = await import('../src/engine/SeedResolver.js');
const { detectPersonalData, REDACTED } = await import('../src/services/privacyGuard.js');
const { runWorldbuilder } = await import('../src/modes/WorldbuilderMode.js');
const { runExperiential } = await import('../src/modes/ExperientialMode.js');
const { runAntithesis } = await import('../src/modes/AntithesisMode.js');
const { exportJson } = await import('../src/formatters/JsonExporter.js');
const { exportMarkdown } = await import('../src/formatters/MarkdownExporter.js');
const { exportHtml } = await import('../src/formatters/HtmlPrintFormatter.js');
const { searchStub, affinityStub, tagsStub } = await import('../test-support/fullCycleRunner.js');

const PII_ANCHOR =
  'Hereditary for jane@example.com, call 212-555-0198, SSN 123-45-6789';
const PII_FRAGMENTS = ['jane@example.com', '212-555-0198', '123-45-6789'];

// The system's OWN two-tier contract: REDACTABLE classes are the ones
// sanitizeText actively strips (and so must never survive in output);
// `name_hint` is a DETECT-ONLY heuristic (documented to false-positive
// on song titles like "My Name Is" and, here, on internal `name:<id>`
// provenance graph node ids) and is never auto-redacted — it is
// informational, not a leak guarantee. Output verification pins the
// REDACTABLE tier to zero.
const REDACTABLE = new Set([
  'email', 'ipv4', 'ipv6', 'ssn', 'credit_card', 'jwt', 'phone',
]);

const emptySearch = async () => ({ results: [] });
const llmFetchStub = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'stub',
    usage: { prompt_tokens: 900, completion_tokens: 140 },
    choices: [{ message: { content: 'A grounded line for the dossier.' } }],
  }),
});

const baseOptions = () => ({
  affinityFn: affinityStub,
  search: searchStub,
  searchFn: emptySearch,
  tagsFn: tagsStub,
  insightsFn: emptySearch,
  fetchFn: llmFetchStub,
  apiKey: 'wb-key',
});

/** Redactable-only findings for a value (detect-only name_hint excluded). */
function redactableFindings(value) {
  return detectPersonalData(value).filter((f) => REDACTABLE.has(f.type));
}

/**
 * Asserts a serialized output carries ZERO redactable personal data.
 * Detect-only `name_hint` findings are excluded by contract (see the
 * REDACTABLE comment) — they never reach an output as readable PII.
 */
function assertClean(label, serialized) {
  const findings = redactableFindings(serialized);
  assert.deepEqual(
    findings.map((f) => ({ type: f.type, masked: f.masked })),
    [],
    `${label} must carry no redactable personal data (found ${findings.length})`
  );
  for (const fragment of PII_FRAGMENTS) {
    assert.ok(
      !serialized.includes(fragment),
      `${label} must not echo the raw fragment ${fragment}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. INGRESS GUARD — the single choke point.
// ---------------------------------------------------------------------------

test('ingress: normalizeSeedText redacts every PII class from the anchor', () => {
  const normalized = normalizeSeedText(PII_ANCHOR);

  for (const fragment of PII_FRAGMENTS) {
    assert.ok(!normalized.includes(fragment), `${fragment} is redacted`);
  }
  assert.ok(normalized.includes(REDACTED), 'the redaction marker is explicit');
  assert.ok(normalized.includes('Hereditary'), 'the cultural anchor survives');
  assert.deepEqual(detectPersonalData(normalized), [], 'detector confirms it is clean');
});

test('ingress: redaction is idempotent (double normalization stays clean)', () => {
  const once = normalizeSeedText(PII_ANCHOR);
  const twice = normalizeSeedText(once);
  assert.equal(twice, once, 'normalizing an already-redacted anchor is a no-op');
  assert.deepEqual(detectPersonalData(twice), []);
});

test('ingress: resolveSeed keeps raw untouched but normalized clean', () => {
  const seed = resolveSeed(PII_ANCHOR);

  assert.equal(seed.raw, PII_ANCHOR, 'raw stays verbatim by contract');
  for (const fragment of PII_FRAGMENTS) {
    assert.ok(!seed.normalized.includes(fragment), `normalized redacts ${fragment}`);
  }
  assert.ok(!seed.key.includes('jane@example.com'), 'the dedup key is clean too');
  assert.deepEqual(detectPersonalData(seed.normalized), []);
});

test('ingress: redaction re-collapses whitespace (no double spaces after markers)', () => {
  const normalized = normalizeSeedText('Blade Runner for jane@example.com now');
  assert.ok(!normalized.includes('  '), 'no double space is left behind');
  assert.equal(normalized, 'Blade Runner for [REDACTED] now');
});

test('ingress: legit cultural anchors are NEVER mangled by the guard', () => {
  const legit = [
    'Blade Runner 2049',
    '1989',
    'Beverly Hills 90210',
    '2001: A Space Odyssey',
    'call me by your name',
    'My Name Is Eminem',
    'Phoenix 212-555 album', // a lone 555 group is not a full phone
  ];
  for (const anchor of legit) {
    assert.equal(normalizeSeedText(anchor), anchor, `"${anchor}" is untouched`);
  }
});

test('ingress: an all-PII anchor degrades to a redacted (never a leak)', () => {
  // The whole anchor is one email: it cannot resolve, but it must not leak.
  const seed = resolveSeed('jane@example.com');
  assert.ok(!seed.normalized.includes('jane@example.com'));
  assert.deepEqual(detectPersonalData(seed.normalized), []);
});

// ---------------------------------------------------------------------------
// 2. FULL PIPELINE — all three modes, all three export formats.
// ---------------------------------------------------------------------------

const MODES_UNDER_TEST = [
  ['worldbuilder', runWorldbuilder],
  ['experiential', runExperiential],
  ['antithesis', runAntithesis],
];

for (const [name, run] of MODES_UNDER_TEST) {
  test(`pipeline ${name}: the bundle and all three export formats are PII-free`, async () => {
    const bundle = await run(PII_ANCHOR, baseOptions());

    // The in-memory bundle itself (what any caller could read).
    assertClean(`${name} bundle`, JSON.stringify(bundle));
    assert.ok(
      !JSON.stringify(bundle.seed).includes('jane@example.com'),
      `${name} seed block is clean`
    );

    // Every export format a judge can download.
    assertClean(`${name} JSON`, JSON.stringify(exportJson(bundle)));
    assertClean(`${name} Markdown`, exportMarkdown(bundle));
    assertClean(`${name} HTML`, exportHtml(bundle));
  });
}

test('pipeline: the anchor echoed into scene/session metadata is clean', async () => {
  const bundle = await runWorldbuilder(PII_ANCHOR, baseOptions());
  const serialized = JSON.stringify(bundle);

  // The `anchor` field (mode scene context) and `seed.normalized` are
  // the two echo points; both must be redacted.
  const anchorMatches = serialized.match(/"anchor":"[^"]*"/g) ?? [];
  for (const match of anchorMatches) {
    assert.ok(!match.includes('jane@example.com'), `anchor echo is clean: ${match}`);
  }
  assertClean('scene/session metadata', serialized);
});

// ---------------------------------------------------------------------------
// 3. FORMAT SURFACE — the exact JSON envelope a client receives.
// ---------------------------------------------------------------------------

test('format surface: the JSON envelope seed/entity/data carry no PII', async () => {
  const bundle = await runWorldbuilder(PII_ANCHOR, baseOptions());
  const envelope = exportJson(bundle);

  assert.deepEqual(redactableFindings(envelope.seed), [], 'envelope.seed is clean');
  assert.deepEqual(redactableFindings(envelope.entity), [], 'envelope.entity is clean');
  assert.deepEqual(redactableFindings(envelope.data), [], 'envelope.data is clean');
  assert.deepEqual(redactableFindings(envelope.meta), [], 'envelope.meta is clean');
});

test('format surface: HTML export escapes and carries no raw PII', async () => {
  const bundle = await runWorldbuilder(PII_ANCHOR, baseOptions());
  const html = exportHtml(bundle);

  assert.ok(!html.includes('jane@example.com'), 'no email in the print page');
  assert.ok(!html.includes('212-555-0198'), 'no phone in the print page');
  assert.deepEqual(redactableFindings(html), [], 'detector confirms the page is clean');
});

// ---------------------------------------------------------------------------
// 4. REGRESSION GUARD — the redaction cannot be silently removed.
// ---------------------------------------------------------------------------

test('regression: a clean anchor is byte-identical (guard only touches PII)', async () => {
  const clean = 'A24 Psychological Horror';
  const bundle = await runWorldbuilder(clean, baseOptions());

  assert.ok(bundle.seed.normalized.includes('A24 Psychological Horror'),
    'a clean anchor passes through unchanged');
  assert.ok(!bundle.seed.normalized.includes(REDACTED),
    'the redaction marker never appears for clean input');
});

// ---------------------------------------------------------------------------
// 5. DETECTOR ACCURACY — the guard must not flag legitimate data.
// ---------------------------------------------------------------------------

test('detector accuracy: credit_card ignores UUID prefixes and float fractions', () => {
  // A UUID prefix whose digit substring passes Luhn by chance is NOT a card.
  const uuid = '00040004-1111-4222-8333-444455556666';
  assert.deepEqual(detectPersonalData(`id ${uuid} here`).filter((f) => f.type === 'credit_card'), [],
    'a UUID is never a credit card');
  // A floating-point affinity's fractional run is NOT a card.
  assert.deepEqual(detectPersonalData('{"affinity":0.8799999999999999}').filter((f) => f.type === 'credit_card'), [],
    'a float fraction is never a credit card');
  // A real standalone card IS still caught (Luhn-valid).
  assert.ok(detectPersonalData('card 4111 1111 1111 1111')
    .some((f) => f.type === 'credit_card'), 'a real card is still detected');
});

test('detector accuracy: name_hint on internal graph node ids is detect-only (documented)', () => {
  // The provenance graph uses `name:<entity>` node ids; the detect-only
  // name_hint heuristic matches them, but by contract it is NEVER
  // auto-redacted and does not block the output (it is excluded from
  // the REDACTABLE tier). The target is a REAL full UUID (as the graph
  // always emits) so the card guard correctly ignores it too.
  const graph =
    '{"source":"name:hereditary","target":"00040004-1111-4222-8333-444455556666"}';
  const hints = detectPersonalData(graph).filter((f) => f.type === 'name_hint');
  assert.ok(hints.length > 0, 'the heuristic does fire on the node id');
  assert.ok(!REDACTABLE.has('name_hint'), 'but it is not a redactable class (by design)');
  assert.deepEqual(redactableFindings(graph), [], 'so it never blocks a clean output');
});

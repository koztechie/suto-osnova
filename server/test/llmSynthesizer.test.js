/**
 * LlmSynthesizer tests (task 62) — pins the OpenAI-compatible synthesis
 * bridge with an injected fetch (zero network): env-based config and
 * credential headers, bounded prompt construction, tolerant response
 * parsing (string / content-parts / malformed), typed failures
 * (not_configured, http_error, upstream_error, timeout,
 * malformed_response), option passthrough and frozen deterministic
 * outputs over a full tasks-49-61-shaped dossier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Repo-wide pattern: env before the module loads. LLM keys are set HERE
// so the configured paths are testable; the not_configured path uses an
// explicit empty override.
process.env.QLOO_API_KEY = 'llm-synth-test-key';
process.env.LLM_API_KEY = 'test-llm-key-123';
process.env.LLM_BASE_URL = 'https://llm.example.test/v1/';
process.env.LLM_MODEL = 'test-model-9';

const {
  synthesizeDossier,
  buildSynthesisPrompt,
  LlmSynthesisError,
  LLM_CODES,
  LLM_DEFAULTS,
  SYSTEM_PROMPT,
} = await import('../src/services/llmSynthesizer.js');

const okResponse = (over = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'served-model',
    choices: [{ message: { content: over.content ?? 'Synthesized dossier prose.' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    ...over.payload,
  }),
});

const capture = (responseFactory) => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return responseFactory(url, init);
  };
  fetchFn.calls = calls;
  return fetchFn;
};

test('not_configured: typed failure, fetch never called', async () => {
  const fetchFn = capture(() => okResponse());
  await assert.rejects(
    () => synthesizeDossier({ anchor: {} }, { fetchFn, apiKey: '' }),
    (err) =>
      err instanceof LlmSynthesisError && err.code === LLM_CODES.NOT_CONFIGURED
  );
  assert.equal(fetchFn.calls.length, 0, 'zero network on missing credential');
});

test('env config: URL, credential header and body shape', async () => {
  const fetchFn = capture(() => okResponse());

  const result = await synthesizeDossier({ anchor: { name: 'Blade Runner' } }, { fetchFn });

  const call = fetchFn.calls[0];
  assert.equal(call.url, 'https://llm.example.test/v1/chat/completions', 'trailing slash normalized');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, 'Bearer test-llm-key-123');
  assert.equal(call.init.headers['content-type'], 'application/json');

  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'test-model-9', 'env model');
  assert.equal(body.temperature, LLM_DEFAULTS.temperature);
  assert.equal(body.max_tokens, LLM_DEFAULTS.maxTokens);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');

  assert.deepEqual({ ...result }, {
    text: 'Synthesized dossier prose.',
    model: 'served-model',
    usage: { promptTokens: 100, completionTokens: 50 },
    mode: 'live',
    prompt: { bytes: body.messages[1].content.length - 'Dossier data (JSON):\n'.length, truncated: false },
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.usage));
});

test('buildSynthesisPrompt: persona rules, layer bounding, truncation', () => {
  const dossier = {
    anchor: { name: 'Blade Runner' },
    films: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: `Film ${i}` })),
  };

  const prompt = buildSynthesisPrompt(dossier, { maxEntriesPerLayer: 2 });
  assert.ok(prompt.system.includes('VERBATIM'), 'rule: numbers verbatim');
  assert.ok(prompt.system.includes('NO personal data'), 'rule: no PII');
  assert.ok(prompt.system.includes('NON-OBVIOUS'), 'rule: non-obvious first');
  assert.equal(prompt.system, SYSTEM_PROMPT);

  const json = JSON.parse(prompt.user.replace('Dossier data (JSON):\n', ''));
  assert.equal(json.films.length, 2, 'arrays bounded per layer');
  assert.equal(json.anchor.name, 'Blade Runner');
  assert.equal(prompt.truncated, false);

  const tight = buildSynthesisPrompt(dossier, { maxPromptChars: 40 });
  assert.equal(tight.truncated, true);
  assert.ok(tight.user.endsWith('...[truncated]'), 'explicit marker');
});

test('response forms: content-parts arrays joined; usage optional', async () => {
  const parts = capture(() =>
    okResponse({
      payload: {
        choices: [{ message: { content: [{ text: 'Part one. ' }, { text: 'Part two.' }] } }],
        usage: undefined,
      },
    })
  );
  const fromParts = await synthesizeDossier({}, { fetchFn: parts });
  assert.equal(fromParts.text, 'Part one. Part two.');
  assert.equal(fromParts.usage, null, 'absent usage stays null');
  assert.equal(fromParts.model, 'served-model');
});

test('malformed responses are typed', async () => {
  const noChoices = capture(() => okResponse({ payload: { choices: [] } }));
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: noChoices }),
    (err) => err.code === LLM_CODES.MALFORMED_RESPONSE
  );

  const emptyContent = capture(() => okResponse({ content: '' }));
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: emptyContent }),
    (err) => err.code === LLM_CODES.MALFORMED_RESPONSE
  );

  const badJson = capture(() => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }));
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: badJson }),
    (err) => err.code === LLM_CODES.MALFORMED_RESPONSE && err.cause.message === 'not json'
  );

  const notAResponse = capture(() => ({}));
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: notAResponse }),
    (err) => err.code === LLM_CODES.MALFORMED_RESPONSE
  );
});

test('http and transport failures are typed with details/cause', async () => {
  const rateLimited = capture(() => ({ ok: false, status: 429 }));
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: rateLimited }),
    (err) => err.code === LLM_CODES.HTTP_ERROR && err.details.status === 429
  );

  const boom = new Error('dns down');
  const failing = async () => {
    throw boom;
  };
  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: failing }),
    (err) => err.code === LLM_CODES.UPSTREAM_ERROR && err.cause === boom
  );
});

test('timeout aborts the waiter', async () => {
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      );
    });

  await assert.rejects(
    () => synthesizeDossier({}, { fetchFn: hanging, timeoutMs: 20 }),
    (err) =>
      err instanceof LlmSynthesisError &&
      err.code === LLM_CODES.TIMEOUT &&
      err.details.timeoutMs === 20
  );
});

test('option overrides: model, temperature, tokens, prompt budget', async () => {
  const fetchFn = capture(() => okResponse());
  await synthesizeDossier(
    { films: Array.from({ length: 4 }, (_, i) => ({ id: i })) },
    { fetchFn, model: 'override-model', temperature: 0, maxTokens: 77, maxEntriesPerLayer: 1 }
  );

  const body = JSON.parse(fetchFn.calls[0].init.body);
  assert.equal(body.model, 'override-model', 'explicit model wins over env');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 77);
  assert.equal(JSON.parse(body.messages[1].content.replace('Dossier data (JSON):\n', '')).films.length, 1);
});

test('full dossier composition: deterministic layers reach the prompt intact', async () => {
  const dossier = {
    anchor: { id: 'seed', name: 'Blade Runner', domain: 'film' },
    expansion: { domains: [{ domain: 'music', entities: [{ name: 'Vangelis' }] }] },
    sound: { artists: [{ name: 'Vangelis', affinity: 0.9, percent: 90 }], genres: [{ name: 'Ambient', weight: 0.5 }] },
    visual: { cinematography: [{ name: 'Deep Focus', percent: 85 }] },
    sorted: [{ id: 'E1', sorting: { surprise: 1.5 } }],
  };
  const fetchFn = capture(() => okResponse({ content: 'Досьє готове.' }));

  const result = await synthesizeDossier(dossier, { fetchFn });

  const sentBody = JSON.parse(fetchFn.calls[0].init.body);
  const sent = JSON.parse(sentBody.messages[1].content.replace('Dossier data (JSON):\n', ''));
  assert.equal(sent.sound.artists[0].percent, 90, 'percentages reach the model verbatim');
  assert.equal(sent.sorted[0].sorting.surprise, 1.5);
  assert.equal(result.text, 'Досьє готове.');

  const second = await synthesizeDossier(dossier, { fetchFn: capture(() => okResponse({ content: 'Досьє готове.' })) });
  assert.deepEqual(second, result, 'stubbed runs identical');
});

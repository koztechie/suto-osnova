/**
 * DossierSystemPrompt tests (task 63) — pins the hardened
 * anti-hallucination system prompt: every hard clause individually
 * detectable via its invariant marker, the load-time integrity gate,
 * section structure, deterministic assembly, emoji-free contract and
 * the single-source-of-truth wiring into llmSynthesizer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The prompt module is env-free (static import); llmSynthesizer pulls in
// config/env, so it loads through the repo's top-level-await pattern
// AFTER the env setup above.
import {
  SYSTEM_PROMPT,
  PROMPT_SECTIONS,
  PROMPT_INVARIANTS,
  validateSystemPrompt,
  assertPromptIntegrity,
} from '../src/services/dossierSystemPrompt.js';

process.env.QLOO_API_KEY = 'prompt-test-key';
const { SYSTEM_PROMPT: SYNTH_PROMPT } = await import('../src/services/llmSynthesizer.js');

test('every hard clause is present and individually detectable', () => {
  const report = validateSystemPrompt(SYSTEM_PROMPT);
  assert.deepEqual(report.missing, []);
  assert.equal(report.ok, true);
  assert.equal(report.emojiFree, true);
  assert.ok(PROMPT_INVARIANTS.length >= 12, 'the contract is granular');

  // Each invariant marker exists ONLY through its own clause: removing
  // any single section must surface its ids.
  for (const invariant of PROMPT_INVARIANTS) {
    assert.ok(
      SYSTEM_PROMPT.includes(invariant.marker),
      `marker for ${invariant.id}`
    );
  }
});

test('the integrity gate detects every dropped invariant', () => {
  for (const invariant of PROMPT_INVARIANTS) {
    const doctor = SYSTEM_PROMPT.replace(invariant.marker, '');
    const report = validateSystemPrompt(doctor);
    assert.equal(report.ok, false, `${invariant.id} removal detected`);
    assert.deepEqual(report.missing, [invariant.id], `${invariant.id} named`);
    assert.throws(
      () => assertPromptIntegrity(doctor),
      (err) => err.message.includes(invariant.id),
      `${invariant.id} gate names the loss`
    );
  }
});

test('the integrity gate rejects emoji contamination', () => {
  const contaminated = `${SYSTEM_PROMPT} Great job! \u{1F3C6}`;
  const report = validateSystemPrompt(contaminated);
  assert.equal(report.emojiFree, false);
  assert.equal(report.ok, false);
  assert.throws(() => assertPromptIntegrity(contaminated), /integrity check failed/);
});

test('contract semantics: exclusive source, no invention, uncertainty protocol', () => {
  assert.ok(SYSTEM_PROMPT.includes('ENTIRE knowledge base'), 'exclusive source');
  assert.ok(SYSTEM_PROMPT.includes('EVEN WHEN YOU KNOW IT IS TRUE'), 'external knowledge ban');
  assert.ok(SYSTEM_PROMPT.includes('never "about 80%"'), 'no estimates');
  assert.ok(SYSTEM_PROMPT.includes('78.3%'), 'verbatim example');
  assert.ok(SYSTEM_PROMPT.includes('insufficient data in the Qloo array'), 'gap protocol');
  assert.ok(SYSTEM_PROMPT.includes('report BOTH with their scores'), 'conflict protocol');
  assert.ok(SYSTEM_PROMPT.includes('You may never ADD to it'), 'restatement-only rule');
  assert.ok(SYSTEM_PROMPT.includes('NO personal data'), 'privacy invariant');
  assert.ok(SYSTEM_PROMPT.includes('NON-OBVIOUS'), 'ordering rule honored in prose');
});

test('structure: assembled from exported sections, deterministic, bounded', () => {
  const assembled = Object.values(PROMPT_SECTIONS)
    .flatMap((section) => (Array.isArray(section) ? section : [section]))
    .join('\n');
  assert.equal(SYSTEM_PROMPT, assembled, 'deterministic assembly, no hidden state');

  assert.equal(typeof SYSTEM_PROMPT, 'string');
  assert.ok(SYSTEM_PROMPT.length > 1000, 'substantive contract');
  assert.ok(SYSTEM_PROMPT.length < 4000, 'token budget sane');
  assert.equal(PROMPT_SECTIONS.dataContract.length, 5, 'four numbered rules + header');
  assert.equal(PROMPT_SECTIONS.forbidden.length, 5);
  assert.equal(PROMPT_SECTIONS.uncertainty.length, 4);
});

test('single source of truth: llmSynthesizer re-exports the same prompt', () => {
  assert.equal(SYNTH_PROMPT, SYSTEM_PROMPT);
});

test('the integrity gate passes on the shipped prompt (load-time contract)', () => {
  assert.deepEqual({ ...assertPromptIntegrity() }, { ok: true, missing: [], emojiFree: true });
});

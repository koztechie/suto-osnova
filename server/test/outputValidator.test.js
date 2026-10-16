/**
 * OutputValidator tests (task 64) — pins the deterministic
 * hallucination gate: known-name harvesting from dossier payloads,
 * mention extraction (quoted + title-case with EN/UK stopword
 * trimming, Unicode-aware for Ukrainian), matching semantics
 * (exact / parenthetical-strip / containment guard), documented
 * limitations (single tokens, unquoted article-led names), verdict
 * shape and frozen deterministic outputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSynthesis,
  collectKnownNames,
  extractMentions,
  VALIDATOR_DEFAULTS,
} from '../src/engine/OutputValidator.js';

const DOSSIER = {
  anchor: { id: 'seed', name: 'Blade Runner', domain: 'film' },
  sound: {
    artists: [{ name: 'Vangelis', affinity: 0.9 }],
    genres: [{ name: 'Slow Cinema' }, { name: 'Ambient' }],
  },
  visual: {
    cinematography: [{ name: 'Deep Focus' }],
    films: [{ name: 'Neon City' }],
    tags: [{ id: 'urn:tag:genre:media:x', name: 'Technicolor' }],
  },
  gastronomy: { venues: [{ name: 'Izakaya Neko' }] },
  literary: { texts: [{ title: 'Meditations' }] },
};

test('collectKnownNames: recursive, normalized, deduped', () => {
  const names = collectKnownNames(DOSSIER);

  assert.equal(names.size, 9, 'name + title keys across every layer');
  assert.ok(names.has('blade runner'), 'normalized lowercase');
  assert.ok(names.has('vangelis'));
  assert.ok(names.has('izakaya neko'));
  assert.ok(names.has('meditations'), 'title key collected too');
  assert.ok(names.has('technicolor'), 'tag names count');

  // Dedup + normalization: same name twice collapses.
  const dup = collectKnownNames({ a: { name: 'Blade  Runner' }, b: { name: 'blade runner.' } });
  assert.equal(dup.size, 1);
});

test('extractMentions: quoted forms incl. guillemets, dedup', () => {
  const mentions = extractMentions('The film "Blade Runner" quotes «Slow Cinema» twice: "Blade Runner".');
  const quoted = mentions.filter((m) => m.form === 'quoted');
  assert.deepEqual(quoted.map((m) => m.mention).sort(), ['Blade Runner', 'Slow Cinema']);
  assert.equal(typeof quoted[0].index, 'number');

  const cyrillic = extractMentions('Фільм «Матриця» змінив усе');
  assert.deepEqual(cyrillic.map((m) => m.mention), ['Матриця']);
});

test('extractMentions: title-case runs with stopword trimming', () => {
  const mentions = extractMentions('Vangelis crafted Deep Focus sequences with Neon City');
  assert.deepEqual(mentions.map((m) => m.mention), ['Deep Focus', 'Neon City'], 'single tokens skipped');

  const trimmed = extractMentions('Matrix Reloaded defined an era');
  assert.deepEqual(trimmed.map((m) => m.mention), ['Matrix Reloaded']);

  const cyrillicRun = extractMentions('Станіслав Лем писав про космос');
  assert.deepEqual(cyrillicRun.map((m) => m.mention), ['Станіслав Лем'], 'Unicode-aware');
});

test('matching semantics: exact, parenthetical strip, containment guard', () => {
  // Exact + normalized.
  assert.equal(validateSynthesis('Vangelis composed it.', DOSSIER).ok, true);

  // Title-case run with a year suffix still matches after stripping.
  const year = validateSynthesis('Blade Runner (1982) defined the look.', DOSSIER);
  assert.equal(year.ok, true, 'trailing parenthetical ignored');
  assert.equal(year.matched, 1);

  // Containment: a longer mention covers a known name (>= 4 chars).
  const extended = validateSynthesis('"Blade Runner Final Cut" restores footage.', DOSSIER);
  assert.equal(extended.ok, true, 'mention contains the known name');

  // The guard does NOT excuse a bare substring of a longer known name.
  const matrix = validateSynthesis('"Matrix" is a math term here.', {
    films: [{ name: 'The Matrix' }],
  });
  assert.equal(matrix.ok, false, '"Matrix" is not excused for "The Matrix"');
  assert.equal(matrix.hallucinated[0].mention, 'Matrix');

  // Suffix anchoring: a common-word preamble anchored to a known tail.
  const anchored = validateSynthesis('Note Vangelis returns next year.', DOSSIER);
  assert.equal(anchored.ok, true, '"Note Vangelis" anchored by its Vangelis tail');
  assert.equal(anchored.checked, 1);
});

test('hallucination detection: quoted and title-case offenders', () => {
  const prose =
    'Christopher Nolan reimagined "Inception" while "Vangelis" scored the dossier.';
  const verdict = validateSynthesis(prose, DOSSIER);

  assert.equal(verdict.ok, false);
  // Quoted mentions are extracted before title-case runs, so the
  // offender list opens with the quoted Inception.
  assert.deepEqual(verdict.hallucinated.map((h) => h.mention), ['Inception', 'Christopher Nolan']);
  assert.deepEqual(verdict.hallucinated.map((h) => h.form), ['quoted', 'title_case']);
  assert.equal(verdict.checked, 3, 'two quotes + one title-case run');
  assert.equal(verdict.matched, 1, 'the quoted Vangelis passes');
  assert.equal(verdict.knownCount, 9);
});

test('documented limitations: unquoted single tokens are not judged', () => {
  // A lone capitalized word mid-sentence is too ambiguous to extract.
  assert.deepEqual(extractMentions('Inception changed heists forever'), []);
  // An article-led unquoted name is missed by design (quote to be checked).
  assert.deepEqual(extractMentions('The Matrix was revolutionary'), []);
  assert.equal(validateSynthesis('The Matrix was revolutionary', {
    films: [{ name: 'The Matrix' }],
  }).checked, 0);
  // A quoted single token IS judged.
  assert.equal(validateSynthesis('"Vangelis" rules', DOSSIER).ok, true);
  assert.equal(validateSynthesis('"Inception" rules', DOSSIER).ok, false);
});

test('options: includeTitleCase=false and minRunLength', () => {
  const quotedOnly = validateSynthesis('Deep Focus defines "Blade Runner".', DOSSIER, {
    includeTitleCase: false,
  });
  assert.equal(quotedOnly.checked, 1, 'only the quoted mention checked');

  const longer = extractMentions('Deep Focus operates here', { minRunLength: 3 });
  assert.deepEqual(longer, [], 'two-token runs below the threshold');
  assert.equal(VALIDATOR_DEFAULTS.minRunLength, 2);
});

test('verdict: ok on clean prose, frozen and deterministic', () => {
  const clean =
    'Vangelis and Slow Cinema shape Deep Focus in Neon City, served at Izakaya Neko.';
  const first = validateSynthesis(clean, DOSSIER);
  const second = validateSynthesis(clean, DOSSIER);

  assert.equal(first.ok, true);
  assert.equal(first.checked, 4);
  assert.equal(first.hallucinated.length, 0);
  assert.deepEqual(first, second, 'deterministic');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.hallucinated));

  const flagged = validateSynthesis('"Inception" again', DOSSIER);
  assert.ok(Object.isFrozen(flagged.hallucinated[0]));
  assert.equal(JSON.parse(JSON.stringify(flagged)).hallucinated[0].mention, 'Inception');
});

test('degenerate inputs degrade safely', () => {
  const empty = validateSynthesis('', {});
  assert.deepEqual({ ...empty }, {
    ok: true, checked: 0, matched: 0, knownCount: 0, hallucinated: [],
  });
  assert.equal(validateSynthesis(null, null).ok, true);
  assert.deepEqual(collectKnownNames(null), new Set());
  assert.deepEqual(extractMentions(undefined), []);
});

test('end-to-end: the synthesis backstop over a real dossier round', () => {
  // Simulated model output over the exact payload (tasks 62-63 flow):
  // verbatim quotes/runs from the data and ONE invented recommendation
  // (quoted, since unquoted single tokens are deliberately unjudged).
  const prose =
    'Досьє: Vangelis веде антитезу, а «Slow Cinema» пояснює темп. ' +
    'Серед рекомендацій — Izakaya Neko та культовий «Interstellar».';
  const verdict = validateSynthesis(prose, DOSSIER);

  assert.equal(verdict.ok, false, 'backstop catches the invented film');
  assert.equal(verdict.hallucinated.length, 1);
  assert.equal(verdict.hallucinated[0].mention, 'Interstellar');
  assert.ok(verdict.matched >= 2, 'legitimate mentions pass');
});

/**
 * SeedClassifier tests (task 46) — pins the input-format recognition
 * contract: direct_title / person / aesthetic_description scoring via
 * named signals, deterministic tie-breaking, honest low-confidence
 * reporting of lexically ambiguous anchors, per-format components,
 * frozen outputs and composition with SeedResolver.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySeedFormat,
  SEED_FORMATS,
  SEED_CONFIDENCE,
  FORMAT_PRECEDENCE,
  SIGNAL_WEIGHTS,
} from '../src/engine/SeedClassifier.js';
import { resolveSeed, InvalidSeedError } from '../src/engine/SeedResolver.js';

const { DIRECT_TITLE, PERSON, AESTHETIC_DESCRIPTION } = SEED_FORMATS;

test('direct_title: quoted anchor resolves high with quoted_full signal', () => {
  const result = classifySeedFormat('"The Matrix"');

  assert.equal(result.format, DIRECT_TITLE);
  assert.equal(result.confidence, SEED_CONFIDENCE.HIGH);
  assert.ok(result.signals.includes('quoted_full'));
  assert.ok(Object.isFrozen(result));
  assert.deepEqual({ ...result.components }, { title: 'The Matrix', year: null });
});

test('direct_title: guillemet anchor with Cyrillic content', () => {
  const result = classifySeedFormat('\u00AB\u041C\u0430\u0442\u0440\u0438\u0446\u044F\u00BB');
  assert.equal(result.format, DIRECT_TITLE);
  assert.equal(result.confidence, SEED_CONFIDENCE.HIGH);
  assert.equal(result.components.title, '\u041C\u0430\u0442\u0440\u0438\u0446\u044F');
});

test('direct_title: year suffix extracts year, medium confidence', () => {
  const result = classifySeedFormat('Blade Runner (1982)');

  assert.equal(result.format, DIRECT_TITLE);
  assert.equal(result.confidence, SEED_CONFIDENCE.MEDIUM);
  assert.ok(result.signals.includes('year_suffix'));
  assert.deepEqual({ ...result.components }, { title: 'Blade Runner', year: 1982 });
});

test('direct_title: "The Matrix" — article pattern stays a title (low, person alternative)', () => {
  const result = classifySeedFormat('The Matrix');

  assert.equal(result.format, DIRECT_TITLE, 'leading article pattern favors works');
  assert.equal(result.confidence, SEED_CONFIDENCE.LOW, 'genuinely ambiguous lexically');
  assert.ok(result.signals.includes('title_case_full'));
  assert.ok(result.signals.includes('leading_the'), 'person signal also fired');
  assert.equal(result.alternatives[0], PERSON, 'person reported as next-best guess');
});

test('person: honorific prefix and roman-numeral suffix resolve high', () => {
  const result = classifySeedFormat('John Paul II');
  assert.equal(result.format, PERSON);
  assert.equal(result.confidence, SEED_CONFIDENCE.HIGH);
  assert.ok(result.signals.includes('honorific_suffix'));
  assert.deepEqual({ ...result.components }, { name: 'John Paul II', family: 'II' });

  const titled = classifySeedFormat('Dr. Stanley Kubrick');
  assert.equal(titled.format, PERSON);
  assert.equal(titled.confidence, SEED_CONFIDENCE.HIGH);
  assert.equal(titled.components.family, 'Kubrick');
});

test('person: name particles ("van") earn the full-name pattern, medium', () => {
  const result = classifySeedFormat('Ludwig van Beethoven');

  assert.equal(result.format, PERSON);
  assert.equal(result.confidence, SEED_CONFIDENCE.MEDIUM);
  assert.ok(result.signals.includes('particle_inside'));
  assert.ok(result.signals.includes('full_name_pattern'));
  assert.equal(result.components.family, 'Beethoven');
});

test('documented ambiguity: two title-case words tie — title wins, person alternative, low', () => {
  // "Blade Runner" and "Brad Pitt" are structurally identical to any
  // lexical heuristic; the classifier must report the tie honestly.
  const result = classifySeedFormat('Blade Runner');

  assert.equal(result.format, DIRECT_TITLE);
  assert.equal(result.confidence, SEED_CONFIDENCE.LOW);
  assert.equal(result.scores[DIRECT_TITLE], result.scores[PERSON], 'exact tie');
  assert.equal(result.alternatives[0], PERSON);
  assert.ok(Object.isFrozen(result.scores));
});

test('documented ambiguity: single capitalized token ties the same way', () => {
  for (const anchor of ['Dune', 'Kubrick', 'Radiohead']) {
    const result = classifySeedFormat(anchor);
    assert.equal(result.format, DIRECT_TITLE, `${anchor}: precedence default`);
    assert.equal(result.confidence, SEED_CONFIDENCE.LOW, `${anchor}: ambiguous`);
    assert.equal(result.alternatives[0], PERSON, `${anchor}: alternative reported`);
  }
});

test('aesthetic_description: connective + category + adjective, medium', () => {
  const result = classifySeedFormat('films like Blade Runner with slow pacing');

  assert.equal(result.format, AESTHETIC_DESCRIPTION);
  assert.equal(result.confidence, SEED_CONFIDENCE.MEDIUM);
  for (const signal of ['connective', 'category_word', 'adjective']) {
    assert.ok(result.signals.includes(signal), `signal ${signal} fired`);
  }
  assert.ok(result.alternatives.includes(DIRECT_TITLE), 'embedded title run reported');
});

test('aesthetic_description: request imperative + vibes resolves high', () => {
  const result = classifySeedFormat('give me cozy Studio Ghibli vibes');

  assert.equal(result.format, AESTHETIC_DESCRIPTION);
  assert.equal(result.confidence, SEED_CONFIDENCE.HIGH);
  assert.ok(result.signals.includes('request_phrase'));
  assert.ok(result.signals.includes('connective'));
});

test('aesthetic_description: comma fragments split, components enumerate them', () => {
  const result = classifySeedFormat('coffee shops, ambient jazz, rainy afternoons');

  assert.equal(result.format, AESTHETIC_DESCRIPTION);
  assert.ok(result.signals.includes('fragment_extra'));
  assert.deepEqual(
    [...result.components.fragments],
    ['coffee shops', 'ambient jazz', 'rainy afternoons']
  );
  assert.ok(Object.isFrozen(result.components.fragments));
});

test('aesthetic_description: quoted work inside a description stays a component', () => {
  const result = classifySeedFormat('movies like "Blade Runner" but funnier');

  assert.equal(result.format, AESTHETIC_DESCRIPTION, 'quoted_inside is weaker than full quotes');
  assert.ok(result.signals.includes('quoted_inside'));
  assert.deepEqual([...result.components.quoted], ['Blade Runner']);
});

test('composition: descriptor input, resolver errors propagate, bad descriptor typed', () => {
  const seed = resolveSeed('  The Godfather ');
  const result = classifySeedFormat(seed);
  assert.equal(result.format, DIRECT_TITLE);
  assert.equal(result.components.title, 'The Godfather');

  // String ingress runs through resolveSeed validation.
  assert.throws(() => classifySeedFormat('a'), InvalidSeedError);
  assert.throws(() => classifySeedFormat(''), InvalidSeedError);

  // Descriptor-like inputs without a usable normalized field are typed.
  assert.throws(() => classifySeedFormat({}), TypeError);
  assert.throws(() => classifySeedFormat({ normalized: 42 }), TypeError);
  assert.throws(() => classifySeedFormat(null), TypeError);
});

test('determinism: identical input -> identical results; outputs fully frozen', () => {
  assert.deepEqual(
    classifySeedFormat('films like "Am\u00e9lie", cozy and nostalgic'),
    classifySeedFormat('films like "Am\u00e9lie", cozy and nostalgic')
  );

  const result = classifySeedFormat('The Godfather');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.scores));
  assert.ok(Object.isFrozen(result.signals));
  assert.ok(Object.isFrozen(result.alternatives));
  assert.ok(Object.isFrozen(result.components));
  assert.throws(() => {
    result.format = 'hijacked';
  }, TypeError);
  assert.equal(JSON.parse(JSON.stringify(result)).format, DIRECT_TITLE, 'serializable');

  // alternatives exclude the winner and follow score order + precedence.
  const desc = classifySeedFormat('give me epic space operas');
  assert.ok(!desc.alternatives.includes(desc.format));
  assert.equal(desc.alternatives.length, 2);
});

test('scoring model is inspectable and self-consistent', () => {
  assert.ok(SIGNAL_WEIGHTS.quoted_full > SIGNAL_WEIGHTS.year_suffix);
  assert.equal(FORMAT_PRECEDENCE[0], DIRECT_TITLE);
  assert.equal(FORMAT_PRECEDENCE.length, 3);
  assert.ok(Object.isFrozen(SIGNAL_WEIGHTS));
  assert.ok(Object.isFrozen(FORMAT_PRECEDENCE));

  // Every fired signal name corresponds to a known weight.
  const result = classifySeedFormat('films like Dune (1984), moody and epic');
  for (const signal of result.signals) {
    assert.ok(signal in SIGNAL_WEIGHTS, `signal ${signal} is declared`);
  }
  // Scores are non-negative and the winner is the maximum.
  const entries = Object.entries(result.scores);
  assert.ok(entries.every(([, s]) => s >= 0));
  const max = Math.max(...entries.map(([, s]) => s));
  assert.equal(result.scores[result.format], max, 'format is a top scorer');
});

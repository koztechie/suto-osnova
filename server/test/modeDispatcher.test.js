/**
 * ModeDispatcher gate (task 81) — the three PRD working modes resolve
 * to frozen, cross-module-consistent run plans:
 *   - registry integrity (3 modes, unique labels/outputs, frozen);
 *   - tolerant ingress (default, ids, aliases, case/spacing, objects);
 *   - the TypeError vs InvalidModeError split (programmer vs data);
 *   - per-mode plans (layers, domains, selection, requirements,
 *     thresholds incl. the honest antithesis null, common ladder);
 *   - immutability, determinism and the domainMapper/AgentPhases pins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODES,
  MODE_ALIASES,
  MODE_WORLDBUILDER,
  MODE_ACTIVATION,
  MODE_ANTITHESIS,
  DEFAULT_MODE,
  LAYER_DOMAINS,
  SELECTION_STRATEGIES,
  MODE_REASONS,
  InvalidModeError,
  resolveMode,
  dispatchMode,
  listModes,
  isModeId,
} from '../src/engine/ModeDispatcher.js';
import { PHASE_ORDER } from '../src/engine/AgentPhases.js';
import { THRESHOLD_DEFAULTS } from '../src/engine/AdaptiveThreshold.js';
import { MANDATORY_DOMAINS } from '../src/services/domainMapper.js';

test('registry: exactly the three PRD modes, unique and frozen', () => {
  assert.deepEqual(Object.keys(MODES).sort(), [
    MODE_ACTIVATION, MODE_ANTITHESIS, MODE_WORLDBUILDER,
  ].sort());
  const labels = Object.values(MODES).map((m) => m.label);
  const outputs = Object.values(MODES).map((m) => m.output);
  assert.equal(new Set(labels).size, 3, 'labels are unique');
  assert.equal(new Set(outputs).size, 3, 'outputs are unique');
  assert.equal(DEFAULT_MODE, MODE_WORLDBUILDER, 'the flagship PRD mode is the default');
  assert.ok(Object.isFrozen(MODES[MODE_WORLDBUILDER].layers));
  assert.ok(Object.isFrozen(MODES[MODE_WORLDBUILDER].requires));
  // Every registered layer id is one of the five extraction layers.
  for (const mode of Object.values(MODES)) {
    for (const layer of mode.layers) {
      assert.ok(Object.hasOwn(LAYER_DOMAINS, layer), `${mode.id}: known layer ${layer}`);
    }
  }
});

test('resolveMode: default ingress (null/undefined/blank)', () => {
  assert.equal(resolveMode(null), DEFAULT_MODE);
  assert.equal(resolveMode(undefined), DEFAULT_MODE);
  assert.equal(resolveMode(''), DEFAULT_MODE);
  assert.equal(resolveMode('   '), DEFAULT_MODE);
});

test('resolveMode: ids, aliases, case and spacing insensitivity', () => {
  assert.equal(resolveMode('worldbuilder'), MODE_WORLDBUILDER);
  assert.equal(resolveMode('Worldbuilder'), MODE_WORLDBUILDER);
  assert.equal(resolveMode(' WORLD BUILDER '), MODE_WORLDBUILDER); // alias world_builder
  assert.equal(resolveMode('mise-en-scene'), MODE_WORLDBUILDER); // alias via dash collapse
  assert.equal(resolveMode('activation'), MODE_ACTIVATION);
  assert.equal(resolveMode('Experiential Activation'), MODE_ACTIVATION);
  assert.equal(resolveMode('live events'), MODE_ACTIVATION);
  assert.equal(resolveMode('antithesis'), MODE_ANTITHESIS);
  assert.equal(resolveMode('Taste Antithesis'), MODE_ANTITHESIS);
  assert.equal(resolveMode('BlindSpot'), MODE_ANTITHESIS);
  // Object ingress (the HTTP/MCP request shape).
  assert.equal(resolveMode({ mode: 'antithesis' }), MODE_ANTITHESIS);
  assert.equal(resolveMode({ mode: 'Taste Antithesis' }), MODE_ANTITHESIS);
  // Every alias resolves to a registered mode (table self-consistency).
  for (const [alias, target] of Object.entries(MODE_ALIASES)) {
    assert.equal(resolveMode(alias), target, `alias ${alias}`);
  }
});

test('resolveMode: programmer errors are TypeErrors', () => {
  for (const bad of [42, true, [], Symbol('x'), { noMode: 1 }, { mode: 42 }, { mode: null }]) {
    assert.throws(() => resolveMode(bad), TypeError, `TypeError for ${String(bad)}`);
  }
});

test('resolveMode: a well-formed unknown string is a typed data error', () => {
  try {
    resolveMode('speedrun');
    assert.fail('must throw');
  } catch (error) {
    assert.ok(error instanceof InvalidModeError);
    assert.equal(error.name, 'InvalidModeError');
    assert.equal(error.reason, MODE_REASONS.UNKNOWN_MODE);
    assert.equal(error.details.input, 'speedrun');
    assert.deepEqual(
      [...error.details.known].sort(),
      [MODE_ACTIVATION, MODE_ANTITHESIS, MODE_WORLDBUILDER].sort()
    );
  }
});

test('isModeId: predicate mirrors the resolver without throwing', () => {
  assert.equal(isModeId('antithesis'), true);
  assert.equal(isModeId('Taste Antithesis'), true);
  assert.equal(isModeId('  '), true); // blank -> default mode
  assert.equal(isModeId('nonsense'), false);
  assert.equal(isModeId(42), false);
  assert.equal(isModeId(null), false);
  assert.equal(isModeId({ mode: 'antithesis' }), false, 'objects are not ids');
});

test('plan: worldbuilder runs the full five-layer affinity dossier', () => {
  const plan = dispatchMode('worldbuilder');
  assert.equal(plan.mode, MODE_WORLDBUILDER);
  assert.equal(plan.output, 'mise_en_scene_dossier');
  assert.deepEqual(
    [...plan.layers],
    ['sound', 'literary', 'material', 'gastronomy', 'visual'],
    'extraction order preserved'
  );
  assert.deepEqual([...plan.domains], [...MANDATORY_DOMAINS], 'all five domains');
  assert.equal(plan.selection, SELECTION_STRATEGIES.NON_OBSVIOUS_AFFINITY);
  assert.deepEqual(
    { ...plan.requires }, { audienceInsights: false, antithesis: false }
  );
  assert.deepEqual({ ...plan.thresholds }, { ...THRESHOLD_DEFAULTS });
});

test('plan: activation narrows to bookable/buyable layers and requires insights', () => {
  const plan = dispatchMode('activation');
  assert.deepEqual([...plan.layers], ['sound', 'material', 'gastronomy'],
    'opening acts + sponsors + vendors');
  assert.deepEqual([...plan.domains], ['music', 'dining', 'fashion'],
    'domains ordered by the MANDATORY_DOMAINS contract');
  assert.equal(plan.requires.audienceInsights, true,
    'the PRD activation run is audience-insights driven');
  assert.equal(plan.requires.antithesis, false);
  assert.equal(plan.selection, SELECTION_STRATEGIES.NON_OBSVIOUS_AFFINITY);
  assert.deepEqual({ ...plan.thresholds }, { ...THRESHOLD_DEFAULTS });
});

test('plan: antithesis inverts selection and honestly applies no threshold', () => {
  const plan = dispatchMode('antithesis');
  assert.equal(plan.output, 'cultural_blindspot_report');
  assert.equal(plan.selection, SELECTION_STRATEGIES.LOWEST_CORRELATION);
  assert.equal(plan.thresholds, null,
    'the affinity threshold gates ACCEPTANCE — a divergence run selects the weakest');
  assert.equal(plan.requires.antithesis, true);
  assert.deepEqual([...plan.layers], ['sound', 'literary', 'material', 'gastronomy', 'visual'],
    'a blindspot report spans every domain');
});

test('every plan carries the common six-phase ladder by reference', () => {
  for (const mode of [MODE_WORLDBUILDER, MODE_ACTIVATION, MODE_ANTITHESIS]) {
    const plan = dispatchMode(mode);
    assert.equal(plan.phases, PHASE_ORDER, `${mode}: same ladder reference`);
  }
});

test('immutability: plans are deeply frozen', () => {
  const plan = dispatchMode('worldbuilder');
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.domains));
  assert.throws(() => { plan.mode = 'antithesis'; }, TypeError);
  assert.throws(() => { plan.domains.push('x'); }, TypeError);
  assert.throws(() => { plan.requires.antithesis = true; }, TypeError);
});

test('determinism: identical ingress produces deep-equal plans', () => {
  const a = dispatchMode('activation');
  const b = dispatchMode({ mode: 'Experiential Activation' });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.deepEqual(
    JSON.parse(JSON.stringify(dispatchMode(null))),
    JSON.parse(JSON.stringify(dispatchMode('worldbuilder')))
  );
});

test('cross-module pin: layer domains are exactly the plan domains', () => {
  for (const mode of [MODE_WORLDBUILDER, MODE_ACTIVATION, MODE_ANTITHESIS]) {
    const plan = dispatchMode(mode);
    const fromLayers = [...new Set(plan.layers.map((l) => LAYER_DOMAINS[l]))];
    assert.deepEqual(
      [...plan.domains].sort(), fromLayers.sort(),
      `${mode}: plan.domains mirrors LAYER_DOMAINS`
    );
    // MANDATORY_DOMAINS order is preserved (filtered subsequence).
    const ordered = MANDATORY_DOMAINS.filter((d) => fromLayers.includes(d));
    assert.deepEqual([...plan.domains], ordered, `${mode}: canonical domain order`);
  }
});

test('listModes: frozen summaries for the UI/MCP surface', () => {
  const modes = listModes();
  assert.ok(Object.isFrozen(modes));
  assert.equal(modes.length, 3);
  for (const entry of modes) {
    assert.ok(Object.isFrozen(entry));
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'label', 'output']);
    assert.ok(Object.hasOwn(MODES, entry.id));
  }
});

test('dispatchMode: unknown mode propagates the typed error', () => {
  assert.throws(() => dispatchMode('speedrun'), InvalidModeError);
  assert.throws(() => dispatchMode(7), TypeError);
});

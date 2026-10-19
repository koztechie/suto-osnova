/**
 * E2E plan gate (task 161) — `tests/END_TO_END_PLAN.md` is a LIVING
 * CONTRACT, and this gate keeps it honest:
 *
 *   - STRUCTURE: the plan carries its numbered sections (0..10) and
 *     twelve journeys E2E-01..E2E-12, each stating Preconditions,
 *     Steps, Expected and Automation — a journey without a literal
 *     Expected list is an opinion, not a test;
 *   - NO ROT: every file reference (client/, server/, scripts/,
 *     tests/), every #id, every /api/ route, every preset seed and
 *     every environment variable the plan names must EXIST in the
 *     live tree — a rename anywhere in the system breaks this gate
 *     instead of silently invalidating the plan;
 *   - HYGIENE: no emojis, no banned terminology.
 *
 * Brace groups in references (`server/test/{a,b}.test.js`) are
 * expanded before validation, so the compact notation stays usable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const plan = await readFile(path.join(ROOT, 'tests', 'END_TO_END_PLAN.md'), 'utf8');
const html = await readFile(path.join(ROOT, 'client', 'index.html'), 'utf8');
const serverSources = await readFile(path.join(ROOT, 'server', 'src', 'app.js'), 'utf8')
  + await readFile(path.join(ROOT, 'client', 'src', 'js', 'presets.js'), 'utf8');

test('structure: numbered sections and twelve complete journeys', () => {
  for (let section = 0; section <= 10; section += 1) {
    assert.match(plan, new RegExp(`^## ${section}\\. `, 'm'), `section ${section} is present`);
  }
  for (let n = 1; n <= 12; n += 1) {
    const id = `E2E-${String(n).padStart(2, '0')}`;
    assert.ok(plan.includes(`### ${id} —`), `journey ${id} exists`);
  }
  for (const label of ['Preconditions:', 'Steps:', 'Expected:', 'Automation:']) {
    const count = plan.split(label).length - 1;
    assert.equal(count, 12, `every journey states "${label}" (12 occurrences)`);
  }
});

test('no rot: every referenced path exists in the live tree', () => {
  const references = new Set();
  for (const [, raw] of plan.matchAll(/`((?:client|server|scripts|tests)\/[A-Za-z0-9/_.-]+)`/g)) {
    if (raw.includes('*')) continue; // wildcard prose (`client/src/*`)
    // Expand a single brace group: `server/test/{a,b}.test.js`.
    const brace = raw.match(/^(.*)\{([^}]+)\}(.*)$/);
    if (brace) {
      for (const part of brace[2].split(',')) {
        references.add(`${brace[1]}${part}${brace[3]}`);
      }
    } else {
      references.add(raw);
    }
  }
  assert.ok(references.size >= 20, `the plan references its surroundings (${references.size} paths)`);
  const missing = [...references].filter((ref) => !existsSync(path.join(ROOT, ref)));
  assert.deepEqual(missing, [], 'every referenced path exists');
});

test('no rot: every #id, /api route, preset seed and env var exists', async () => {
  // Every #token is a real markup id.
  const ids = [...new Set([...plan.matchAll(/#([a-z][a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 15, `the plan names the live surface (${ids.length} ids)`);
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `#${id} exists in the markup`);
  }

  // Every /api route the plan names is served by the gateway.
  const routes = [...new Set([...plan.matchAll(/\/api\/[a-z][a-z-]+/g)].map((m) => m[0]))];
  for (const route of routes) {
    assert.ok(serverSources.includes(route), `${route} is served`);
  }

  // Every preset seed quoted in the plan ships in the markup.
  for (const seed of ['David Lynch Noir', 'Post-Punk Berlin', 'Ambient Festival']) {
    assert.ok(plan.includes(seed), `the plan exercises the ${seed} preset`);
    assert.ok(html.includes(`data-seed="${seed}"`), `and the preset exists`);
  }

  // Every env var the runbook names is honored by the tree (checked
  // against the real consumers, not just mentioned somewhere).
  const consumers = [
    await readFile(path.join(ROOT, 'server', 'src', 'config', 'envSchema.js'), 'utf8'),
    await readFile(path.join(ROOT, 'scripts', 'serveClient.mjs'), 'utf8'),
  ].join('\n');
  for (const variable of ['MOCK_MODE', 'CLIENT_PORT', 'API_PORT', 'INBOUND_RATE_LIMIT']) {
    assert.ok(plan.includes(variable), `${variable} appears in the runbook`);
    assert.ok(consumers.includes(variable), `${variable} is consumed by the runtime`);
  }
});

test('hygiene: no emojis, no banned terminology', () => {
  assert.ok(!/\p{Extended_Pictographic}/u.test(plan), 'zero emojis');
  assert.ok(!/\b(developer|development|coder|coding|programmer|programming)\b/i.test(plan),
    'required terminology only');
});

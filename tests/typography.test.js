/**
 * Typography gate (task 124) — pins the client font stacks:
 *
 *   --font-serif: 'Lora', 'Georgia', serif   (headings + analytical text)
 *   --font-mono:  ui-monospace, ...          (controls, labels, data)
 *
 * The gates hold the contract around the stack:
 *   - STACK VERBATIM: --font-serif is declared exactly as the ordered
 *     triple 'Lora', 'Georgia', serif — order matters (Lora preferred,
 *     Georgia the system fallback, the generic serif the last resort);
 *   - CONSUMPTION SCOPE: the serif is applied ONLY to headings (h1-h6)
 *     and the analytical reading surface (.output-text) — it must never
 *     leak into interactive chrome (controls/labels keep the mono);
 *   - NO EXTERNAL FONT TRANSPORT: no network @import, no CDN @font-face,
 *     no https url() in any client stylesheet — the page renders fully
 *     offline and the privacy notice promises zero third-party loads;
 *   - WIRING: main.css imports typography.css (the type sheet is live,
 *     not an orphan file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const CSS_DIR = path.join(CLIENT, 'src', 'css');
const TYPOGRAPHY = path.join(CSS_DIR, 'typography.css');
const MAIN = path.join(CSS_DIR, 'main.css');

const SERIF_STACK = "'Lora', 'Georgia', serif";

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

test('typography.css declares the serif stack verbatim', async () => {
  assert.ok((await stat(TYPOGRAPHY)).isFile(), 'client/src/css/typography.css exists');
  const css = await readText(TYPOGRAPHY);
  const serif = css.match(/--font-serif:\s*([^;]+);/);
  assert.ok(serif, '--font-serif is declared');
  assert.equal(serif[1].trim(), SERIF_STACK,
    `the serif stack must be exactly ${SERIF_STACK} (order matters)`);
  // The mono stack stays the instrument stack from the scaffold.
  assert.match(css, /--font-mono:\s*ui-monospace/, '--font-mono keeps the mono stack');
});

test('the serif is applied only to headings and analytical text', async () => {
  const css = await readText(TYPOGRAPHY);
  // Every rule block that styles with the serif token.
  const serifSelectors = [...css.matchAll(/([^{}]+)\{[^}]*var\(--font-serif\)[^}]*\}/g)]
    .map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter((selector) => !selector.startsWith('/*') && selector.length > 0);

  assert.ok(serifSelectors.length >= 2, 'the serif is consumed by at least two rules');
  for (const selector of serifSelectors) {
    const isHeadingGroup = /^h1(,\s*h[2-6])*$/i.test(selector.replace(/\s+/g, ''));
    const isAnalytical = selector === '.output-text';
    assert.ok(isHeadingGroup || isAnalytical,
      `"${selector}": the serif serves ONLY h1-h6 and .output-text`);
  }
  // Both targets are actually present.
  assert.ok(serifSelectors.some((s) => /h1/i.test(s)), 'a heading rule uses the serif');
  assert.ok(serifSelectors.some((s) => s === '.output-text'),
    'the analytical reading surface uses the serif');
});

test('no external font transport anywhere in the client css', async () => {
  for (const file of (await walk(CSS_DIR)).filter((f) => f.endsWith('.css'))) {
    // Strip comments first: the contract text itself mentions the
    // forbidden at-rules by name and must not trip the probe.
    const css = (await readText(file)).replace(/\/\*[\s\S]*?\*\//g, '');
    const rel = path.relative(CLIENT, file);
    assert.ok(!/@import\s+(url\()?\s*['"]?https?:/i.test(css),
      `${rel}: no network @import (offline-first, zero third-party loads)`);
    assert.ok(!/https?:\/\//i.test(css), `${rel}: no remote url() at all`);
    assert.ok(!/@font-face[\s\S]*?url\(\s*['"]?https?:/i.test(css),
      `${rel}: any @font-face must be local-only (no remote url() transport)`);
  }
});

test('main.css imports the type sheet (the stack is wired, not orphaned)', async () => {
  const main = await readText(MAIN);
  assert.match(main, /@import\s+"\.\/typography\.css";/,
    'main.css @imports typography.css');
});

async function readText(file) {
  return readFile(file, 'utf8');
}

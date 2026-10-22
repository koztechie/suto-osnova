#!/usr/bin/env node
/**
 * SCREENSHOT SET for the portfolio + the Devpost submission (task 210).
 *
 * Captures high-resolution (viewport 1680x1050 @2x = 3360x2100 physical)
 * screenshots of the LIVE application against a chosen base URL, with a
 * semantic ASSERTION before every frame — a shot is only written if the
 * page really shows the state it claims to show.
 *
 * PREREQUISITES (tooling only — nothing ships to production):
 *   npm i --no-save puppeteer-core        # package.json/lock untouched
 *   a Chromium binary: auto-resolves any cached ms-playwright bundle
 *   (chrome-linux64/chrome), then $SHOT_BROWSER, then /usr/bin/google-chrome.
 *
 * USAGE:
 *   node scripts/makeScreenshots.mjs                       # live production
 *   node scripts/makeScreenshots.mjs http://localhost:5173 # local client
 *
 * OUTPUT: ./screenshots/ — a GITIGNORED directory (repo hygiene rule:
 * no test screenshots may ever be tracked; scripts/verifyRepoHygiene.mjs
 * enforces it). Upload the PNGs to Devpost manually; docs/SCREENSHOTS.md
 * documents every frame and the hosted URLs.
 *
 * SEQUENCING (rate-limit friendly — one generate at a time):
 *   1 landing (idle) -> 2 worldbuilder markdown -> 3 experiential
 *   markdown -> 4 domain cards (populated) -> 5 antithesis markdown ->
 *   6 API inspector with the recorded provenance of the calls above.
 */
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'screenshots');
const BASE = (process.argv[2] ?? 'https://suto-osnova.netlify.app').replace(/\/$/, '');
const VIEWPORT = { width: 1680, height: 1050, deviceScaleFactor: 2 };

/** Resolve a Chromium binary: $SHOT_BROWSER -> playwright cache -> system. */
async function resolveBrowser() {
  if (process.env.SHOT_BROWSER && existsSync(process.env.SHOT_BROWSER)) {
    return process.env.SHOT_BROWSER;
  }
  const cache = path.join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const entry of (await readdir(cache)).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const candidate = path.join(cache, entry, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const system of ['/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (existsSync(system)) return system;
  }
  throw new Error('no Chromium found — set $SHOT_BROWSER to a binary');
}

/** PNG IHDR: dimensions live at bytes 16..24 (big-endian). */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Lowercased visible text of the page (and the same-origin output iframe). */
async function pageText(page) {
  return page.evaluate(() => {
    const out = [document.body.innerText];
    const frame = document.getElementById('output-frame');
    const doc = frame?.contentDocument;
    if (doc?.body?.innerText) out.push(doc.body.innerText);
    return out.join('\n');
  });
}

/** Latest #status line — the app's own voice about what happened. */
async function status(page) {
  return page.evaluate(() => document.getElementById('status')?.innerText ?? '').catch(() => '');
}

async function waitFor(page, fn, what, timeout = 90_000) {
  const started = Date.now();
  let last = '';
  let lastStatus = '';
  while (Date.now() - started < timeout) {
    last = (await fn().catch(() => '')) || '';
    if (last) return last;
    lastStatus = await status(page);
    // Fail FAST with the app's own error text instead of a silent timeout.
    if (/too many|rate limit|429|failed|invalid|error/i.test(lastStatus)) {
      throw new Error(`${what}: app reported "${lastStatus}"`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `timeout waiting for ${what} (last: ${last.slice(0, 80) || 'none'}; status: "${lastStatus}")`,
  );
}

/** Select a mode radio and VERIFY the selection took (visually-hidden input). */
async function setMode(page, value) {
  await page.evaluate((v) => document.querySelector(`input[value="${v}"]`).click(), value);
  const checked = await page.evaluate(
    () => document.querySelector('input[name="mode"]:checked')?.value,
  );
  if (checked !== value) throw new Error(`mode switch failed: wanted ${value}, got ${checked}`);
}

/** Type a seed and VERIFY it actually landed in the input. */
async function setSeed(page, text) {
  await page.click('#seed', { clickCount: 3 });
  await page.evaluate(() => { document.getElementById('seed').value = ''; });
  await page.type('#seed', text);
  const value = await page.$eval('#seed', (n) => n.value);
  if (value !== text) throw new Error(`seed typing failed: wanted "${text}", got "${value}"`);
  await page.select('#format', 'markdown');
}

/**
 * Press Generate SAFELY: puppeteer does not check the disabled state (a
 * click on a disabled button is a silent no-op), so wait for the button
 * to be enabled, click, and then VERIFY the status line actually moved —
 * a stuck status means the click never started a run.
 */
async function startGenerate(page) {
  const previous = await status(page);
  await page.waitForFunction(
    () => {
      const b = document.getElementById('generate');
      return Boolean(b) && b.disabled === false;
    },
    { timeout: 30_000 },
  );
  await page.click('#generate');
  await waitFor(
    page,
    async () => ((await status(page)) && (await status(page)) !== previous ? 'ok' : ''),
    'generate run to start (status line must move)',
    10_000,
  );
}

const report = [];

async function shoot(page, name, assertFn, what) {
  const text = await waitFor(page, assertFn, what);
  const buf = await page.screenshot();
  const { width, height } = pngSize(buf);
  const file = path.join(OUT, name);
  await writeFile(file, buf);
  const bytes = (await stat(file)).size;
  report.push({ name, width, height, bytes, asserted: what });
  // Let the production rate limiter breathe between blocks.
  await new Promise((r) => setTimeout(r, 1500));
  return text;
}

async function main() {
  const { default: puppeteer } = await import('puppeteer-core');
  const executablePath = await resolveBrowser();
  await mkdir(OUT, { recursive: true });
  console.log(`browser: ${executablePath}`);
  console.log(`base:    ${BASE}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-first-run', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.setDefaultTimeout(90_000);

  try {
    // 1. Landing, idle state. (innerText reflects the design's uppercase
    //    transform — match case-insensitively.)
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 90_000 });
    await shoot(page, '01-landing.png',
      async () => (await page.$eval('#generate-form', (n) => n.innerText.toLowerCase()))
        .includes('cultural anchor') ? 'ok' : '',
      'idle landing: anchor form + presets + connectivity');

    // 2. Worldbuilder — the David Lynch Noir preset, markdown dossier.
    //    (The markdown body renders into #output-text — every content
    //    check lives INSIDE the wait condition, whose return value is 'ok'.)
    await setSeed(page, 'David Lynch Noir');
    await startGenerate(page);
    await shoot(page, '02-worldbuilder-dossier.png',
      async () => {
        const t = await pageText(page);
        return /dossier/i.test(t) && /David Lynch/i.test(t) && t.length > 400 ? 'ok' : '';
      }, 'worldbuilder markdown dossier rendered (David Lynch Noir anchor)');

    // 3. Experiential — Glastonbury Festival, resonance index (the verified
    //    working festival anchor; the Ambient Festival preset is a typed 400).
    await setMode(page, 'experiential');
    await setSeed(page, 'Glastonbury Festival');
    await startGenerate(page);
    const exText = await shoot(page, '03-experiential-resonance.png',
      async () => {
        const t = await pageText(page);
        return /resonance/i.test(t) && /Glastonbury/i.test(t) ? 'ok' : '';
      }, 'experiential dossier with the resonance index (Glastonbury Festival)');

    // 4. The five cultural domain cards, populated.
    await page.evaluate(() => document.getElementById('domains')?.scrollIntoView({ block: 'center' }));
    await shoot(page, '04-domain-cards.png',
      async () => page.evaluate(() => {
        const sec = document.getElementById('domains');
        const visible = sec && !sec.hidden && sec.getBoundingClientRect().height > 100;
        const cards = [...document.querySelectorAll('.domain-card')].filter((c) => !c.hidden).length;
        return visible && cards >= 3 ? String(cards) : '';
      }), 'five-domain plates populated (cards >= 3 visible)');

    // 5. Taste antithesis — Post-Punk Berlin.
    await page.evaluate(() => document.getElementById('generate-form')?.scrollIntoView({ block: 'start' }));
    await setMode(page, 'antithesis');
    await setSeed(page, 'Post-Punk Berlin');
    await startGenerate(page);
    await shoot(page, '05-antithesis-report.png',
      async () => {
        const t = await pageText(page);
        return /antithesis/i.test(t) && t.length > 400 ? 'ok' : '';
      }, 'taste antithesis report (Post-Punk Berlin)');

    // 6. API Inspector — the recorded client calls of the session.
    await page.click('#open-inspector');
    await shoot(page, '06-api-inspector.png',
      async () => page.evaluate(() => {
        const modal = document.getElementById('inspector');
        const calls = document.getElementById('inspector-calls')?.innerText ?? '';
        return modal && !modal.hidden && /\/api\//.test(calls) ? 'ok' : '';
      }), 'API Inspector open with recorded /api calls');

    await writeFile(path.join(OUT, 'report.json'),
      JSON.stringify({ base: BASE, viewport: VIEWPORT, shots: report }, null, 2));
    console.log(JSON.stringify(report, null, 1));
    console.log(`OK: ${report.length} screenshots in ${path.relative(ROOT, OUT)}/`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`screenshot run failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});

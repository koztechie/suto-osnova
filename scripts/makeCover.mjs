#!/usr/bin/env node
/**
 * DEVPOST COVER IMAGE (task 215) — exactly 1200x630, Archival Iron.
 *
 * PIPELINE: an HTML template locked to the SIX palette hex codes (the
 * template itself is asserted to contain no other colour) -> headless
 * Chromium render at 1200x630 @1x -> a browser-side QUANTIZATION pass
 * that snaps every pixel to the nearest palette colour (the same rule
 * task 155 applied to social-card.png) -> PNG written with a report.
 * The final bitmap therefore contains ONLY palette RGB values — proven
 * afterwards by scripts in the journal verification (decoded pixel set
 * subset of the palette).
 *
 * PREREQUISITES: npm i --no-save puppeteer-core (package.json/lock stay
 * untouched) and a Chromium (auto-resolved: $SHOT_BROWSER -> ms-playwright
 * cache -> system Chrome).
 *
 * USAGE:   node scripts/makeCover.mjs [--size 1200x630] [outputPath]
           (1200x630 = the Devpost cover spec; 1200x800 = the 3:2 ratio
           the thumbnail uploader hints at)
 DEFAULT: screenshots/cover-devpost-1200x630.png  (gitignored dir — a
 * cover is uploaded to Devpost by hand; hosted copy lives in the
 * v1.0.0-hackathon release).
 */
import { writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** `--size 1200x630` (default) or `--size 1200x800` (Devpost's 3:2 hint). */
const sizeArg = process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1200x630';
const [W, H] = sizeArg.split('x').map(Number);
if (!(W >= 400 && H >= 400 && W <= 4000 && H <= 4000)) {
  throw new Error(`unreasonable cover size: ${sizeArg}`);
}
const OUT = process.argv.find((a) => a.endsWith('.png'))
  ?? path.join(ROOT, 'screenshots', `cover-devpost-${W}x${H}.png`);

/** The ONLY colours allowed anywhere in the template or the bitmap. */
const PALETTE = ['#101114', '#1f2326', '#96a2a8', '#d4a853', '#e06338', '#f4efe6'];

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
  throw new Error('no Chromium found — set $SHOT_BROWSER');
}

/**
 * The cover template. Colour rule: ONLY the six palette hex codes (the
 * assertion below enforces it before anything renders). Geometry: the
 * monogram is the EXACT inline-SVG geometry the production bundle ships
 * (scripts/monogramIcon.mjs -> favicon), typography mirrors
 * client/src/css/typography.css (--font-serif for the brand, --font-mono
 * for the technical lines).
 */
const templateFor = (W, H) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    background: #101114;
    color: #f4efe6;
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    position: relative;
  }
  .frame {
    position: absolute; inset: 16px;
    border: 2px solid #96a2a8;
    pointer-events: none;
  }
  .stage {
    position: absolute; inset: 16px;
    padding: 54px 64px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .top { display: flex; align-items: center; gap: 34px; }
  .mark { width: 96px; height: 96px; flex: 0 0 auto; }
  .titles h1 {
    font-family: 'Lora', 'Georgia', serif;
    font-size: 66px; font-weight: 600; letter-spacing: 6px;
    color: #f4efe6; line-height: 1;
  }
  .rule { width: 320px; height: 3px; background: #d4a853; margin-top: 18px; }
  .subtitle {
    margin-top: 16px; font-size: 19px; line-height: 1.5;
    color: #96a2a8; max-width: 720px;
  }
  .chips { display: flex; gap: 18px; }
  .chip {
    border: 2px solid #96a2a8; background: #1f2326;
    padding: 12px 22px; font-size: 17px; letter-spacing: 2px;
    color: #f4efe6;
  }
  .chip b { color: #d4a853; font-weight: 600; }
  .chip i { color: #e06338; font-style: normal; font-weight: 600; }
  .bottom {
    display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 16px; color: #96a2a8;
  }
  .bottom .url { color: #d4a853; font-size: 19px; letter-spacing: 1px; }
  .dot { display: inline-block; width: 10px; height: 10px; background: #e06338;
         margin-right: 10px; vertical-align: middle; }
</style>
</head>
<body>
  <div class="frame"></div>
  <div class="stage">
    <div class="top">
      <svg class="mark" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"
           role="img" aria-label="SUTO OSNOVA monogram">
        <rect width="32" height="32" rx="6" fill="#101114"/>
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="#96a2a8" stroke-width="2.3"/>
        <path d="M20.5 11.5 C20.5 8.5 11.5 8.5 11.5 12.5 C11.5 15.5 20.5 16.5 20.5 20.5 C20.5 24.5 11.5 24.5 11.5 20.5"
              fill="none" stroke="#d4a853" stroke-width="2.6" stroke-linecap="round"/>
      </svg>
      <div class="titles">
        <h1>SUTO OSNOVA</h1>
        <div class="rule"></div>
        <div class="subtitle">Autonomous cultural intelligence &amp; mise-en-scene worldbuilding agent</div>
      </div>
    </div>
    <div class="chips">
      <div class="chip"><b>01</b> WORLDBUILDER</div>
      <div class="chip"><b>02</b> EXPERIENTIAL</div>
      <div class="chip"><i>03</i> TASTE ANTITHESIS</div>
    </div>
    <div class="bottom">
      <div><span class="dot"></span>Powered by the Qloo Taste AI graph — 250M+ entities</div>
      <div class="url">suto-osnova.netlify.app</div>
    </div>
  </div>
</body>
</html>`;

/** Every literal colour in the template must be one of the six. */
function assertPaletteLocked(template) {
  const hexes = [...template.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
  const alien = hexes.filter((hex) => !PALETTE.includes(hex));
  if (alien.length > 0) {
    throw new Error(`template colour lock violated: ${[...new Set(alien)].join(', ')}`);
  }
  if (/rgba?\(/.test(template)) {
    throw new Error('template must not use rgb()/rgba() — palette hexes only');
  }
  return [...new Set(hexes)];
}

async function main() {
  const used = assertPaletteLocked(templateFor(W, H));
  const { default: puppeteer } = await import('puppeteer-core');
  const executablePath = await resolveBrowser();
  console.log(`browser: ${executablePath}`);
  console.log(`palette lock: ${used.length}/6 distinct colours in template`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-first-run', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(templateFor(W, H), { waitUntil: 'load' });
    const raw = await page.screenshot({ type: 'png' });

    // Browser-side quantization: decode -> snap every pixel to the
    // nearest palette colour -> encode, all inside Chromium (no local
    // PNG codec needed, and the palette list travels as data).
    const quantizedBase64 = await page.evaluate(async (pngBase64, palette) => {
      const blob = await (await fetch(`data:image/png;base64,${pngBase64}`)).blob();
      const img = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const image = ctx.getImageData(0, 0, img.width, img.height);
      const rgb = palette.map((hex) => [
        parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
      ]);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        let best = rgb[0];
        let bestD = Infinity;
        for (const entry of rgb) {
          const d = (entry[0] - data[i]) ** 2 + (entry[1] - data[i + 1]) ** 2
            + (entry[2] - data[i + 2]) ** 2;
          if (d < bestD) { bestD = d; best = entry; }
        }
        data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2]; data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await out.arrayBuffer());
      let binary = '';
      for (const byte of buf) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, raw.toString('base64'), PALETTE);

    const bytes = Buffer.from(quantizedBase64, 'base64');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== W || height !== H) {
      throw new Error(`cover dimensions ${width}x${height} != ${W}x${H}`);
    }
    await writeFile(OUT, bytes);
    const report = {
      name: path.basename(OUT), width, height, bytes: (await stat(OUT)).size,
      palette: PALETTE, quantized: true, templateColours: used,
    };
    await writeFile(path.join(path.dirname(OUT), 'cover-report.json'),
      JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 1));
    console.log(`OK: cover written to ${path.relative(ROOT, OUT)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`cover run failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});

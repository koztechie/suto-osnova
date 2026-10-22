/**
 * CLIENT BUILD (task 171) — runs the Vite production build (CSS
 * minification + JS compression) and preserves the `./public/…` asset
 * contract, inlines the built stylesheet into the HTML (zero render-
 * blocking requests), then reports the source-vs-built size win.
 *
 * Usage:  node scripts/buildClient.mjs     (or `npm run build`)
 *
 * STEPS:
 *   1. `vite build` (config in vite.config.js) -> `dist/` with minified,
 *      bundled, hashed CSS + JS (Vite rewrites every asset reference —
 *      favicon, <img>, og:image — to hashed /assets/… URLs);
 *   2. copy `client/public/robots.txt` -> `dist/robots.txt` (crawlers
 *      expect it at the web root);
 *   3. INLINE the single built stylesheet into `dist/index.html`
 *      (Lighthouse "render-blocking requests"): the <link
 *      rel="stylesheet"> becomes an inline <style> block, so first
 *      paint needs zero extra round trips. The hashed
 *      /assets/style-*.css file STAYS in dist/ — harmless (immutable-
 *      cached, unreferenced) and the minification/budget gates keep
 *      measuring the real emitted bundle;
 *   4. print the source -> built size reduction for CSS and JS.
 *
 * The `client/` SOURCE is never modified — it stays the dev truth.
 */
import { build } from 'vite';
import { readdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractStylesheetHref, inlineStylesheet } from './lib/inlineStylesheet.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT = path.join(ROOT, 'client');
const DIST = path.join(ROOT, 'dist');

/** Total bytes of every file under `dir` matching `ext`. */
async function totalBytes(dir, ext) {
  let sum = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (full.endsWith(ext)) sum += (await stat(full)).size;
    }
  };
  await walk(dir);
  return sum;
}

async function main() {
  const srcCss = await totalBytes(path.join(CLIENT, 'src', 'css'), '.css');
  const srcJs = await totalBytes(path.join(CLIENT, 'src', 'js'), '.js');

  // The Vite build (reads vite.config.js from the repo root). Vite 8
  // rewrites every asset reference (favicon links, <img>, og:image) to
  // hashed /assets/… URLs, so no ./public/ copy is needed — the only
  // file crawlers expect at the web ROOT is robots.txt.
  await build({ configFile: path.join(ROOT, 'vite.config.js') });

  // robots.txt at the web root.
  await copyFile(path.join(CLIENT, 'public', 'robots.txt'), path.join(DIST, 'robots.txt'));

  // 3. Inline the single built stylesheet into dist/index.html —
  //    removes the render-blocking /assets/style-*.css request from
  //    the critical path (Lighthouse). Fails the BUILD loudly on any
  //    markup/CSS ambiguity rather than shipping an unstyled page.
  const indexPath = path.join(DIST, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const stylesheetHref = extractStylesheetHref(html);
  const stylesheet = await readFile(path.join(DIST, stylesheetHref.replace(/^\//, '')), 'utf8');
  await writeFile(indexPath, inlineStylesheet(html, stylesheet));

  // 4. Report the size win.
  const builtCss = await totalBytes(path.join(DIST, 'assets'), '.css');
  const builtJs = await totalBytes(path.join(DIST, 'assets'), '.js');
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;
  const pct = (from, to) => `${((1 - to / from) * 100).toFixed(1)}%`;

  process.stdout.write('SUTO OSNOVA client build (Vite)\n');
  process.stdout.write(`  CSS: ${kb(srcCss)} source -> ${kb(builtCss)} minified (-${pct(srcCss, builtCss)})\n`);
  process.stdout.write('  CSS inlined into index.html (render-blocking stylesheet requests: 0)\n');
  process.stdout.write(`  JS:  ${kb(srcJs)} source -> ${kb(builtJs)} minified (-${pct(srcJs, builtJs)})\n`);
  process.stdout.write(`  output: ${path.relative(ROOT, DIST)}/\n`);
}

main().catch((error) => {
  process.stderr.write(`build failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});

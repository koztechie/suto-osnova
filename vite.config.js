/**
 * Vite build config (task 171) — OPT-IN PRODUCTION optimization of the
 * client assets: CSS minification + JavaScript minification/compression.
 *
 * ARCHITECTURAL BOUNDARY (deliberate): `client/` remains the SOURCE OF
 * TRUTH — vanilla ES6+ modules, no framework, served raw by
 * scripts/serveClient.mjs in development. Vite is a BUILD-TIME tool
 * ONLY (a devDependency): it never runs in production, ships nothing,
 * and imposes no framework. `npm run build` produces a minified `dist/`
 * for deployment; the dev model and every client gate are untouched.
 *
 * WHY `publicDir: false`: the source references its public assets with
 * a `./public/…` prefix (og:image, favicon) — the contract that makes
 * the RAW-served model work. Vite's default publicDir would hoist those
 * to the dist ROOT, breaking the prefix. Instead the build copies
 * `client/public/` to `dist/public/` (and `robots.txt` to the dist
 * root) in scripts/buildClient.mjs, preserving the contract exactly.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: false, // public assets are copied verbatim by the build script
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // Minification is ON by default in a Vite build (the rolldown/oxc
    // toolchain compresses JS — whitespace, comments, dead branches —
    // and minifies CSS). Explicit CSS flag documented; JS minify uses
    // the built-in default so no extra minifier dependency is needed.
    cssMinify: true,
    // A single CSS file (main.css + its @imports) and a single JS entry
    // (main.js + its module graph) — the smallest render-blocking set.
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Deterministic names keep the build reproducible and diffable.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

/**
 * CSS INLINING for the production build (Lighthouse: "render-blocking
 * requests", ~300 ms off the critical path). Vite emits ONE minified CSS
 * bundle (cssCodeSplit: off) referenced by a single <link
 * rel="stylesheet"> in <head> — the ONLY render-blocking request the
 * page has (the ES-module script is deferred by spec). This module
 * replaces that link with an inline <style> block so first paint needs
 * ZERO extra round trips.
 *
 * PURE FUNCTIONS, no filesystem access — the fs glue lives in
 * scripts/buildClient.mjs; the rules are pinned by
 * server/test/buildInlineStylesheet.test.js.
 *
 * FAIL-FAST CONTRACT (a silent mismatch would ship an UNSTYLED page, so
 * every ambiguity throws and fails the build instead):
 *   - exactly ONE stylesheet link must be present (0 or >1 -> throw);
 *   - that link must carry an href (missing -> throw);
 *   - the CSS must not be empty and must not contain "</style" (it
 *     would terminate the inline block early).
 *
 * Attribute order is NOT assumed (`rel` may precede or follow `href`)
 * so a future Vite markup tweak that still means "stylesheet" keeps
 * working; anything that changes the MEANING fails loudly.
 */

/** Every <link ... rel="stylesheet" ...> in the document (quote-strict). */
const STYLESHEET_LINK = /<link\b(?=[^>]*\brel="stylesheet")[^>]*>/g;

/** Collect the stylesheet <link> tags of an HTML string. */
function stylesheetLinks(html) {
  return [...html.matchAll(STYLESHEET_LINK)];
}

/** The href of the single built stylesheet link (attribute order agnostic). */
export function extractStylesheetHref(html) {
  const links = stylesheetLinks(html);
  if (links.length !== 1) {
    throw new Error(
      `expected exactly ONE <link rel="stylesheet"> in the built HTML, found ${links.length}`,
    );
  }
  const href = links[0][0].match(/\bhref="([^"]+)"/)?.[1];
  if (!href) {
    throw new Error('the stylesheet <link> has no href attribute');
  }
  return href;
}

/** Replace the single stylesheet link with an inline <style> block. */
export function inlineStylesheet(html, css) {
  if (!css || !css.trim()) {
    throw new Error('refusing to inline an empty stylesheet');
  }
  if (css.includes('</style')) {
    throw new Error(
      'refusing to inline CSS containing "</style" (it would terminate the <style> block)',
    );
  }
  const links = stylesheetLinks(html);
  if (links.length !== 1) {
    throw new Error(
      `expected exactly ONE <link rel="stylesheet"> in the built HTML, found ${links.length}`,
    );
  }
  return html.replace(STYLESHEET_LINK, `<style>${css}</style>`);
}

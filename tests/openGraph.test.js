/**
 * OpenGraph gate (task 156) — pins the social preview contract:
 *
 *   - THE TAG SET: og:type/site_name/locale/title/description/url/
 *     image + image dimensions/alt, and the Twitter card set
 *     (summary_large_image + title/description/image/alt) — with the
 *     title and description PARITY-pinned against the page's own
 *     meta description (one honest source, no divergent copy);
 *   - THE DEPLOY CONTRACT: og:url and og:image ship RELATIVE with the
 *     documented rewrite requirement (social crawlers need absolute
 *     URLs); NO fabricated absolute domain may appear in any preview
 *     tag — the repository commits no canonical domain and inventing
 *     one would be a lie;
 *   - THE SOCIAL CARD: client/public/social-card.png byte-equals the
 *     builder output, its IHDR declares exactly 1200x630 (the
 *     summary_large_image size), and every pixel of the raster is a
 *     palette value (the same quantization discipline as the
 *     favicons); the declared og:image dimensions match the real
 *     geometry; two renders are byte-identical (deterministic).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { renderSocialCard, renderSocialCardRaster, SOCIAL_CARD } = await import(
  fileURLToPath(new URL('../scripts/monogramIcon.mjs', import.meta.url))
);

const html = (await readFile(path.join(CLIENT, 'index.html'), 'utf8')).toString('utf8');
const card = await readFile(path.join(CLIENT, 'public', 'social-card.png'));

const PALETTE = new Set(['#101114', '#1f2326', '#96a2a8', '#d4a853', '#e06338', '#f4efe6']);

const meta = (attribute, name) =>
  html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)">`))?.[1] ?? null;

test('the tag set: og + twitter, with honest copy parity', () => {
  const description = meta('name', 'description');
  assert.ok(description, 'the page description exists (the single source)');

  for (const [attribute, name, expected] of [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'SUTO OSNOVA'],
    ['property', 'og:locale', 'en_US'],
    ['property', 'og:title', 'SUTO OSNOVA - Cultural Intelligence Agent'],
    ['property', 'og:description', description],
    ['property', 'og:image:width', String(SOCIAL_CARD.width)],
    ['property', 'og:image:height', String(SOCIAL_CARD.height)],
    ['property', 'og:image:alt', 'SUTO OSNOVA monogram on the archival dark plate'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', 'SUTO OSNOVA - Cultural Intelligence Agent'],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image:alt', 'SUTO OSNOVA monogram on the archival dark plate'],
  ]) {
    assert.equal(meta(attribute, name), expected, `${name} is pinned`);
  }
});

test('the deploy contract: relative urls, no fabricated domain', () => {
  assert.match(html, /DEPLOY CONTRACT[\s\S]*?og:url[\s\S]*?og:image[\s\S]*?ABSOLUTE/,
    'the rewrite contract is documented in the markup');
  assert.equal(meta('property', 'og:url'), './', 'og:url ships relative');
  assert.equal(meta('property', 'og:image'), './public/social-card.png',
    'og:image ships relative, pointing at the real card');
  assert.equal(meta('name', 'twitter:image'), './public/social-card.png',
    'twitter:image mirrors it');

  const previewValues = [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)]
    .map((match) => match[2]);
  for (const value of previewValues) {
    assert.ok(!/^https?:\/\//.test(value),
      `no fabricated absolute URL in any preview tag ("${value}")`);
  }
});

test('the social card: zero drift, real 1200x630, deterministic', async () => {
  assert.deepEqual(card, renderSocialCard(),
    'social-card.png is the generated card (edit the builder, not the file)');

  assert.equal(card.readUInt32BE(16), SOCIAL_CARD.width, 'the PNG IHDR width is 1200');
  assert.equal(card.readUInt32BE(20), SOCIAL_CARD.height, 'the PNG IHDR height is 630');
  assert.equal(meta('property', 'og:image:width'), String(SOCIAL_CARD.width),
    'the declared width matches the geometry');
  assert.equal(meta('property', 'og:image:height'), String(SOCIAL_CARD.height),
    'the declared height matches the geometry');

  assert.deepEqual(renderSocialCard(), renderSocialCard(),
    'two renders are byte-identical (no clock, no RNG)');
});

test('the card raster: every pixel is a palette value', () => {
  const raster = renderSocialCardRaster();
  for (let index = 0; index < raster.length; index += 4) {
    const hex = `#${[raster[index], raster[index + 1], raster[index + 2]]
      .map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(PALETTE.has(hex), `pixel ${index / 4} is ${hex} (a palette value)`);
  }
  assert.equal(raster.length, SOCIAL_CARD.width * SOCIAL_CARD.height * 4,
    'the raster matches the declared canvas');
});

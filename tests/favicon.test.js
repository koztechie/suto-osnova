/**
 * Favicon gate (task 155) — pins the monogram icons:
 *
 *   - ZERO DRIFT: the committed favicon.svg byte-equals the builder's
 *     renderMonogramSvg() and the committed favicon.ico byte-equals
 *     renderIco() — the vector and the raster come from ONE geometry
 *     (scripts/monogramIcon.mjs) and a stale committed file fails;
 *   - ICO STRUCTURE: the container parses — the ICONDIR header
 *     (reserved 0, type icon, three images), one entry per size
 *     (16/32/48) with matching dimensions, and every blob is a REAL
 *     PNG whose IHDR declares the entry's size;
 *   - BINARY PALETTE COMPLIANCE: every OPAQUE pixel of every raster
 *     size is EXACTLY one of the Archival Iron palette values (the
 *     rasterizer quantizes; the corners are transparent) — a
 *     non-palette byte in the bitmap fails;
 *   - DETERMINISM: two renders produce identical buffers (no clock,
 *     no RNG);
 *   - MARKUP: index.html links BOTH icons (the vector for modern
 *     browsers, the .ico for the legacy path).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CLIENT = fileURLToPath(new URL('../client', import.meta.url));
const { renderMonogramSvg, renderIco, renderMonogramRaster, MONOGRAM } = await import(
  fileURLToPath(new URL('../scripts/monogramIcon.mjs', import.meta.url))
);

const svg = await readFile(path.join(CLIENT, 'public', 'favicon.svg'));
const ico = await readFile(path.join(CLIENT, 'public', 'favicon.ico'));
const html = await readFile(path.join(CLIENT, 'index.html'), 'utf8');

const PALETTE = new Set(['#101114', '#1f2326', '#96a2a8', '#d4a853', '#e06338', '#f4efe6']);

test('zero drift: the committed icons equal the builder output', () => {
  assert.equal(svg.toString('utf8'), renderMonogramSvg(),
    'favicon.svg is the generated monogram (edit the geometry in the builder, not the file)');
  assert.deepEqual(ico, renderIco(),
    'favicon.ico is the generated raster (byte-identical)');
});

test('the vector monogram: palette-only shapes, no font, no emoji', () => {
  const text = svg.toString('utf8');
  for (const match of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = match[0];
    assert.ok(PALETTE.has(hex.toLowerCase()), `${hex} is a palette value`);
  }
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'no emoji in the vector');
  assert.ok(!/<text|font-family/.test(text), 'the monogram is pure shapes (no font dependency)');
  assert.ok(/<circle/.test(text) && /<path/.test(text),
    'the monogram carries the ring (O) and the arc mark (S)');
  assert.ok(text.includes(MONOGRAM.sPath), 'the S centreline matches the shared geometry');
});

test('the ico container parses: header, entries, real PNGs', () => {
  assert.equal(ico.readUInt16LE(0), 0, 'reserved must be 0');
  assert.equal(ico.readUInt16LE(2), 1, 'type must be icon');
  const count = ico.readUInt16LE(4);
  assert.equal(count, MONOGRAM.icoSizes.length, 'one entry per size');

  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  MONOGRAM.icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size, `entry ${index} width is ${size}`);
    assert.equal(ico[entry + 1], size, `entry ${index} height is ${size}`);
    assert.equal(ico.readUInt16LE(entry + 6), 32, 'bits per pixel: 32 (RGBA)');
    const blobSize = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const blob = ico.subarray(offset, offset + blobSize);
    assert.equal(blobSize, blob.length, 'the size field matches the payload');
    assert.ok(blob.subarray(0, 8).equals(pngMagic), `entry ${index} payload is a real PNG`);
    assert.equal(blob.readUInt32BE(16), size, `the PNG IHDR width is ${size}`);
    assert.equal(blob.readUInt32BE(20), size, `the PNG IHDR height is ${size}`);
  });
});

test('binary palette compliance: every opaque pixel is a palette value', () => {
  const allowed = new Set(PALETTE);
  for (const size of MONOGRAM.icoSizes) {
    const rgba = renderMonogramRaster(size);
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 3] === 0) continue; // transparent corner
      const hex = `#${[rgba[index], rgba[index + 1], rgba[index + 2]]
        .map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      assert.ok(allowed.has(hex), `${size}px pixel ${index / 4} is ${hex} (a palette value)`);
    }
  }
});

test('determinism and markup: identical bytes, both icons linked', () => {
  assert.deepEqual(renderIco(), renderIco(), 'two renders are byte-identical (no clock, no RNG)');
  assert.equal(renderMonogramSvg(), renderMonogramSvg(), 'same for the vector');

  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\.\/public\/favicon\.svg">/,
    'the vector icon is linked (modern path)');
  assert.match(html, /<link rel="shortcut icon" type="image\/x-icon" href="\.\/public\/favicon\.ico">/,
    'the .ico is linked (legacy path)');
});

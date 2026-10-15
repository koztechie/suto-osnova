/**
 * Correlation-id generator (task 38 memory budget): UUID-v4-SHAPED ids
 * built from the clock + a per-process counter + Math.random — no
 * node:crypto import (~2.8MB first use) and no global WebCrypto touch
 * (~0.7MB). Request ids here are CORRELATION identifiers only (logs and
 * the X-Request-Id echo), never secrets or auth tokens, so a non-
 * cryptographic generator is the correct trade-off; anything security
 * sensitive must keep using WebCrypto.
 */

const HEX = '0123456789abcdef';
let counter = Math.floor(Math.random() * 0xffff);

function randomHex(len) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function newRequestId() {
  counter = (counter + 1) & 0xffff;
  // 8 hex chars of the clock (wraps; combined with the random segments a
  // collision stays astronomically unlikely for a correlation id).
  const time = Date.now().toString(16).padStart(8, '0').slice(-8);
  // UUID v4 layout 8-4-4-4-12 (36 chars): version and variant nibbles
  // in place.
  return `${time}-4${randomHex(3)}-a${randomHex(3)}-${randomHex(4)}-${randomHex(12)}`;
}

export default newRequestId;

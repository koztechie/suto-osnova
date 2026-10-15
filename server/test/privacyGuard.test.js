import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  PII_TYPES,
  REDACTED,
  PrivacyError,
  sanitizeText,
  sanitizeTransportValue,
  sanitizeInput,
  detectPersonalData,
  assertNoPersonalData,
  redactionSummary,
} = await import('../src/services/privacyGuard.js');

// --- pattern redaction: unambiguous PII -----------------------------------------

test('redacts emails, including plus-tags and subdomains', () => {
  const { value, findings } = sanitizeText(
    'write to john.doe@example.com or user+tag@sub.example.co.uk today'
  );
  assert.ok(!value.includes('john.doe@example.com'));
  assert.ok(!value.includes('user+tag@sub.example.co.uk'));
  assert.ok(value.includes(REDACTED));
  assert.equal(findings.filter((f) => f.type === 'email').length, 2);
});

test('redacts IPv4 (octet-validated) and both IPv6 forms, not timestamps', () => {
  const cases = [
    ['server at 192.168.1.10 responded', '192.168.1.10'],
    ['gateway 10.0.0.7 is down', '10.0.0.7'],
    ['v6 host 2001:db8::1 reachable', '2001:db8::1'],
    ['v6 full fe80:0:0:0:0:0:0:1 form', 'fe80:0:0:0:0:0:0:1'],
  ];
  for (const [input, leaked] of cases) {
    const { value, findings } = sanitizeText(input);
    assert.ok(!value.includes(leaked), `${input}: PII must be gone`);
    assert.ok(value.includes(REDACTED), `${input}: placeholder present`);
    assert.ok(findings.some((f) => f.type === 'ipv4' || f.type === 'ipv6'));
  }
  // out-of-range octet is NOT an IP (anti-FP)
  assert.equal(sanitizeText('error 999.999.999.999 in config').value, 'error 999.999.999.999 in config');
  // Qloo opening-hours timestamps must never match
  assert.equal(sanitizeText('hours T06:00:00-T22:00:00').value, 'hours T06:00:00-T22:00:00');
});

test('redacts SSNs and Luhn-valid cards only', () => {
  assert.equal(sanitizeText('ssn 123-45-6789 on file').value, `ssn ${REDACTED} on file`);
  assert.equal(sanitizeText('card 4111 1111 1111 1111 charged').value, `card ${REDACTED} charged`);
  // Luhn-INVALID digit run stays (it is not a card)
  assert.equal(
    sanitizeText('ref 1111-1111-1111-1111 ignored').value,
    'ref 1111-1111-1111-1111 ignored'
  );
});

test('redacts phones by default with tunable modes', () => {
  for (const phone of [
    '(555) 123-4567',
    '555-123-4567',
    '+1 555 123 4567',
    '1-800-273-8255',
  ]) {
    const { value, findings } = sanitizeText(`call ${phone} now`);
    assert.ok(!value.includes(phone.replace(/[()]/g, '')), phone);
    assert.ok(findings.some((f) => f.type === 'phone'));
  }
  // detect mode: reported, not redacted
  const detect = sanitizeText('call 555-123-4567 now', { phones: 'detect' });
  assert.ok(detect.value.includes('555-123-4567'));
  assert.ok(detect.findings.some((f) => f.type === 'phone'));
  // ignore mode: fully clean
  const ignored = sanitizeText('call 555-123-4567 now', { phones: 'ignore' });
  assert.ok(ignored.value.includes('555-123-4567'));
  assert.equal(ignored.findings.length, 0);
});

test('redacts JWTs', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const { value, findings } = sanitizeText(`token ${jwt}`);
  assert.ok(!value.includes('eyJhbGci'));
  assert.ok(findings.some((f) => f.type === 'jwt'));
});

// --- false-positive resistance: cultural data must survive -----------------------

test('cultural titles, URNs, UUIDs, dates and coordinates are untouched', () => {
  const clean = [
    'Phoebe Bridgers',
    'Blade Runner 2049',
    'Kendrick Lamar',
    'Beverly Hills 90210', // zip-code-shaped TV title
    'Taylor Swift 1989', // year-shaped album title
    'Spider-Man: No Way Home',
    'urn:tag:genre:media:comedy',
    'urn:entity:movie',
    'AFBC71A7-9439-4AB0-AB68-D14B11AAF836',
    'release_date 2020-12-25',
    'POINT(-73.99823 40.722668)',
    '40.742306,-74.003494',
    'hours T06:00:00',
  ];
  for (const text of clean) {
    const { value, findings } = sanitizeText(text);
    assert.equal(value, text, `must not be modified: ${text}`);
    assert.deepEqual(findings, [], `must not be reported: ${text}`);
  }
});

test('sanitizeText passes non-strings and empty values through', () => {
  assert.equal(sanitizeText(42).value, 42);
  assert.equal(sanitizeText(null).value, null);
  assert.equal(sanitizeText('').value, '');
  assert.deepEqual(sanitizeText('x@y.co').findings.length, 1);
});

// --- findings are always masked ---------------------------------------------------

test('findings never echo the raw PII and summary counts by type', () => {
  const { findings } = sanitizeText('leak secret.name@example.com and 10.1.2.3');
  assert.ok(findings.length >= 2);
  const dump = JSON.stringify(findings);
  assert.ok(!dump.includes('secret.name@example.com'), 'raw email must not appear');
  assert.ok(!dump.includes('10.1.2.3'), 'raw IP must not appear');
  for (const f of findings) {
    assert.ok(f.masked.length <= 8, `masked preview too long: ${f.masked}`);
    assert.ok(!f.masked.includes('@') || f.masked.includes('…'));
  }
  assert.equal(redactionSummary(findings), 'email×1, ipv4×1');
  assert.ok(PII_TYPES.includes('email'));
});

// --- transport layer: structure preserved, no key denylist -------------------------

test('sanitizeTransportValue preserves structure and scalar types', () => {
  const input = {
    query: 'contact admin@site.org',
    take: 5,
    flag: true,
    nothing: null,
    nested: { list: ['a@b.co', 42, { ip: '8.8.8.8' }] },
  };
  const { value, findings } = sanitizeTransportValue(input);
  assert.equal(value.take, 5);
  assert.equal(value.flag, true);
  assert.equal(value.nothing, null);
  assert.equal(value.query, `contact ${REDACTED}`);
  assert.equal(value.nested.list[0], REDACTED);
  assert.equal(value.nested.list[1], 42);
  assert.equal(value.nested.list[2].ip, REDACTED);
  assert.equal(findings.length, 3);
  // the input object is never mutated
  assert.ok(input.query.includes('admin@site.org'));
});

test('transport scans object KEYS (maps keyed by email cannot leak)', () => {
  const { value, findings } = sanitizeTransportValue({ 'john@x.com': 1, ok: 2 });
  assert.equal(value[REDACTED], 1);
  assert.equal(value.ok, 2);
  assert.ok(findings.some((f) => f.location === 'key'));
});

test('transport does NOT apply the input key-denylist (endpoint params are legit)', () => {
  // `name`/`address` are legitimate Qloo query params; the transport layer
  // only pattern-redacts VALUES.
  const { value } = sanitizeTransportValue({ name: 'Blade Runner', 'filter.address': 'New York' });
  assert.equal(value.name, 'Blade Runner');
  assert.equal(value['filter.address'], 'New York');
});

test('transport handles cycles and depth caps without crashing', () => {
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  const { value } = sanitizeTransportValue(cyclic);
  assert.equal(value.self, '[Circular]');

  let deep = { leaf: 'end' };
  for (let i = 0; i < 6; i += 1) deep = { child: deep };
  const capped = sanitizeTransportValue(deep, { maxDepth: 3 });
  assert.ok(JSON.stringify(capped.value).includes('[Truncated]'));
});

// --- input boundary: key denylist ----------------------------------------------------

test('sanitizeInput redacts denylisted personal fields wholesale', () => {
  const input = {
    email: 'user@x.com',
    first_name: 'John',
    firstName: 'John', // camelCase normalizes to the same key
    'E-Mail': 'u@x.com', // separator/case variants
    phone: '(555) 123-4567',
    ssn: '123-45-6789',
    user: { nested: { deep: 'secret' } }, // whole subtree redacted
    api_key: 'sk-live-123',
    query: 'Kendrick Lamar', // non-PII field survives
  };
  const { value, findings } = sanitizeInput(input);

  assert.equal(value.email, REDACTED);
  assert.equal(value.first_name, REDACTED);
  assert.equal(value.firstName, REDACTED);
  assert.equal(value['E-Mail'], REDACTED);
  assert.equal(value.phone, REDACTED);
  assert.equal(value.ssn, REDACTED);
  assert.equal(value.user, REDACTED, 'subtree under a denylisted key is gone');
  assert.equal(value.api_key, REDACTED);
  assert.equal(value.query, 'Kendrick Lamar');
  assert.ok(findings.filter((f) => f.type === 'denylisted_key').length >= 8);
});

test('sanitizeInput allowKeys exempts specific fields', () => {
  const { value } = sanitizeInput(
    { name: 'Blade Runner', email: 'x@y.co' },
    { allowKeys: ['name'] }
  );
  assert.equal(value.name, 'Blade Runner', 'allowed key preserved');
  assert.equal(value.email, REDACTED, 'others still redacted');
});

test('name self-disclosure is DETECT-ONLY (titles like "My Name Is" stay intact)', () => {
  const { value, findings } = sanitizeInput({ note: 'my name is Taylor Swift' });
  assert.equal(value.note, 'my name is Taylor Swift', 'never auto-redacted');
  assert.ok(findings.some((f) => f.type === 'name_hint'), 'but reported');

  // an Eminem song title must survive the hint scan too
  const title = sanitizeInput({ query: 'My Name Is' });
  assert.equal(title.value.query, 'My Name Is');
});

test('detectPersonalData reports without mutating the input', () => {
  const input = { email: 'a@b.co', tags: ['ok', 'ping 8.8.4.4'] };
  const findings = detectPersonalData(input);
  assert.ok(findings.length >= 2);
  assert.ok(input.email === 'a@b.co', 'input untouched');
  assert.ok(findings.every((f) => typeof f.type === 'string' && f.path !== undefined));
});

// --- hard gate ------------------------------------------------------------------------

test('assertNoPersonalData throws a masked PrivacyError on PII', () => {
  assert.throws(
    () => assertNoPersonalData({ query: 'mail me at a@b.co' }),
    (err) => {
      assert.ok(err instanceof PrivacyError);
      assert.equal(err.code, 'PII_DETECTED');
      assert.ok(err.findings.length >= 1);
      assert.ok(!JSON.stringify(err.findings).includes('a@b.co'), 'masked');
      assert.match(err.message, /email×1/);
      return true;
    }
  );
  // clean input passes through identity
  const clean = { query: 'Blade Runner', take: 5 };
  assert.equal(assertNoPersonalData(clean), clean);
});

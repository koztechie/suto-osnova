/**
 * PrivacyNotice gate (task 107) — the no-personal-data disclaimer:
 *   - the constant text is FIXED, honest, and grounded (no fabricated
 *     legal claims; every guarantee maps to an implemented control);
 *   - the DossierFormatter integration (the privacy section is on
 *     EVERY document, last, regardless of mode);
 *   - zero emojis, no banned hex, the render contract;
 *   - the Markdown and HTML paths carry it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QLOO_API_KEY = 'privacy-notice-key';
process.env.MOCK_MODE = 'false';
process.env.QLOO_CACHE_ENABLED = 'false';

const { PRIVACY_NOTICE, renderPrivacyNotice } = await import('../src/formatters/PrivacyNotice.js');
const { formatDossier, LAYOUTS } = await import('../src/formatters/DossierFormatter.js');
const { markdownFromBundle } = await import('../src/formatters/MarkdownExporter.js');
const { exportHtml } = await import('../src/formatters/HtmlPrintFormatter.js');

const bundle = () => ({
  mode: 'activation',
  entity: { id: 'a1000100-1111-4222-8333-444455556666', name: 'X', category: 'music' },
  ranked: [{ id: '00000000-1111-4222-8333-444455556666', name: 'Neighbor 0', domain: 'music' }],
});

test('the notice is honest, fixed, and grounded', () => {
  const text = renderPrivacyNotice();
  assert.equal(text, PRIVACY_NOTICE, 'renderPrivacyNotice returns the constant');
  assert.match(text, /^PRIVACY NOTICE — no personal data is collected$/m);
  // The implemented controls it cites.
  assert.match(text, /models the taste of cultural entities, never people/);
  assert.match(text, /HTTP 400 PII_DETECTED/, 'the input-boundary rejection code');
  assert.match(text, /redacted before it leaves the server/);
  assert.match(text, /No tracking, analytics, or advertising cookies/);
  assert.match(text, /never sent to the browser/, 'the API key stays server-side');
  assert.match(text, /not user identity/, 'session records carry no user identity');
  // No fabricated legal certification is asserted.
  assert.ok(!/GDPR|CCPA|SOC ?2|ISO ?27001|certif/i.test(text),
    'no unverifiable compliance claim');
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'zero emojis');
});

test('the privacy section rides EVERY document, last, regardless of mode', () => {
  for (const mode of ['worldbuilder', 'activation', 'antithesis']) {
    assert.ok(LAYOUTS[mode].includes('privacy'), `${mode} carries the notice`);
    assert.equal(LAYOUTS[mode][LAYOUTS[mode].length - 1], 'privacy',
      'the notice is the closing block');
  }
  // A minimal bundle still gets the notice (it is policy, not data).
  const doc = formatDossier({ mode: 'activation', entity: { name: 'X' } });
  const privacy = doc.sections.find((s) => s.id === 'privacy');
  assert.ok(privacy, 'the privacy section is present');
  assert.equal(privacy.title, 'PRIVACY NOTICE');
  assert.match(privacy.body, /no personal data is collected/);
  assert.ok(doc.document.indexOf('PRIVACY NOTICE') > doc.document.indexOf('ANCHOR'),
    'it comes after the anchor');
});

test('the Markdown and HTML paths carry the notice', () => {
  const b = bundle();
  const md = markdownFromBundle(b);
  assert.match(md, /^## PRIVACY NOTICE$/m);
  assert.match(md, /no personal data is collected/);
  assert.match(md, /^- No tracking, analytics, or advertising cookies are set\.$/m,
    'the bullet renders as a top-level Markdown list item');

  const html = exportHtml(b);
  assert.match(html, /<h2>PRIVACY NOTICE<\/h2>/);
  assert.ok(html.includes('no personal data is collected'));
  assert.ok(!/<script/i.test(html));
});

test('determinism and the render TypeError', () => {
  assert.equal(renderPrivacyNotice(), renderPrivacyNotice());
  assert.ok(Object.isFrozen(PRIVACY_NOTICE));
});

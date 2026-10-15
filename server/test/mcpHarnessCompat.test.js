import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyHarnessCompat } from '../../scripts/verify-harness-compat.mjs';

// Task 33: our MCP server vs the official qloo-harness `qloo mcp`
// adapter, driven through the IDENTICAL stdio handshake. The verifier
// spawns both real processes; the harness child runs WITHOUT any QLOO_*
// credentials (its qloo_capabilities is documented offline-safe).
// Generous timeout: harness boot takes seconds on cold cache.
test(
  'our MCP server passes every harness compatibility check',
  { timeout: 120_000 },
  async () => {
    const { ok, report } = await verifyHarnessCompat();

    const failures = report.filter((r) => !r.ok);
    assert.deepEqual(
      failures,
      [],
      'failed checks:\n' +
        failures.map((f) => `  [${f.server}] ${f.name} ${f.detail}`).join('\n')
    );
    // Sanity: the report must cover both servers + the interop overlap.
    assert.ok(report.some((r) => r.server === 'ours'), 'our server checked');
    assert.ok(report.some((r) => r.server === 'harness'), 'harness checked');
    assert.ok(report.some((r) => r.server === 'interop'), 'interop overlap checked');
    assert.ok(ok);
  }
);

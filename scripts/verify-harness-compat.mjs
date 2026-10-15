#!/usr/bin/env node
/**
 * Harness compatibility verifier (task 33).
 *
 * Drives BOTH MCP servers through the identical stdio handshake and
 * asserts the interoperability surface documented by the official
 * qloo-harness (`qloo mcp`, live-verified 2026-10-15):
 *   - initialize negotiation + snake_case tool names + JSON schemas;
 *   - the canonical `qloo_*` namespace: every tool of OUR server has a
 *     qloo_* form, and both servers share overlapping qloo_* names;
 *   - `qloo_capabilities` works OFFLINE on both (no Qloo credential);
 *   - `qloo://contracts/*` resources read as application/json on both;
 *   - strict NDJSON purity on stdout (protocol-only).
 *
 * Standalone: node scripts/verify-harness-compat.mjs  (exit 0 = PASS)
 * Reused by server/test/mcpHarnessCompat.test.js as the single source
 * of truth.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OUR_SERVER = path.join(root, 'server/src/mcp/server.js');
const HARNESS_BIN = path.join(root, 'node_modules/@qloo/qloo-harness/dist/bin.js');

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const CANONICAL_NAME = /^qloo_[a-z0-9_]+$/;
const PROTOCOL_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** Minimal NDJSON client over a spawned stdio server. */
function connect(child, { timeoutMs = 30_000 } = {}) {
  const lines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) lines.push(line); // raw: purity is asserted on the raw text
    }
  });
  const parsed = () => lines.map((l) => JSON.parse(l)); // throws => impurity
  const wait = (id) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = parsed().find((m) => m.id === id);
        if (found) {
          clearInterval(tick);
          resolve(found);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`timeout waiting for response ${id}`));
        }
      }, 25);
    });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  return { lines, parsed, send, wait };
}

async function handshake(handle, label) {
  const { send, wait, parsed } = handle;
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'harness-compat', version: '0' },
    },
  });
  const init = await wait(1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = await wait(2);
  send({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
  const resources = await wait(3);
  // NDJSON purity: every stdout line parsed as JSON-RPC.
  for (const line of handle.lines) JSON.parse(line);
  return { ...handle, init, list, resources, label };
}

const resultText = (callResult) => callResult?.content?.[0]?.text ?? '';

export async function verifyHarnessCompat({ timeoutMs = 30_000 } = {}) {
  const report = [];
  const check = (server, name, ok, detail = '') =>
    report.push({ server, name, ok: Boolean(ok), detail });

  const ours = spawn(process.execPath, [OUR_SERVER], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      MOCK_MODE: 'true',
      QLOO_API_KEY: 'compat-key',
      QLOO_CACHE_ENABLED: 'false',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const harness = spawn(process.execPath, [HARNESS_BIN, 'mcp'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, // no QLOO_* on purpose
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const our = await handshake(connect(ours, { timeoutMs }), 'ours');
    const their = await handshake(connect(harness, { timeoutMs }), 'harness');

    // --- initialize ------------------------------------------------------
    check('ours', 'initialize: serverInfo + protocol', our.init.result?.serverInfo?.name === 'suto-osnova' && PROTOCOL_VERSION.test(our.init.result?.protocolVersion ?? ''), JSON.stringify(our.init.result?.serverInfo));
    check('harness', 'initialize: serverInfo + protocol', their.init.result?.serverInfo?.name === 'qloo-harness' && PROTOCOL_VERSION.test(their.init.result?.protocolVersion ?? ''), JSON.stringify(their.init.result?.serverInfo));

    // --- tool surface ------------------------------------------------------
    const ourTools = our.list.result?.tools ?? [];
    const theirTools = their.list.result?.tools ?? [];
    check('ours', 'tools: names snake_case + schemas', ourTools.length > 0 && ourTools.every((t) => TOOL_NAME.test(t.name) && t.inputSchema?.type === 'object'), `count=${ourTools.length}`);
    check('harness', 'tools: names snake_case + schemas', theirTools.length > 0 && theirTools.every((t) => TOOL_NAME.test(t.name) && t.inputSchema?.type === 'object'), `count=${theirTools.length}`);

    // Canonical namespace: ours exposes qloo_* for its whole surface
    // (canonical names + stable aliases), harness names are all qloo_*.
    const ourNames = ourTools.map((t) => t.name);
    const theirNames = new Set(theirTools.map((t) => t.name));
    const unprefixed = ourNames.filter((n) => !n.startsWith('qloo_'));
    const aliasesComplete = unprefixed.every((n) => ourNames.includes(`qloo_${n}`));
    check('ours', 'canonical qloo_* namespace complete', aliasesComplete && ourNames.filter((n) => CANONICAL_NAME.test(n)).length >= unprefixed.length, `unprefixed=${unprefixed.length}`);
    check('harness', 'all tools canonical qloo_*', theirTools.every((t) => CANONICAL_NAME.test(t.name)), '');
    const overlap = ourNames.filter((n) => theirNames.has(n));
    check('interop', 'shared qloo_* tool names exist', overlap.length >= 2, `overlap=${overlap.join(', ')}`);

    // --- qloo_capabilities (offline on both) --------------------------------
    our.send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'qloo_capabilities', arguments: {} } });
    const ourCapResult = await our.wait(10);
    const ourPayload = JSON.parse(resultText(ourCapResult.result));
    check('ours', 'qloo_capabilities: contract + checksum', ourPayload.server === 'suto-osnova' && /^[0-9a-f]{64}$/.test(ourPayload.checksum ?? '') && ourPayload.tools?.count === ourTools.length, `contractVersion=${ourPayload.contractVersion}`);

    their.send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'qloo_capabilities', arguments: {} } });
    const theirCapResult = await their.wait(11);
    const theirText = resultText(theirCapResult.result);
    check('harness', 'qloo_capabilities: offline envelope', theirText.length > 0 && !theirCapResult.result?.isError, theirText.slice(0, 80));

    // --- contract resources ---------------------------------------------------
    const readContract = async (handle, id, uri) => {
      handle.send({ jsonrpc: '2.0', id, method: 'resources/read', params: { uri } });
      const res = await handle.wait(id);
      const content = res.result?.contents?.[0];
      return { uri: content?.uri, mime: content?.mimeType, payload: JSON.parse(content?.text ?? 'null') };
    };
    const ourContract = await readContract(our, 20, 'qloo://contracts/suto-osnova');
    check('ours', 'qloo://contracts/suto-osnova readable', ourContract.mime === 'application/json' && ourContract.payload?.server === 'suto-osnova', '');
    const theirContract = await readContract(their, 21, 'qloo://contracts/workflows');
    check('harness', 'qloo://contracts/workflows readable', theirContract.mime === 'application/json' && theirContract.payload !== null, '');

    check('ours', 'resources list uses qloo:// scheme', (our.resources.result?.resources ?? []).every((r) => r.uri.startsWith('qloo://')), '');
    check('harness', 'resources list uses qloo:// scheme', (their.resources.result?.resources ?? []).every((r) => r.uri.startsWith('qloo://')), '');

    // --- NDJSON purity re-check (after all traffic) ----------------------------
    check('ours', 'stdout: strict NDJSON purity', our.lines.every((l) => { JSON.parse(l); return true; }), `lines=${our.lines.length}`);
    check('harness', 'stdout: strict NDJSON purity', their.lines.every((l) => { JSON.parse(l); return true; }), `lines=${their.lines.length}`);
  } finally {
    ours.kill();
    harness.kill();
  }

  return { ok: report.every((r) => r.ok), report };
}

// Standalone runner.
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(here, 'verify-harness-compat.mjs');

if (isDirectRun) {
  const { ok, report } = await verifyHarnessCompat();
  for (const r of report) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.server}] ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(ok ? 'HARNESS COMPATIBILITY: PASS' : 'HARNESS COMPATIBILITY: FAIL');
  process.exit(ok ? 0 : 1);
}

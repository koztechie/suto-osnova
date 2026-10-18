/**
 * SUTO OSNOVA — the Raw API Call Inspector (task 148).
 * A modal for TECHNICAL JUDGES demonstrating CLEAN QLOO USAGE: the
 * client's own gateway call log plus the backend's raw provenance,
 * shown verbatim.
 *
 * Three honest evidence surfaces:
 *   1. CLIENT CALL LOG — every request the client made to the LOCAL
 *      gateway (method, path, status, ok, ms), recorded by api.js at
 *      the transport edge and bounded (the newest `limit` entries);
 *   2. QLOO CONNECTIVITY — the LAST SUCCESSFUL health probe's `qloo`
 *      and `transport` blocks (raw JSON; the honest empty state says
 *      "not recorded yet" until a probe answers);
 *   3. PROVENANCE LEDGER — the last dossier envelope's `meta` block
 *      (resolution/expansion/chain/coverage/... — the backend's own
 *      ledger of what Qloo was asked).
 *
 * Contracts:
 *   - RAW VALUES, NEVER REWRITTEN: everything renders via
 *     textContent (JSON.stringify with indent) — zero innerHTML;
 *   - import-safe in Node (no document at load; doc/win injected);
 *   - the modal is a real dialog: role/aria-modal/aria-labelledby,
 *     hidden at rest, Escape closes, the backdrop closes, focus moves
 *     to Close on open and RETURNS to the trigger on close;
 *   - the log is a bounded, injectable store (createCallLog) — the
 *     module singleton (callLog) is the browser's recorder.
 */

/** A bounded FIFO call log. */
export function createCallLog(limit = 100) {
  const entries = [];
  return Object.freeze({
    record(entry) {
      if (!entry || typeof entry !== 'object') return;
      entries.push(Object.freeze({ ...entry }));
      if (entries.length > limit) entries.shift();
    },
    list: () => [...entries],
    clear: () => { entries.length = 0; },
  });
}

/** The browser's call recorder (api.js writes into it). */
export const callLog = createCallLog();

/** Record one gateway call (thin shim over the singleton). */
export function recordCall(entry) {
  callLog.record(entry);
}

/** Pure: one human-readable call row. */
export function formatCallRow(entry) {
  if (!entry || typeof entry !== 'object') return 'unknown call';
  const method = typeof entry.method === 'string' ? entry.method : '?';
  const path = typeof entry.path === 'string' ? entry.path : '?';
  const status = Number.isFinite(entry.status) ? entry.status : 0;
  const ms = Number.isFinite(entry.ms) ? Math.round(entry.ms) : 0;
  return `${method} ${path} -> ${status} (${ms}ms)`;
}

let lastHealth = null;
let lastEnvelopeMeta = null;

/** Store the last SUCCESSFUL health report (the connectivity monitor). */
export function noteHealth(payload) {
  lastHealth = payload ?? null;
}

/** Store the last dossier envelope's provenance ledger (ui.renderJson). */
export function noteEnvelope(payload) {
  lastEnvelopeMeta = payload?.dossier?.meta ?? null;
}

/** Assemble the inspector's evidence (last-write-wins slots). */
export function inspectorData(log = callLog) {
  return {
    calls: log.list(),
    qloo: lastHealth?.qloo ?? null,
    transport: lastHealth?.transport ?? null,
    provenance: lastEnvelopeMeta,
  };
}

/** Render one section: raw JSON, or the honest empty state. */
function renderSection(container, value) {
  container.textContent = value === null || value === undefined
    ? 'not recorded yet'
    : JSON.stringify(value, null, 2);
}

/** Wire the modal: trigger, close, Escape, backdrop. Returns stop(). */
export function startInspector({ doc, win, log = callLog } = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  const windowRef = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!scope || !windowRef) return () => {};

  const modal = scope.getElementById('inspector');
  const trigger = scope.getElementById('open-inspector');
  const closeButton = scope.getElementById('inspector-close');
  const backdrop = scope.getElementById('inspector-backdrop');
  const callsNode = scope.getElementById('inspector-calls');
  const qlooNode = scope.getElementById('inspector-qloo');
  const provenanceNode = scope.getElementById('inspector-provenance');
  if (!modal || !trigger || !closeButton) return () => {};

  const open = () => {
    const data = inspectorData(log);
    if (callsNode) {
      callsNode.textContent = data.calls.length > 0
        ? data.calls.map(formatCallRow).join('\n')
        : 'no calls recorded yet';
    }
    if (qlooNode) {
      renderSection(qlooNode, data.qloo === null ? null : { qloo: data.qloo, transport: data.transport });
    }
    if (provenanceNode) renderSection(provenanceNode, data.provenance);
    modal.hidden = false;
    closeButton.focus();
  };

  const close = () => {
    modal.hidden = true;
    trigger.focus();
  };

  const onKey = (event) => {
    if (!modal.hidden && event.key === 'Escape') close();
  };

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop?.addEventListener?.('click', close);
  windowRef.addEventListener('keydown', onKey);

  return () => {
    trigger.removeEventListener('click', open);
    closeButton.removeEventListener('click', close);
    backdrop?.removeEventListener?.('click', close);
    windowRef.removeEventListener('keydown', onKey);
  };
}

/**
 * SUTO OSNOVA — Qloo link monitor (task 132).
 * Drives the connectivity indicator in the status titlebar.
 *
 * FOUR HONEST STATES (the label text changes with the state, so the
 * signal is never colour-only):
 *   checking — the first probe has not answered yet;
 *   online   — GET /api/health answered 200 (status "ok": Qloo
 *              reachable through the gateway);
 *   degraded — the BACKEND answered but reports status "degraded"
 *              (HTTP 503: the gateway is up, Qloo is not reachable);
 *   offline  — the backend itself is unreachable (network failure).
 *
 * The module is import-safe in Node: NOTHING touches document/window
 * at load time — only inside startConnectivityMonitor(). The mapping
 * (stateFromProbe) and the probe wrapper (probeHealth) are PURE and
 * unit-pinned by tests/titlebar.test.js.
 */
import { fetchHealth } from './api.js';

/** The exact state set the DOM contract uses (data-state). */
export const CONNECTIVITY_STATES = Object.freeze(
  ['checking', 'online', 'degraded', 'offline'],
);

/** Poll cadence. A monitor must never spam the health endpoint. */
export const POLL_INTERVAL_MS = 30_000;

/** Label per state (textContent only — never innerHTML). */
export const CONNECTIVITY_LABELS = Object.freeze({
  checking: 'Qloo link: checking',
  online: 'Qloo link: online',
  degraded: 'Qloo link: degraded',
  offline: 'Qloo link: offline',
});

/** Run one probe without ever throwing: { ok, payload?, error? }. */
export async function probeHealth(fetchImpl = fetchHealth) {
  try {
    return { ok: true, payload: await fetchImpl() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Pure mapping: a probe result -> one connectivity state. An HTTP
 * answer (even a 503) proves the backend is UP (degraded); only a
 * transport failure (no .status) means the whole link is down. A
 * payload without an explicit "ok" status is NEVER claimed online.
 */
export function stateFromProbe(probe) {
  if (probe?.ok) return probe.payload?.status === 'ok' ? 'online' : 'degraded';
  return probe?.error?.status ? 'degraded' : 'offline';
}

/**
 * Start the indicator: an immediate probe (the node sits in
 * "checking" until it answers) and a slow poll; re-probes when the
 * browser regains network (window "online"). Returns a stop() handle.
 */
export function startConnectivityMonitor({ intervalMs = POLL_INTERVAL_MS, win } = {}) {
  const scope = win ?? (typeof window !== 'undefined' ? window : undefined);
  const node = document.getElementById('connectivity');
  const labelNode = document.getElementById('connectivity-label');
  if (!node || !labelNode) return () => {};

  const apply = (state) => {
    node.setAttribute('data-state', state);
    labelNode.textContent = CONNECTIVITY_LABELS[state];
  };

  const tick = async () => {
    apply(stateFromProbe(await probeHealth()));
  };

  apply('checking');
  tick();
  const timer = setInterval(tick, intervalMs);
  scope?.addEventListener?.('online', tick);

  return () => {
    clearInterval(timer);
    scope?.removeEventListener?.('online', tick);
  };
}

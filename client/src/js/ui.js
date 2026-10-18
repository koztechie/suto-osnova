/**
 * SUTO OSNOVA — DOM rendering.
 * Text payloads are always inserted via textContent (never innerHTML).
 * The html format is rendered into a sandboxed iframe via srcdoc, so
 * server HTML cannot touch this document's DOM or cookies.
 */
import { extractAffinities, renderAffinityWidget } from './affinityMeter.js';
import { extractAntithesis, renderAntithesisBlock } from './antithesisBlock.js';

const el = (id) => document.getElementById(id);

export function setStatus(message, tone = 'neutral') {
  const node = el('status');
  node.textContent = message;
  if (tone === 'neutral') {
    node.removeAttribute('data-tone');
  } else {
    node.setAttribute('data-tone', tone);
  }
}

export function setBusy(busy) {
  el('generate').disabled = busy;
}

function hideOutputs() {
  el('output-frame').hidden = true;
  el('output-text').hidden = true;
  el('output-empty').hidden = true;
  el('affinity').hidden = true;
  el('antithesis').hidden = true;
}

/** Render a markdown (or plain-text) payload as preformatted text. */
export function renderText(text) {
  hideOutputs();
  const node = el('output-text');
  node.textContent = text;
  // Markdown/plain text is ANALYTICAL (serif); only the JSON view is
  // tagged technical so the mono stack styles it (typography.css).
  node.removeAttribute('data-format');
  node.hidden = false;
}

/** Render a JSON payload as pretty-printed technical text. */
export function renderJson(payload) {
  renderText(JSON.stringify(payload, null, 2));
  el('output-text').setAttribute('data-format', 'json');
  // The affinity widget (task 144): a discrete summary of the
  // backend-measured connection percentages. renderText hid it; here
  // it shows ONLY when the envelope really carries measured values.
  renderAffinityWidget(el('affinity'), extractAffinities(payload), document);
  // The Cultural Antipode block (task 145): the oxide-accented
  // antithesis display — shown ONLY when Mode 3 data is present.
  renderAntithesisBlock(el('antithesis'), extractAntithesis(payload), document);
}

/** Render the server's print-ready HTML page inside the sandboxed frame. */
export function renderHtml(html) {
  hideOutputs();
  const frame = el('output-frame');
  frame.srcdoc = html;
  frame.hidden = false;
}

/** Route a ({kind,payload}) result from the api client to the right renderer. */
export function renderResult({ kind, payload }) {
  if (kind === 'json') {
    renderJson(payload);
  } else if (kind === 'html') {
    renderHtml(payload);
  } else {
    renderText(payload);
  }
}

export function renderError(error) {
  const suffix = error?.requestId ? ` (request ${error.requestId})` : '';
  setStatus(`${error?.code ?? 'ERROR'}: ${error?.message ?? 'Unknown failure'}${suffix}`, 'error');
}

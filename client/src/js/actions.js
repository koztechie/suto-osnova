/**
 * SUTO OSNOVA — the interactive actions panel (task 146).
 * Export Markdown / Download JSON / Print PDF Dossier.
 *
 * Honesty contracts:
 *   - EVERY action fetches the REAL document from the LOCAL gateway in
 *     the needed format (POST /api/generate/<mode>) — the client
 *     never converts or rewrites a dossier itself; the downloaded
 *     files are byte-identical backend documents (the gateway caches,
 *     so a repeat request is cheap);
 *   - PRINT is XSS-SAFE: the print HTML renders into a dedicated
 *     sandbox iframe with allow-modals (window.print works) but
 *     WITHOUT allow-scripts (server HTML can never execute code in
 *     this document);
 *   - an empty anchor is a STATUS error, never a request; a failed
 *     request reports on the status line and never throws;
 *   - downloads go through Blob + object URLs with an ephemeral
 *     <a download> click (revoked immediately after);
 *   - import-safe in Node: doc/win/generate are injected.
 */
import { generateDossier } from './api.js';

const EXTENSIONS = Object.freeze({ markdown: 'md', json: 'json' });

/** Pure: the download filename for a mode + format. */
export function dossierFilename(mode, format) {
  const safeMode = String(mode ?? 'unknown').replace(/[^\w-]/g, '') || 'unknown';
  const ext = EXTENSIONS[format] ?? 'txt';
  return `suto-osnova-${safeMode}-dossier.${ext}`;
}

/** Save text as a downloaded file (injected doc/win; revokes the URL). */
export function saveText({ win, doc, text, filename, mime }) {
  const blob = new win.Blob([text], { type: mime });
  const url = win.URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  win.URL.revokeObjectURL(url);
}

/** Print the server's print-ready HTML through the sandboxed frame. */
export function printHtml({ frame, html }) {
  frame.onload = () => {
    frame.onload = null;
    frame.contentWindow.print();
  };
  frame.srcdoc = html;
}

/** Wire the three action buttons. Returns a stop() handle. */
export function startActions({
  doc,
  win,
  generateImpl = generateDossier,
  onStatus = () => {},
  onBusy = () => {},
} = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  const windowRef = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!scope || !windowRef) return () => {};

  const form = scope.getElementById('generate-form');
  const printFrame = scope.getElementById('print-frame');
  const buttons = {
    markdown: scope.getElementById('action-markdown'),
    json: scope.getElementById('action-json'),
    print: scope.getElementById('action-print'),
  };
  if (!form || !buttons.markdown || !buttons.json || !buttons.print) return () => {};

  const current = () => ({ seed: form.seed?.value?.trim() ?? '', mode: form.mode?.value });

  const run = async (format, apply) => {
    const { seed, mode } = current();
    if (!seed) {
      onStatus('A cultural anchor is required.', 'error');
      return;
    }
    onBusy(true);
    try {
      const result = await generateImpl({ seed, mode, format });
      apply(result, mode);
      onStatus(`${format} ${format === 'html' ? 'sent to print' : 'export ready'}.`, 'ok');
    } catch (error) {
      onStatus(`${error?.code ?? 'ERROR'}: ${error?.message ?? 'export failed'}`, 'error');
    } finally {
      onBusy(false);
    }
  };

  const handlers = [
    [buttons.markdown, () => run('markdown', (result, mode) => saveText({
      win: windowRef,
      doc: scope,
      text: result.payload,
      filename: dossierFilename(mode, 'markdown'),
      mime: 'text/markdown',
    }))],
    [buttons.json, () => run('json', (result, mode) => saveText({
      win: windowRef,
      doc: scope,
      text: JSON.stringify(result.payload, null, 2),
      filename: dossierFilename(mode, 'json'),
      mime: 'application/json',
    }))],
    [buttons.print, () => run('html', (result) => {
      if (printFrame) printHtml({ frame: printFrame, html: result.payload });
    })],
  ];

  for (const [button, onClick] of handlers) button.addEventListener('click', onClick);

  return () => {
    for (const [button, onClick] of handlers) button.removeEventListener('click', onClick);
  };
}

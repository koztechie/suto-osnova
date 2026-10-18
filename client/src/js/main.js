/**
 * SUTO OSNOVA — client entry point.
 * Wires the generate form to the backend gateway. No framework, no
 * bundler: this file is loaded as a native ES module from index.html.
 */
import { generateDossier } from './api.js';
import { renderResult, renderError, setStatus, setBusy } from './ui.js';
import { startConnectivityMonitor } from './connectivity.js';
import { startAnchorInput } from './anchorInput.js';

const form = document.getElementById('generate-form');

async function onSubmit(event) {
  event.preventDefault();

  const seed = form.seed.value.trim();
  if (!seed) {
    setStatus('A cultural anchor is required.', 'error');
    form.seed.focus();
    return;
  }

  const mode = form.mode.value;
  const format = form.format.value;

  setBusy(true);
  setStatus(`Running ${mode} mode...`);

  try {
    const result = await generateDossier({ seed, mode, format });
    renderResult(result);
    setStatus(`${mode} dossier ready.`, 'ok');
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', onSubmit);

// The status titlebar indicator (task 132): an immediate health probe
// plus a slow poll; offline -> online transitions re-probe.
startConnectivityMonitor();

// The anchor combobox (task 134): Qloo category hints over the
// free-text field; a failed categories probe degrades to no hints.
startAnchorInput();

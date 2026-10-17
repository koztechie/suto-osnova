/**
 * SUTO OSNOVA — client entry point.
 * Wires the generate form to the backend gateway. No framework, no
 * bundler: this file is loaded as a native ES module from index.html.
 */
import { generateDossier } from './api.js';
import { renderResult, renderError, setStatus, setBusy } from './ui.js';

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

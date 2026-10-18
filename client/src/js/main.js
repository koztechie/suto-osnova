/**
 * SUTO OSNOVA — client entry point.
 * Wires the generate form to the backend gateway. No framework, no
 * bundler: this file is loaded as a native ES module from index.html.
 */
import { generateDossier } from './api.js';
import { renderResult, renderError, setStatus, setBusy } from './ui.js';
import { startConnectivityMonitor } from './connectivity.js';
import { startAnchorInput } from './anchorInput.js';
import { startPresets } from './presets.js';
import { startProgress } from './progress.js';
import { startDomainCards } from './domainCards.js';
import { startSonicCard } from './sonicCard.js';
import { startLiteraryCard } from './literaryCard.js';

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
  // The terminal progress readout (task 136): discrete monospace
  // frames while the graph is polled; decorative (aria-hidden) and
  // stopped — and emptied — the moment the request settles.
  const stopProgress = startProgress({
    element: document.getElementById('progress'),
  });

  try {
    const result = await generateDossier({ seed, mode, format });
    renderResult(result);
    setStatus(`${mode} dossier ready.`, 'ok');
  } catch (error) {
    renderError(error);
  } finally {
    stopProgress();
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

// The demo presets (task 135): one-tap seed + mode substitution.
startPresets();

// The cultural domain cards (task 138): plates from /api/categories;
// a failed probe leaves the section hidden.
startDomainCards();

// The Sonic Architecture featured card (task 139): revealed only when
// the registry confirms the music domain queries artist + album.
startSonicCard();

// The Literary Substrate featured card (task 140): revealed only when
// the registry confirms the books domain queries the book entity.
startLiteraryCard();

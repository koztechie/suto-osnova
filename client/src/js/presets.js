/**
 * SUTO OSNOVA — demo presets (task 135).
 * One-tap substitution of the demo scenarios: each preset fills the
 * anchor field with its seed AND selects the matching agent mode, so
 * the user can run a full demo without composing anything.
 *
 * The preset BUTTONS in index.html are the SINGLE SOURCE (data-seed +
 * data-mode attributes); this module is generic dataset-driven wiring —
 * no second copy of the list can drift. The exact three scenarios are
 * pinned by tests/demoPresets.test.js against the markup.
 *
 * Contracts:
 *   - a preset button is type="button" — it NEVER submits the form
 *     (the user still presses Generate deliberately);
 *   - applying is non-destructive: it sets the input value, checks the
 *     matching mode radio, focuses the input for editing and reports
 *     via the status line; the format select is left alone;
 *   - a preset whose mode has no matching radio still applies the
 *     seed (partial application is honest, not a silent no-op).
 *
 * Import-safe in Node: no document at load; every dependency is
 * injected (doc, onApplied) with browser defaults.
 */
import { setStatus } from './ui.js';

/**
 * Apply one preset to the live form. Returns true when the seed was
 * applied (the mode radio is best-effort).
 */
export function applyPreset(preset, { input, form } = {}) {
  if (!input || typeof preset?.seed !== 'string' || preset.seed === '') return false;
  input.value = preset.seed;
  if (preset.mode && form) {
    const radio = form.querySelector(`input[name="mode"][value="${preset.mode}"]`);
    if (radio) radio.checked = true;
  }
  input.focus();
  return true;
}

/** Wire every .preset button. Returns a stop() handle. */
export function startPresets({
  doc,
  onApplied = (message, tone) => setStatus(message, tone),
} = {}) {
  const scope = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!scope) return () => {};
  const input = scope.getElementById('seed');
  const form = scope.getElementById('generate-form');
  const buttons = Array.from(scope.querySelectorAll('.preset') ?? []);
  if (!input || buttons.length === 0) return () => {};

  const wired = [];
  for (const button of buttons) {
    const onClick = () => {
      const preset = {
        seed: button.dataset?.seed,
        mode: button.dataset?.mode,
        label: button.textContent,
      };
      if (applyPreset(preset, { input, form })) {
        onApplied(`Preset applied: ${preset.label}`, 'ok');
      }
    };
    button.addEventListener('click', onClick);
    wired.push({ button, onClick });
  }

  return () => {
    for (const { button, onClick } of wired) button.removeEventListener('click', onClick);
  };
}

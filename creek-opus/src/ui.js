import { PRESET_ORDER } from './presets.js';

// Wires the toolbar, keyboard shortcuts and loading overlay to the app.
export function setupInterface(app) {
  const presetButtons = [...document.querySelectorAll('[data-preset]')];
  const toggleButtons = [...document.querySelectorAll('[data-toggle]')];
  const loading = document.querySelector('.loading');
  const progressLabel = document.querySelector('[data-progress]');

  const sync = () => {
    for (const button of presetButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.preset === app.presetName));
    }
    for (const button of toggleButtons) {
      button.setAttribute('aria-pressed', String(app.toggles[button.dataset.toggle]));
    }
  };

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      app.setPreset(button.dataset.preset);
      sync();
    });
  }
  for (const button of toggleButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.toggle;
      app.setToggle(name, !app.toggles[name]);
      sync();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const index = Number.parseInt(event.key, 10);
    if (index >= 1 && index <= PRESET_ORDER.length) {
      app.setPreset(PRESET_ORDER[index - 1]);
      sync();
    } else if (event.key.toLowerCase() === 'f') {
      app.setToggle('dof', !app.toggles.dof);
      sync();
    } else if (event.key.toLowerCase() === 'c') {
      app.setToggle('dslr', !app.toggles.dslr);
      sync();
    }
  });

  sync();
  return {
    sync,
    progress(fraction) {
      progressLabel.textContent = `${Math.round(fraction * 100)}%`;
    },
    done() {
      loading.classList.add('is-done');
    },
    fail(message) {
      loading.classList.add('has-error');
      loading.querySelector('.loading-progress').textContent = message;
    },
  };
}

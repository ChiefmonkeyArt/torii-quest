// @vitest-environment jsdom
// tests/settings-panel-click.test.js — regression lock for the settings-panel
// click-propagation bug (ADR-0095). The panel card used to call
// `e.stopPropagation()` on every click inside the dialog, which swallowed the
// clicks before they reached the DOCUMENT-level delegated handler in main.js
// that routes every tab's `data-action` buttons (save-profile / remove-relay /
// publish-node / choose-world / character actions / access form). The visible
// symptom: every settings button appeared to "do nothing". The backdrop-close
// already guards with `e.target === backdrop`, so the stopPropagation was both
// redundant and harmful — this test locks that clicks inside the content still
// bubble to document so the delegated router keeps working.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openSettingsPanel,
  closeSettingsPanel,
  registerSettingsTabRenderer,
  _resetForTest,
} from '../src/engine/settings/settingsPanel.js';

function _clearLeftoverPanel() {
  // _resetForTest() only clears internal state, not the DOM — drop any backdrop
  // a prior test appended to document.body.
  const el = typeof document !== 'undefined' ? document : null;
  if (!el) return;
  el.querySelectorAll('#torii-settings-backdrop').forEach((n) => n.remove());
}

beforeEach(() => {
  _resetForTest();
  _clearLeftoverPanel();
});

afterEach(() => {
  try { closeSettingsPanel(); } catch { /* no-op */ }
  _resetForTest();
  _clearLeftoverPanel();
});

describe('settings panel click propagation (ADR-0095 regression)', () => {
  it('lets a data-action button click bubble to a document-level listener', () => {
    let heard = 0;
    document.addEventListener('click', (e) => {
      const t = e && e.target;
      if (t && t.closest && t.closest('#torii-settings-content')) heard += 1;
    });

    registerSettingsTabRenderer('profile', () => '<button type="button" data-action="save-profile">Save</button>');
    openSettingsPanel({ initialTab: 'profile' });

    const btn = document.querySelector('#torii-settings-content button[data-action="save-profile"]');
    expect(btn).not.toBeNull();

    btn.click();

    // With the old stopPropagation() on the card this would be 0 — the click
    // never reached document, so the delegated router never fired.
    expect(heard).toBe(1);
  });

  it('still does not close the panel when clicking inside the card', () => {
    registerSettingsTabRenderer('profile', () => '<button type="button" data-action="save-profile">Save</button>');
    openSettingsPanel({ initialTab: 'profile' });

    const btn = document.querySelector('#torii-settings-content button[data-action="save-profile"]');
    btn.click();

    // Clicking inside the dialog must NOT trigger the backdrop-close path.
    const panel = document.querySelector('#torii-settings-panel');
    expect(panel).not.toBeNull();
  });
});
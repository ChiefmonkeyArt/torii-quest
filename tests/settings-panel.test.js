// tests/settings-panel.test.js — settingsPanel.js tab inventory + wiring
// contracts. Pure (node env, no DOM) — settingsPanel only touches `document`
// inside its lazily-built _build(), so importing it here is safe.
import { describe, it, expect } from 'vitest';
import { getSettingsTabIds, SETTINGS_PANEL_VERSION } from '../src/engine/settings/settingsPanel.js';

describe('settings panel tab inventory (ADR-0078, v0.2.712)', () => {
  it('exposes five tabs with Access re-added at the foot', () => {
    const ids = getSettingsTabIds();
    expect(ids).toEqual(['profile', 'gateway', 'heartbeat', 'relay', 'access']);
  });

  it('includes the Access tab id + label so the nav renders it', () => {
    expect(getSettingsTabIds()).toContain('access');
  });

  it('bumps the panel version surface when the tab set changes', () => {
    // v0.2.712: the tab set grew 4 → 5 (Access re-added), so the panel version
    // surface bumps 1 → 2. A future tab add/remove must bump this too.
    expect(SETTINGS_PANEL_VERSION).toBe(2);
  });
});

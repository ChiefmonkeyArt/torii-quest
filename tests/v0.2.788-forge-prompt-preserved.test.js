// tests/v0.2.788-forge-prompt-preserved.test.js — regression lock for a
// Create-with-AI prompt textarea losing its text a few seconds after typing.
//
// Root cause: the ~10s server-beacon re-sync (_syncServerBeacon, driven by the
// rAF _shellTick every ~600 frames) unconditionally called
// renderActiveSettingsTab() whenever the Settings panel was open. That innerHTML
// swap rebuilt the WHOLE active tab, so a fresh empty textarea replaced the one
// holding the user's in-progress prompt, discarding the text + focus.
//
// Fix (v0.2.788-alpha): gate the periodic repaint to the Heartbeat tab — the
// only tab that sync actually refreshes. Other tabs keep their own event-driven
// re-renders and are no longer clobbered on a timer.
//
// main.js is a large entry module with top-level DOM/init side effects not
// designed for isolated import, so — consistent with the sibling
// main-settings-heartbeat-beacon / main-heartbeat-consent tests — this locks
// the fix at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('main.js — beacon re-sync must not clobber the active settings tab', () => {
  it('imports getActiveSettingsTab so the tab can be checked', () => {
    expect(SRC).toMatch(/import \{[^}]*getActiveSettingsTab[^}]*\} from '\.\/engine\/settings\/settingsPanel\.js'/);
  });

  it('gates the periodic repaint to the heartbeat tab only', () => {
    expect(SRC).toContain("if (isSettingsPanelOpen() && getActiveSettingsTab() === 'heartbeat') renderActiveSettingsTab();");
  });

  it('no longer unconditionally re-renders the open tab on every sync', () => {
    // The old buggy form: any open tab (incl. Character, with its textarea)
    // was repainted every ~10 s, wiping in-progress input.
    expect(SRC).not.toMatch(/if \(isSettingsPanelOpen\(\)\) renderActiveSettingsTab\(\);/);
  });
});
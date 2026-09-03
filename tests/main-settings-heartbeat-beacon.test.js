// tests/main-settings-heartbeat-beacon.test.js — regression lock for the
// Settings > Heartbeat tab showing OFF (red) and refusing to toggle, even
// while the world WAS live (server beacon publishing 24/7).
//
// Root cause (two parts):
//   1. _homepageStubState() returned the raw client heartbeat status
//      (`hb`), which reads 'idle' (→ OFF) whenever only the SERVER beacon is
//      publishing. The in-game menu already applied the ADR-0094 override
//      (`_beacon.state.enabled === true` → 'live'); the settings tab did not.
//   2. The settings tab's onPublishNode() ran a client-only publish
//      (setHeartbeatIntent + publishOurWorldPresence) and NEVER mirrored to
//      the server beacon via setBeacon() — unlike the menu's
//      onToggleHeartbeat() — so toggling the switch never actually changed
//      the server-side state.
//
// Fix: extract a shared `_applyHeartbeatToggle(next)` (the ADR-0094-aware
// path) used by BOTH onToggleHeartbeat and onPublishNode, and apply the
// server-beacon override in _homepageStubState so the tab's status/toggle
// agree with the menu.
//
// main.js is a large entry module with top-level DOM/init side effects not
// designed for isolated import, so — consistent with the sibling
// main-heartbeat-consent / torii-menu-heartbeat-toggle tests — this locks
// the fix at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHeartbeatBroadcasting } from '../src/engine/presence/heartbeat.js';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('main.js — settings Heartbeat tab honours the ADR-0094 server beacon', () => {
  it('defines a shared _applyHeartbeatToggle that mirrors to setBeacon', () => {
    expect(SRC).toContain('function _applyHeartbeatToggle(next) {');
    expect(SRC).toContain('setBeacon({ httpBase, token, action: next })');
    // The shared path must still set the intent and update the local beacon
    // mirror so the tab + menu stay in lock-step.
    expect(SRC).toContain('_beacon.state.enabled = wantOn;');
  });

  it('the in-game menu onToggleHeartbeat delegates to the shared toggle', () => {
    expect(SRC).toMatch(/onToggleHeartbeat:\s*\(next\)\s*=>\s*\{\s*_applyHeartbeatToggle\(next\);\s*\},/);
  });

  it('onPublishNode (settings tab) delegates to the shared toggle too', () => {
    const start = SRC.indexOf('onPublishNode: () => {');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 900);
    expect(body).toContain('_applyHeartbeatToggle(next)');
    // It must NOT run a bare client-only publish that skips the beacon.
    expect(body).not.toMatch(/setHeartbeatIntent\(next\);[\s\S]*publishOurWorldPresence\(\)/);
  });

  it('_homepageStubState applies the server-beacon override to heartbeatStatus', () => {
    // When the server beacon is enabled, the tab must surface 'live' (ON),
    // matching the menu — not the raw client status ('idle' → OFF).
    expect(SRC).toContain("const effectiveHeartbeat = _beacon.state.enabled === true ? 'live' : hb;");
    expect(SRC).toContain('heartbeatStatus: effectiveHeartbeat,');
  });

  it('sanity: the server-beacon override maps to the ON state the helper understands', () => {
    expect(isHeartbeatBroadcasting('live')).toBe(true);
    expect(isHeartbeatBroadcasting('idle')).toBe(false);
  });
});
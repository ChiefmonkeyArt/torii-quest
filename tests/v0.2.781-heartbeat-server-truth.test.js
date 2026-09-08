// tests/v0.2.781-heartbeat-server-truth.test.js — source-lock for the
// v0.2.781 fix that makes the ADR-0094 server beacon the honest source of
// truth for the Settings > Heartbeat tab and the in-game menu toggle.
//
// Root cause of the "dead button" report (v0.2.780 and earlier):
//   `_syncServerBeacon()` was called ONLY on `EV.NOSTR_LOGIN`. So:
//     - A page load without a signer left `_beacon.state.enabled=false` (the
//       initial value) forever — non-owners saw the switch as OFF/dead even
//       while the server WAS publishing presence 24/7.
//     - Even owners saw a stale state after the first sync — external toggles
//       (curl, another admin tab, a server restart) never propagated to the UI
//       until the operator logged in again.
//
// Fix (all in src/main.js, no new architecture):
//   1. Boot: fire `_syncServerBeacon()` once at module init so ANYONE loading
//      the page sees the honest state, not just admins after login.
//   2. Shell rAF tick: re-sync every ~600 frames (~10s at 60fps), riding the
//      existing _shellTick loop — no window timers. Catches lastPublishedAt
//      drift and any out-of-band state flip.
//   3. If the Settings panel is open when a sync completes, repaint the active
//      tab so the Heartbeat pill updates without a tab-switch.
//
// The existing NOSTR_LOGIN call site + the `_homepageStubState`
// `effectiveHeartbeat = _beacon.state.enabled === true ? 'live' : hb` override
// (v0.2.7xx) stay in place — they still matter; they just aren't ALONE anymore.
//
// main.js is a large entry module with top-level DOM/init side effects not
// designed for isolated import, so — consistent with the sibling
// main-settings-heartbeat-beacon test — this locks the fix at the source level
// via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('v0.2.781 — server beacon is the honest source of truth for heartbeat UI', () => {
  it('declares a _beaconSyncFrame throttle var beside the other rAF throttles', () => {
    // Keeps the tick throttled to ~10s so we don't hammer the server every frame.
    expect(SRC).toContain('let _beaconSyncFrame = 0;');
  });

  it('kicks a boot-time sync so non-owners see the truth without needing login', () => {
    // Fire-and-forget: _syncServerBeacon degrades to { enabled:false } on any
    // failure, so an unreachable server never blocks the shell.
    expect(SRC).toMatch(/_syncServerBeacon\(\)\.catch\(\(\)\s*=>\s*\{[^}]*\}\);/);
  });

  it('re-syncs the beacon from the rAF _shellTick every ~600 frames', () => {
    // The tick lives in the same block as _heartbeatTick, so it inherits the
    // "no window timers in main.js" rule.
    expect(SRC).toMatch(/if\s*\(\+\+_beaconSyncFrame\s*>=\s*600\)\s*\{[\s\S]{0,200}_syncServerBeacon\(\)\.catch\(\(\)\s*=>\s*\{\}\);/);
  });

  it('keeps the NOSTR_LOGIN call site (still valuable for immediate-post-login refresh)', () => {
    // Not removed — login-time re-sync is still the right behaviour; it just
    // isn't the ONLY entry point anymore.
    expect(SRC).toContain('on(EV.NOSTR_LOGIN, _syncServerBeacon);');
  });

  it('repaints the Settings panel on sync — gated to the Heartbeat tab only (v0.2.788)', () => {
    // The Heartbeat pill updates without a tab-switch, but a ~10s timer must NOT
    // re-render other tabs (that clobbered in-progress input — see
    // v0.2.788-forge-prompt-preserved). The guard lives in _syncServerBeacon's
    // repaint block.
    expect(SRC).toContain("if (isSettingsPanelOpen() && getActiveSettingsTab() === 'heartbeat') renderActiveSettingsTab();");
  });

  it('preserves the effectiveHeartbeat server-beacon override in _homepageStubState', () => {
    // This is the second half of the honesty story: even with fresh
    // _beacon.state, the panel state must actually READ it.
    expect(SRC).toContain("const effectiveHeartbeat = _beacon.state.enabled === true ? 'live' : hb;");
    expect(SRC).toContain('heartbeatStatus: effectiveHeartbeat,');
  });

  it('client heartbeatTick still bails out when the server beacon is enabled', () => {
    // Prevents duplicate-world publishes: only ONE of {server, client} ever
    // publishes at a time. Re-checked here so a future refactor of the tick
    // doesn't silently regress it.
    expect(SRC).toMatch(/function _heartbeatTick\(now\)[\s\S]{0,300}if\s*\(_beacon\.state\.enabled\)\s*return;/);
  });
});

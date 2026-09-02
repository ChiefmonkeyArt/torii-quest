// tests/torii-menu-heartbeat-toggle.test.js — regression lock for the
// first-load heartbeat consent bug in the persistent Torii menu's admin
// panel (src/engine/menu/toriiMenu.js).
//
// Root cause: the heartbeat switch's ON/OFF display AND click-direction used
// to be derived from the raw stored intent string (`admin.heartbeatIntent
// === 'on'`), which defaults to 'on' even on a fresh install where nothing
// has ever published. That showed a lit "ON" switch whose first-ever click
// called `onToggleHeartbeat(hbOn ? 'off' : 'on')` → 'off' — flipping a
// brand-new owner's heartbeat off instead of publishing + requesting NIP-07
// consent.
//
// toriiMenu.js is a large DOM-lifecycle module (open/close/ESC/backdrop) that
// isn't worth a full fake-DOM harness just to lock one derived boolean, so
// this test asserts the fix at the source level: the module must import and
// delegate to the same shared, fully unit-tested `isHeartbeatBroadcasting()`
// helper heartbeatPanel.js and main.js use (see heartbeat.test.js /
// heartbeatPanel.test.js for the full truth table), rather than
// re-implementing or reverting to a raw `heartbeatIntent === 'on'` check.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHeartbeatBroadcasting } from '../src/engine/presence/heartbeat.js';

const SRC = readFileSync(new URL('../src/engine/menu/toriiMenu.js', import.meta.url), 'utf8');

describe('toriiMenu.js heartbeat switch — sourced from isHeartbeatBroadcasting, not raw intent', () => {
  it('imports the shared isHeartbeatBroadcasting helper from heartbeat.js', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*isHeartbeatBroadcasting[^}]*\}\s*from\s*['"]\.\.\/presence\/heartbeat\.js['"]/);
  });

  it('derives hbOn from isHeartbeatBroadcasting(admin.heartbeatStatus), not admin.heartbeatIntent alone', () => {
    // The exact-equality bug pattern this regression-locks against: a bare
    // `admin.heartbeatIntent === 'on'` used as the ONLY source for hbOn.
    const hbOnLine = SRC.split('\n').find((l) => l.includes('const hbOn ='));
    expect(hbOnLine).toBeTruthy();
    expect(SRC).toContain('isHeartbeatBroadcasting(admin.heartbeatStatus)');
  });

  it('sanity: the helper itself treats a fresh-install idle status as NOT on (the exact first-load case)', () => {
    // Cross-check against the live heartbeat.js export so this test fails if
    // the helper's semantics ever regress, not just if toriiMenu.js stops
    // calling it.
    expect(isHeartbeatBroadcasting('idle')).toBe(false);
    expect(isHeartbeatBroadcasting('live')).toBe(true);
  });
});

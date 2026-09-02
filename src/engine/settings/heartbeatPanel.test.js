// src/engine/settings/heartbeatPanel.test.js — locks the Heartbeat settings
// tab's switch-visual behavior. Pure vitest against the returned HTML string
// (renderHeartbeatPanel has no DOM at import time — mirrors the module's own
// node-testable design).
//
// Regression lock: before this fix, the switch rendered "ON" (is-on,
// aria-checked="true") for 'idle' — a fresh install where intent defaults to
// 'on' but nothing has EVER published. That misled a first-time owner into
// thinking the heartbeat was already live, and their first click (via
// onPublishNode in main.js) actually flipped it to 'off' instead of
// publishing. The switch must render OFF for 'idle', identically to 'off'.
import { describe, it, expect } from 'vitest';
import { renderHeartbeatPanel } from './heartbeatPanel.js';

function switchIsOn(html) {
  return /class="settings-switch is-on"/.test(html) && /aria-checked="true"/.test(html);
}

describe('renderHeartbeatPanel — switch visual state', () => {
  it('renders OFF for idle (fresh install, intent defaults on, never published)', () => {
    const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'idle' });
    expect(switchIsOn(html)).toBe(false);
    expect(html).toContain('class="settings-switch is-off"');
    expect(html).toContain('aria-checked="false"');
  });

  it('renders OFF for off', () => {
    const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'off' });
    expect(switchIsOn(html)).toBe(false);
  });

  it('renders ON for live', () => {
    const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'live' });
    expect(switchIsOn(html)).toBe(true);
  });

  it('renders ON for stale, publishing, and paused:wallet-requires-approval', () => {
    for (const s of ['stale', 'publishing', 'paused:wallet-requires-approval']) {
      const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: s });
      expect(switchIsOn(html)).toBe(true);
    }
  });

  it('renders OFF for every blocked:* status', () => {
    for (const s of ['blocked:not-owner', 'blocked:no-signer', 'blocked:no-node-relay']) {
      const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: s });
      expect(switchIsOn(html)).toBe(false);
    }
  });

  // ADR-0094: the beacon is server-side and auto-on from the configured admin
  // npub at install — no browser tab, login, or wallet needed. The idle label
  // must reflect that (not the old "starts on owner login" client-side copy).
  it('idle label says heartbeat is on by default, never claims Live', () => {
    const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'idle' });
    expect(html).not.toContain('(Live)');
    expect(html).toMatch(/on by default/i);
    expect(html).not.toMatch(/starts on owner login/i);
    expect(html).toMatch(/no login or wallet needed/i);
  });

  it('gates the switch behind isOwner (disabled + login note) regardless of heartbeatStatus', () => {
    const html = renderHeartbeatPanel({ isOwner: false, heartbeatStatus: 'idle' });
    expect(html).toContain('disabled');
    expect(html).toContain('Log in as the node owner');
  });

  it('describes the beacon as server-side, requiring no login or wallet (ADR-0094)', () => {
    const html = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'live' });
    expect(html.toLowerCase()).toContain('server beacon');
    expect(html.toLowerCase()).toContain('no login or wallet needed');
  });
});

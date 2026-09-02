// tests/main-heartbeat-consent.test.js — regression lock for the first-load
// heartbeat consent bug in main.js's settings-panel Heartbeat tab handler
// (onPublishNode).
//
// Root cause: `const next = getHeartbeatIntent() === 'on' ? 'off' : 'on'`
// read the raw stored intent (defaults to 'on' even when nothing has ever
// published) and inverted it — so a first-time owner's very first click on
// the Heartbeat tab's switch set intent to 'off' and showed "Heartbeat OFF."
// instead of publishing and requesting NIP-07 consent. There was no click
// path that could ever reach 'live' from a fresh install.
//
// main.js is a large entry module with top-level side-effecting imports
// (DOM/init wiring) not designed for isolated unit import, so — consistent
// with tests/torii-menu-heartbeat-toggle.test.js — this locks the fix at the
// source level: onPublishNode must decide its toggle direction from
// isHeartbeatBroadcasting() (backed by full-coverage unit tests in
// heartbeat.test.js), never from a bare getHeartbeatIntent() comparison.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHeartbeatBroadcasting } from '../src/engine/presence/heartbeat.js';

const SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function _onPublishNodeBody(src) {
  const start = src.indexOf('onPublishNode: () => {');
  expect(start).toBeGreaterThan(-1);
  // Grab a generous window past the opening brace — enough to contain the
  // whole handler body without needing a real JS parser.
  return src.slice(start, start + 1200);
}

describe('main.js onPublishNode \u2014 sourced from isHeartbeatBroadcasting, not raw intent inversion', () => {
  it('imports isHeartbeatBroadcasting from heartbeat.js', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*isHeartbeatBroadcasting[^}]*\}\s*from\s*['"]\.\/engine\/presence\/heartbeat\.js['"]/);
  });

  it('onPublishNode no longer inverts getHeartbeatIntent() directly to decide next', () => {
    const body = _onPublishNodeBody(SRC);
    // The exact regression pattern: reading current intent and flipping it.
    expect(body).not.toMatch(/getHeartbeatIntent\(\)\s*===\s*'on'\s*\?\s*'off'\s*:\s*'on'/);
  });

  it('onPublishNode derives its toggle direction from isHeartbeatBroadcasting', () => {
    const body = _onPublishNodeBody(SRC);
    expect(body).toContain('isHeartbeatBroadcasting(');
  });

  it('sanity: the helper says a fresh install (idle) is not broadcasting, so the first click must publish, not turn off', () => {
    expect(isHeartbeatBroadcasting('idle')).toBe(false);
  });
});

// src/engine/presence/heartbeat.test.js — locks the Phase 0d heartbeat timing
// + status helpers. Pure vitest: isHeartbeatDue / nextHeartbeatInMs arithmetic
// + the heartbeatStatus truth table (every status branch). No three/DOM/timers
// — `now` is injected so the leaf is fully deterministic.
import { describe, it, expect } from 'vitest';
import {
  isHeartbeatDue, nextHeartbeatInMs, heartbeatStatus, HEARTBEAT_INTERVAL_MS,
} from './heartbeat.js';

const NODE_RELAYS = ['wss://relay.example'];
const BASE = { intent: 'on', isOwner: true, hasSigner: true, nodeRelays: NODE_RELAYS };

describe('isHeartbeatDue', () => {
  it('is false when never published (lastPublishedAt null)', () => {
    expect(isHeartbeatDue({ lastPublishedAt: null, now: 1000 })).toBe(false);
    expect(isHeartbeatDue({ lastPublishedAt: undefined, now: 1000 })).toBe(false);
  });

  it('is false before the interval elapses', () => {
    expect(isHeartbeatDue({ lastPublishedAt: 0, now: 1000, intervalMs: 600000 })).toBe(false);
  });

  it('is true once the interval has elapsed', () => {
    expect(isHeartbeatDue({ lastPublishedAt: 0, now: 600000, intervalMs: 600000 })).toBe(true);
    expect(isHeartbeatDue({ lastPublishedAt: 0, now: 600001, intervalMs: 600000 })).toBe(true);
  });

  it('defaults intervalMs to HEARTBEAT_INTERVAL_MS (600000)', () => {
    expect(isHeartbeatDue({ lastPublishedAt: 0, now: 599999 })).toBe(false);
    expect(isHeartbeatDue({ lastPublishedAt: 0, now: 600000 })).toBe(true);
    expect(HEARTBEAT_INTERVAL_MS).toBe(600000);
  });
});

describe('nextHeartbeatInMs', () => {
  it('is 0 when never published', () => {
    expect(nextHeartbeatInMs({ lastPublishedAt: null, now: 1000 })).toBe(0);
  });

  it('is the remaining ms before due', () => {
    expect(nextHeartbeatInMs({ lastPublishedAt: 0, now: 100000, intervalMs: 600000 })).toBe(500000);
  });

  it('is 0 when already due', () => {
    expect(nextHeartbeatInMs({ lastPublishedAt: 0, now: 600000, intervalMs: 600000 })).toBe(0);
    expect(nextHeartbeatInMs({ lastPublishedAt: 0, now: 700000, intervalMs: 600000 })).toBe(0);
  });
});

describe('heartbeatStatus — truth table (every branch)', () => {
  it('off when intent is off', () => {
    expect(heartbeatStatus({ ...BASE, intent: 'off', now: 0 })).toBe('off');
  });

  it('blocked:not-owner when not the operator', () => {
    expect(heartbeatStatus({ ...BASE, isOwner: false, now: 0 })).toBe('blocked:not-owner');
  });

  it('blocked:no-signer when no NIP-07 signer', () => {
    expect(heartbeatStatus({ ...BASE, hasSigner: false, now: 0 })).toBe('blocked:no-signer');
  });

  it('blocked:no-node-relay when node relays empty', () => {
    expect(heartbeatStatus({ ...BASE, nodeRelays: [], now: 0 })).toBe('blocked:no-node-relay');
  });

  it('paused:wallet-requires-approval when republishPaused', () => {
    expect(heartbeatStatus({ ...BASE, republishPaused: true, now: 0 })).toBe('paused:wallet-requires-approval');
  });

  it('failed:<lastError> when a non-sign error is recorded', () => {
    expect(heartbeatStatus({ ...BASE, lastError: 'no-relay-accepted', now: 0 })).toBe('failed:no-relay-accepted');
  });

  it('idle when intent on but never published', () => {
    expect(heartbeatStatus({ ...BASE, lastPublishedAt: null, now: 0 })).toBe('idle');
  });

  it('live when published and within the expiration window', () => {
    // last published 5 min ago, expiration 20 min → live
    expect(heartbeatStatus({ ...BASE, lastPublishedAt: 0, now: 300000, expirationTtlSec: 1200 })).toBe('live');
  });

  it('stale when published but past the expiration window', () => {
    // last published 25 min ago, expiration 20 min → stale (republish overdue)
    expect(heartbeatStatus({ ...BASE, lastPublishedAt: 0, now: 1500000, expirationTtlSec: 1200 })).toBe('stale');
  });

  it('precedence: blocked:not-owner beats blocked:no-signer', () => {
    expect(heartbeatStatus({ ...BASE, isOwner: false, hasSigner: false, now: 0 })).toBe('blocked:not-owner');
  });

  it('precedence: paused beats failed and live', () => {
    expect(heartbeatStatus({
      ...BASE, republishPaused: true, lastError: 'x', lastPublishedAt: 0, now: 1000,
    })).toBe('paused:wallet-requires-approval');
  });

  it('uses the default expiration ttl (1200s) when omitted', () => {
    // last published 1199s ago → still live (just under 1200s)
    expect(heartbeatStatus({ ...BASE, lastPublishedAt: 0, now: 1199000 })).toBe('live');
    // last published 1201s ago → stale
    expect(heartbeatStatus({ ...BASE, lastPublishedAt: 0, now: 1201000 })).toBe('stale');
  });
});

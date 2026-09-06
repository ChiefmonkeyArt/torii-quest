// engine/telemetry/relayHealth.test.js — full coverage of the per-relay
// counter store (v0.2.774). All tests use an in-memory storage stub so they
// run in node with no jsdom.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LS_KEY,
  MAX_SESSIONS,
  SCHEMA_VERSION,
  recordOpen,
  recordOpenFail,
  recordClose,
  recordMessage,
  rotateSession,
  readHealth,
  readRelayHealth,
  resetHealth,
} from '../src/engine/telemetry/relayHealth.js';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

let storage;
beforeEach(() => { storage = makeStorage(); });

describe('relayHealth: constants', () => {
  it('exposes stable LS_KEY, MAX_SESSIONS, SCHEMA_VERSION', () => {
    expect(LS_KEY).toBe('torii.relayHealth.v1');
    expect(MAX_SESSIONS).toBe(30);
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('relayHealth: recordOpen', () => {
  it('increments opens, records latency, resets failStreak', () => {
    recordOpen('wss://nos.lol', 145, { storage });
    const rec = readRelayHealth('wss://nos.lol', { storage });
    expect(rec.opens).toBe(1);
    expect(rec.latencyMsSum).toBe(145);
    expect(rec.latencySamples).toBe(1);
    expect(rec.failStreak).toBe(0);
    expect(rec.lastSeen).toBeGreaterThan(0);
  });

  it('accumulates across many calls', () => {
    recordOpen('wss://a', 100, { storage });
    recordOpen('wss://a', 200, { storage });
    recordOpen('wss://a', 300, { storage });
    const rec = readRelayHealth('wss://a', { storage });
    expect(rec.opens).toBe(3);
    expect(rec.latencyMsSum).toBe(600);
    expect(rec.latencySamples).toBe(3);
  });

  it('ignores non-wss URLs (no seed of garbage)', () => {
    recordOpen('http://evil.com', 100, { storage });
    recordOpen('not a url', 100, { storage });
    recordOpen('', 100, { storage });
    recordOpen(null, 100, { storage });
    const h = readHealth({ storage });
    expect(h.relays).toEqual({});
  });

  it('accepts ws:// as well as wss://', () => {
    recordOpen('ws://localhost:7777', 5, { storage });
    expect(readRelayHealth('ws://localhost:7777', { storage }).opens).toBe(1);
  });

  it('skips latency accumulation when connectMs is invalid', () => {
    recordOpen('wss://a', NaN, { storage });
    recordOpen('wss://a', -5, { storage });
    recordOpen('wss://a', 'nope', { storage });
    const rec = readRelayHealth('wss://a', { storage });
    expect(rec.opens).toBe(3);
    expect(rec.latencyMsSum).toBe(0);
    expect(rec.latencySamples).toBe(0);
  });

  it('bumps currentSession per successful open', () => {
    recordOpen('wss://a', 10, { storage });
    recordOpen('wss://a', 10, { storage });
    recordOpen('wss://b', 10, { storage });
    const h = readHealth({ storage });
    expect(h.currentSession).toEqual({ 'wss://a': 2, 'wss://b': 1 });
  });
});

describe('relayHealth: recordOpenFail', () => {
  it('increments opensFailed and failStreak, sets lastFail', () => {
    recordOpenFail('wss://bad', { storage });
    const rec = readRelayHealth('wss://bad', { storage });
    expect(rec.opensFailed).toBe(1);
    expect(rec.failStreak).toBe(1);
    expect(rec.lastFail).toBeGreaterThan(0);
  });

  it('failStreak accumulates while failing, resets on next open', () => {
    recordOpenFail('wss://x', { storage });
    recordOpenFail('wss://x', { storage });
    recordOpenFail('wss://x', { storage });
    expect(readRelayHealth('wss://x', { storage }).failStreak).toBe(3);
    recordOpen('wss://x', 50, { storage });
    expect(readRelayHealth('wss://x', { storage }).failStreak).toBe(0);
  });

  it('ignores non-wss URLs', () => {
    recordOpenFail('http://x', { storage });
    expect(readHealth({ storage }).relays).toEqual({});
  });
});

describe('relayHealth: recordClose', () => {
  it('increments closes counter', () => {
    recordClose('wss://a', { storage });
    recordClose('wss://a', { storage });
    expect(readRelayHealth('wss://a', { storage }).closes).toBe(2);
  });
});

describe('relayHealth: recordMessage', () => {
  it('increments messages and updates lastSeen', () => {
    recordMessage('wss://a', { storage });
    const rec = readRelayHealth('wss://a', { storage });
    expect(rec.messages).toBe(1);
    expect(rec.lastSeen).toBeGreaterThan(0);
  });
});

describe('relayHealth: rotateSession', () => {
  it('snapshots per-relay counts into sessions[] and clears currentSession', () => {
    recordOpen('wss://a', 10, { storage });
    recordOpen('wss://a', 10, { storage });
    recordOpen('wss://b', 10, { storage });
    rotateSession({ storage });
    const h = readHealth({ storage });
    expect(h.currentSession).toEqual({});
    expect(h.relays['wss://a'].sessions).toEqual([2]);
    expect(h.relays['wss://b'].sessions).toEqual([1]);
  });

  it('pushes a 0 for known relays silent this session', () => {
    // Seed history so 'a' is known
    recordOpen('wss://a', 10, { storage });
    rotateSession({ storage });
    // Now a rotate with no activity → 'a' gets a 0
    rotateSession({ storage });
    const rec = readRelayHealth('wss://a', { storage });
    expect(rec.sessions).toEqual([1, 0]);
  });

  it('trims the rolling window to MAX_SESSIONS entries', () => {
    for (let i = 0; i < MAX_SESSIONS + 15; i++) {
      recordOpen('wss://a', 1, { storage });
      rotateSession({ storage });
    }
    const rec = readRelayHealth('wss://a', { storage });
    expect(rec.sessions.length).toBe(MAX_SESSIONS);
    // Last entry is the most recent (each rotate had 1 open before)
    expect(rec.sessions[rec.sessions.length - 1]).toBe(1);
  });
});

describe('relayHealth: LS persistence round-trip', () => {
  it('survives a fresh module read (same storage)', () => {
    recordOpen('wss://a', 42, { storage });
    recordOpenFail('wss://b', { storage });
    recordMessage('wss://a', { storage });
    const raw = storage.getItem(LS_KEY);
    expect(raw).toContain('"v":1');
    const parsed = JSON.parse(raw);
    expect(parsed.relays['wss://a'].opens).toBe(1);
    expect(parsed.relays['wss://a'].messages).toBe(1);
    expect(parsed.relays['wss://b'].opensFailed).toBe(1);
  });

  it('recovers a fresh root when LS payload is corrupt', () => {
    storage.setItem(LS_KEY, '{not valid json');
    const h = readHealth({ storage });
    expect(h.v).toBe(1);
    expect(h.relays).toEqual({});
  });

  it('recovers a fresh root when schema version mismatches', () => {
    storage.setItem(LS_KEY, JSON.stringify({ v: 99, relays: { 'wss://x': { opens: 5 } } }));
    const h = readHealth({ storage });
    expect(h.relays).toEqual({});
  });

  it('filters invalid relay keys on load', () => {
    storage.setItem(LS_KEY, JSON.stringify({
      v: 1,
      relays: {
        'wss://good': { opens: 3 },
        'http://bad': { opens: 99 },
        '': { opens: 1 },
      },
      currentSession: { 'wss://good': 2, 'http://bad': 5 },
    }));
    const h = readHealth({ storage });
    expect(Object.keys(h.relays)).toEqual(['wss://good']);
    expect(h.currentSession).toEqual({ 'wss://good': 2 });
  });
});

describe('relayHealth: no-storage fallbacks', () => {
  it('never throws when storage is missing', () => {
    expect(() => recordOpen('wss://a', 10, { storage: null })).not.toThrow();
    expect(() => recordOpenFail('wss://a', { storage: null })).not.toThrow();
    expect(() => recordClose('wss://a', { storage: null })).not.toThrow();
    expect(() => recordMessage('wss://a', { storage: null })).not.toThrow();
    expect(() => rotateSession({ storage: null })).not.toThrow();
    expect(() => readHealth({ storage: null })).not.toThrow();
  });

  it('never throws when LS getItem/setItem throws (quota / disabled)', () => {
    const broken = {
      getItem: () => { throw new Error('security'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(() => recordOpen('wss://a', 10, { storage: broken })).not.toThrow();
    expect(readHealth({ storage: broken }).relays).toEqual({});
  });
});

describe('relayHealth: readers return deep-clones (caller-safe)', () => {
  it('readHealth() clone mutation does not affect stored state', () => {
    recordOpen('wss://a', 10, { storage });
    const copy = readHealth({ storage });
    copy.relays['wss://a'].opens = 999;
    copy.relays['wss://evil'] = { opens: 1 };
    const fresh = readHealth({ storage });
    expect(fresh.relays['wss://a'].opens).toBe(1);
    expect(fresh.relays['wss://evil']).toBeUndefined();
  });

  it('readRelayHealth() returns null for unknown relay', () => {
    expect(readRelayHealth('wss://never-seen', { storage })).toBeNull();
  });

  it('readRelayHealth() rejects non-wss URLs', () => {
    expect(readRelayHealth('http://x', { storage })).toBeNull();
  });
});

describe('relayHealth: resetHealth', () => {
  it('clears every counter', () => {
    recordOpen('wss://a', 10, { storage });
    recordOpenFail('wss://b', { storage });
    resetHealth({ storage });
    expect(readHealth({ storage }).relays).toEqual({});
  });
});

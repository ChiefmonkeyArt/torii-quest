// src/engine/menu/adminPrefs.test.js — locks the Phase 0c owner-admin localStorage
// helpers (getHeartbeatIntent / setHeartbeatIntent / getActiveWorld / setActiveWorld).
// Pure vitest: a fake Storage is injected so the leaf touches no real DOM/storage.
// Verifies the defaults, the coercion, and the no-storage / throwing-storage
// guards. No three/DOM.
import { describe, it, expect } from 'vitest';
import {
  getHeartbeatIntent, setHeartbeatIntent,
  getActiveWorld, setActiveWorld,
  getNodeRelays, setNodeRelays, readNodeRelays,
  getGamestrEnabled, setGamestrEnabled,
} from './adminPrefs.js';

// A minimal fake Storage.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

describe('getHeartbeatIntent', () => {
  // v0.4: default changed 'off' -> 'on'. An absent/unrecognized key now
  // resolves to 'on'; an explicit stored 'off' is still honoured so a
  // deliberate owner opt-out is never silently reverted.
  it('defaults to "on" when the key is absent', () => {
    expect(getHeartbeatIntent(fakeStorage())).toBe('on');
  });

  it('returns "on" when stored', () => {
    expect(getHeartbeatIntent(fakeStorage({ 'torii.heartbeat.intent': 'on' }))).toBe('on');
  });

  it('returns the explicit "off" when stored', () => {
    expect(getHeartbeatIntent(fakeStorage({ 'torii.heartbeat.intent': 'off' }))).toBe('off');
  });

  it('falls back to the "on" default when stored value is unrecognized', () => {
    expect(getHeartbeatIntent(fakeStorage({ 'torii.heartbeat.intent': 'maybe' }))).toBe('on');
    expect(getHeartbeatIntent(fakeStorage({ 'torii.heartbeat.intent': '' }))).toBe('on');
  });

  it('defaults to "on" with no storage (null/undefined)', () => {
    expect(getHeartbeatIntent(null)).toBe('on');
    expect(getHeartbeatIntent(undefined)).toBe('on');
  });

  it('never throws when storage.getItem throws, and falls back to "on"', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(() => getHeartbeatIntent(broken)).not.toThrow();
    expect(getHeartbeatIntent(broken)).toBe('on');
  });
});

describe('setHeartbeatIntent', () => {
  it('stores "on"', () => {
    const s = fakeStorage();
    setHeartbeatIntent('on', s);
    expect(s.getItem('torii.heartbeat.intent')).toBe('on');
  });

  it('coerces anything non-"on" to "off"', () => {
    const s = fakeStorage();
    setHeartbeatIntent('maybe', s);
    expect(s.getItem('torii.heartbeat.intent')).toBe('off');
    setHeartbeatIntent(123, s);
    expect(s.getItem('torii.heartbeat.intent')).toBe('off');
  });

  it('never throws when storage.setItem throws', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => setHeartbeatIntent('on', broken)).not.toThrow();
  });

  it('never throws with no storage (null/undefined)', () => {
    expect(() => setHeartbeatIntent('on', null)).not.toThrow();
    expect(() => setHeartbeatIntent('on', undefined)).not.toThrow();
  });
});

describe('getActiveWorld', () => {
  it('returns the stored world id', () => {
    expect(getActiveWorld(fakeStorage({ 'torii.world.active': 'gateway-blank' }))).toBe('gateway-blank');
  });

  it('trims whitespace', () => {
    expect(getActiveWorld(fakeStorage({ 'torii.world.active': '  chiefmonkey-template  ' }))).toBe('chiefmonkey-template');
  });

  it('defaults to "" when the key is absent', () => {
    expect(getActiveWorld(fakeStorage())).toBe('');
  });

  it('returns "" for a blank value', () => {
    expect(getActiveWorld(fakeStorage({ 'torii.world.active': '   ' }))).toBe('');
  });

  it('defaults to "" with no storage', () => {
    expect(getActiveWorld(null)).toBe('');
    expect(getActiveWorld(undefined)).toBe('');
  });

  it('never throws when storage.getItem throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(() => getActiveWorld(broken)).not.toThrow();
    expect(getActiveWorld(broken)).toBe('');
  });
});

describe('setActiveWorld', () => {
  it('stores the world id', () => {
    const s = fakeStorage();
    setActiveWorld('gateway-blank', s);
    expect(s.getItem('torii.world.active')).toBe('gateway-blank');
  });

  it('removes the key when the id is blank', () => {
    const s = fakeStorage({ 'torii.world.active': 'gateway-blank' });
    setActiveWorld('', s);
    expect(s.getItem('torii.world.active')).toBeNull();
    setActiveWorld('   ', s);
    expect(s.getItem('torii.world.active')).toBeNull();
  });

  it('trims the id before storing', () => {
    const s = fakeStorage();
    setActiveWorld('  gateway-blank  ', s);
    expect(s.getItem('torii.world.active')).toBe('gateway-blank');
  });

  it('never throws when storage.setItem throws', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(() => setActiveWorld('x', broken)).not.toThrow();
  });

  it('never throws with no storage', () => {
    expect(() => setActiveWorld('x', null)).not.toThrow();
  });
});

// Phase 0d: adminPrefs re-exports the node-relay helpers from presence/nodeRelays.js
// (one source of truth). Verify the re-export seam is wired + delegates.
describe('adminPrefs node-relay re-exports', () => {
  it('setNodeRelays + getNodeRelays round-trip through the adminPrefs seam', () => {
    const s = fakeStorage();
    setNodeRelays('wss://a.relay,ws://bad.relay', s);
    expect(getNodeRelays(s)).toBe('wss://a.relay/');
  });

  it('readNodeRelays reads back the validated set', () => {
    const s = fakeStorage();
    setNodeRelays('wss://a.relay,wss://b.relay', s);
    expect(readNodeRelays({ storage: s, metaGetter: () => '' })).toEqual([
      'wss://a.relay/', 'wss://b.relay/',
    ]);
  });

  it('getNodeRelays returns "" when no storage / absent', () => {
    expect(getNodeRelays(fakeStorage())).toBe('');
    expect(getNodeRelays(null)).toBe('');
  });
});

// Phase 0f (menu toggle): the operator's runtime gamestr opt-in. A localStorage
// override on top of the build-time GAMESTR_ENABLED const; main.js publishes
// when (GAMESTR_ENABLED || getGamestrEnabled()). Default off; never throws.
describe('getGamestrEnabled / setGamestrEnabled', () => {
  it('defaults to false when the key is absent', () => {
    expect(getGamestrEnabled(fakeStorage())).toBe(false);
  });

  it('returns true when stored as "1"', () => {
    expect(getGamestrEnabled(fakeStorage({ 'torii.gamestr.enabled': '1' }))).toBe(true);
  });

  it('returns false when stored value is not "1"', () => {
    expect(getGamestrEnabled(fakeStorage({ 'torii.gamestr.enabled': '0' }))).toBe(false);
    expect(getGamestrEnabled(fakeStorage({ 'torii.gamestr.enabled': 'true' }))).toBe(false);
    expect(getGamestrEnabled(fakeStorage({ 'torii.gamestr.enabled': '' }))).toBe(false);
  });

  it('setGamestrEnabled(true) stores "1" and round-trips', () => {
    const s = fakeStorage();
    setGamestrEnabled(true, s);
    expect(s.getItem('torii.gamestr.enabled')).toBe('1');
    expect(getGamestrEnabled(s)).toBe(true);
  });

  it('setGamestrEnabled("on") coerces to stored "1" (toggle UI passes "on"/"off")', () => {
    const s = fakeStorage();
    setGamestrEnabled('on', s);
    expect(getGamestrEnabled(s)).toBe(true);
  });

  it('setGamestrEnabled(false) stores "0"', () => {
    const s = fakeStorage();
    setGamestrEnabled(true, s);
    setGamestrEnabled(false, s);
    expect(s.getItem('torii.gamestr.enabled')).toBe('0');
    expect(getGamestrEnabled(s)).toBe(false);
  });

  it('defaults to false with no storage (null/undefined)', () => {
    expect(getGamestrEnabled(null)).toBe(false);
    expect(getGamestrEnabled(undefined)).toBe(false);
  });

  it('never throws with no storage', () => {
    expect(() => setGamestrEnabled(true, null)).not.toThrow();
  });
});

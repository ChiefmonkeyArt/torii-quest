// src/engine/presence/nodeRelays.test.js — locks the Phase 0d node-relay config
// reader. Pure vitest: readNodeRelays merges meta+localStorage, dedupes,
// validates wss-only, caps at 8, returns [] when none configured, and NEVER
// falls back to public RELAYS. setNodeRelays writes/validates; getNodeRelays
// reads the raw stored string. Fake Storage + fake metaGetter injected.
import { describe, it, expect } from 'vitest';
import {
  readNodeRelays, readEffectiveNodeRelays, setNodeRelays, getNodeRelays, NODE_RELAYS_KEY, NODE_RELAYS_CAP, DEFAULT_NODE_RELAYS,
} from './nodeRelays.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

describe('readNodeRelays — empty / no sources', () => {
  it('returns [] when no localStorage and no meta', () => {
    expect(readNodeRelays({ storage: fakeStorage(), metaGetter: () => '' })).toEqual([]);
  });

  it('returns [] when storage is null/undefined (SSR)', () => {
    expect(readNodeRelays({ storage: null, metaGetter: () => '' })).toEqual([]);
    expect(readNodeRelays({ storage: undefined, metaGetter: () => '' })).toEqual([]);
  });
});

describe('readNodeRelays — merges + dedupes localStorage + meta', () => {
  it('reads wss URLs from localStorage', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://relay.one,wss://relay.two' });
    expect(readNodeRelays({ storage: s, metaGetter: () => '' })).toEqual([
      'wss://relay.one/', 'wss://relay.two/',
    ]);
  });

  it('reads wss URLs from the meta tag', () => {
    expect(readNodeRelays({
      storage: fakeStorage(), metaGetter: () => 'wss://meta.relay',
    })).toEqual(['wss://meta.relay/']);
  });

  it('merges localStorage + meta and dedupes (localStorage first)', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://a.relay' });
    const out = readNodeRelays({ storage: s, metaGetter: () => 'wss://a.relay,wss://b.relay' });
    expect(out).toEqual(['wss://a.relay/', 'wss://b.relay/']);
  });

  it('splits on commas and newlines', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://a.relay\nwss://b.relay,wss://c.relay' });
    const out = readNodeRelays({ storage: s, metaGetter: () => '' });
    expect(out).toEqual(['wss://a.relay/', 'wss://b.relay/', 'wss://c.relay/']);
  });
});

describe('readNodeRelays — validation', () => {
  it('accepts wss ONLY (rejects ws:// and http://)', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'ws://plain.relay,http://web.relay,wss://good.relay' });
    expect(readNodeRelays({ storage: s, metaGetter: () => '' })).toEqual(['wss://good.relay/']);
  });

  it('caps at NODE_RELAYS_CAP (8)', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `wss://r${i}.relay`);
    const s = fakeStorage({ [NODE_RELAYS_KEY]: urls.join(',') });
    const out = readNodeRelays({ storage: s, metaGetter: () => '' });
    expect(out.length).toBe(NODE_RELAYS_CAP);
    expect(NODE_RELAYS_CAP).toBe(8);
  });

  it('never injects public RELAYS (no public-relay fallback)', () => {
    // The public relays are damus/nos.lol/nostr.band/primal. With no sources
    // configured, readNodeRelays must return [] — NOT those public relays.
    const out = readNodeRelays({ storage: fakeStorage(), metaGetter: () => '' });
    expect(out).toEqual([]);
    const PUBLIC = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net'];
    for (const p of PUBLIC) expect(out).not.toContain(p);
  });

  it('never throws when storage.getItem throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
    expect(() => readNodeRelays({ storage: broken, metaGetter: () => '' })).not.toThrow();
    expect(readNodeRelays({ storage: broken, metaGetter: () => 'wss://ok.relay' })).toEqual(['wss://ok.relay/']);
  });

  it('never throws when metaGetter throws', () => {
    expect(() => readNodeRelays({
      storage: fakeStorage(), metaGetter: () => { throw new Error('boom'); },
    })).not.toThrow();
  });
});

describe('readEffectiveNodeRelays — curated starter defaults (ADR-0076)', () => {
  it('returns DEFAULT_NODE_RELAYS when nothing configured', () => {
    expect(readEffectiveNodeRelays({ storage: fakeStorage(), metaGetter: () => '' })).toEqual([...DEFAULT_NODE_RELAYS]);
  });

  it('returns the operator config when set (overrides defaults)', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://my.relay' });
    expect(readEffectiveNodeRelays({ storage: s, metaGetter: () => '' })).toEqual(['wss://my.relay/']);
  });

  it('defaults are wss-only Torii-ecosystem relays, not the big public RELAYS', () => {
    expect(DEFAULT_NODE_RELAYS.length).toBeGreaterThan(0);
    for (const u of DEFAULT_NODE_RELAYS) expect(u.startsWith('wss://')).toBe(true);
    const PUBLIC = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net'];
    for (const p of PUBLIC) expect(DEFAULT_NODE_RELAYS).not.toContain(p);
  });

  it('returns a fresh copy (not the frozen constant) so callers cannot mutate', () => {
    const out = readEffectiveNodeRelays({ storage: fakeStorage(), metaGetter: () => '' });
    expect(out).not.toBe(DEFAULT_NODE_RELAYS);
    out.push('wss://mutated.relay');
    expect(DEFAULT_NODE_RELAYS).not.toContain('wss://mutated.relay');
  });

  it('never throws when storage.getItem throws (falls back to defaults)', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
    expect(() => readEffectiveNodeRelays({ storage: broken, metaGetter: () => '' })).not.toThrow();
    expect(readEffectiveNodeRelays({ storage: broken, metaGetter: () => '' })).toEqual([...DEFAULT_NODE_RELAYS]);
  });
});

describe('setNodeRelays', () => {
  it('validates + writes deduped wss URLs to localStorage', () => {
    const s = fakeStorage();
    setNodeRelays('wss://a.relay,ws://bad.relay,wss://a.relay', s);
    expect(s.getItem(NODE_RELAYS_KEY)).toBe('wss://a.relay/');
  });

  it('removes the key when input is blank/empty', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://a.relay' });
    setNodeRelays('   ', s);
    expect(s.getItem(NODE_RELAYS_KEY)).toBeNull();
    setNodeRelays('ws://only-bad.relay', s); // no valid wss → clears
    expect(s.getItem(NODE_RELAYS_KEY)).toBeNull();
  });

  it('never throws when storage.setItem throws', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(() => setNodeRelays('wss://a.relay', broken)).not.toThrow();
  });
});

describe('getNodeRelays', () => {
  it('returns the raw stored string', () => {
    const s = fakeStorage({ [NODE_RELAYS_KEY]: 'wss://a.relay,wss://b.relay' });
    expect(getNodeRelays(s)).toBe('wss://a.relay,wss://b.relay');
  });

  it('returns "" when absent or no storage', () => {
    expect(getNodeRelays(fakeStorage())).toBe('');
    expect(getNodeRelays(null)).toBe('');
  });
});

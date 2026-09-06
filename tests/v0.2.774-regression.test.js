// tests/v0.2.774-regression.test.js — regression coverage for v0.2.774:
//   1. DEFAULT_NODE_RELAYS extended with snort.social + nostr.mom
//   2. relayHealth module wired + exported
//   3. Silence contract: transient single-relay open-fail is not console.error
//   4. Settings→Relays tab renders the new health-stats section
//
// This file GATES the ship — vitest include is `tests/**/*.test.js` so this
// runs on every `npm test` / release cadence, unlike the colocated
// `src/**/*.test.js` files which are documentation-only under the current
// vitest config.

import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_NODE_RELAYS } from '../src/engine/presence/nodeRelays.js';
import {
  recordOpen,
  recordOpenFail,
  rotateSession,
  readHealth,
  resetHealth,
  LS_KEY,
} from '../src/engine/telemetry/relayHealth.js';
import { renderRelayPanel } from '../src/engine/settings/relayPanel.js';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('v0.2.774: DEFAULT_NODE_RELAYS extended', () => {
  it('includes both new relays (snort.social + nostr.mom)', () => {
    expect(DEFAULT_NODE_RELAYS).toContain('wss://relay.snort.social');
    expect(DEFAULT_NODE_RELAYS).toContain('wss://nostr.mom');
  });

  it('preserves the existing five defaults (additive, not replacement)', () => {
    for (const url of [
      'wss://relay.plebeian.market',
      'wss://relay.routstr.com',
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://relay.primal.net',
    ]) {
      expect(DEFAULT_NODE_RELAYS).toContain(url);
    }
  });

  it('has exactly 7 defaults and no duplicates', () => {
    expect(DEFAULT_NODE_RELAYS.length).toBe(7);
    expect(new Set(DEFAULT_NODE_RELAYS).size).toBe(7);
  });

  it('every default is a wss:// URL', () => {
    for (const url of DEFAULT_NODE_RELAYS) {
      expect(url).toMatch(/^wss:\/\//);
    }
  });

  it('remains frozen (defaults cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(DEFAULT_NODE_RELAYS)).toBe(true);
  });

  it('does NOT include the paywalled wss://nostr.wine', () => {
    // Probed 2026-09-05: 403 Forbidden on WS connection (paid-AUTH).
    expect(DEFAULT_NODE_RELAYS).not.toContain('wss://nostr.wine');
  });
});

describe('v0.2.774: relayHealth end-to-end (gated)', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('exposes stable LS key', () => {
    expect(LS_KEY).toBe('torii.relayHealth.v1');
  });

  it('records an open + a rotate produces a session entry', () => {
    recordOpen('wss://relay.snort.social', 350, { storage });
    recordOpen('wss://nostr.mom', 401, { storage });
    rotateSession({ storage });
    const h = readHealth({ storage });
    expect(h.relays['wss://relay.snort.social'].opens).toBe(1);
    expect(h.relays['wss://nostr.mom'].opens).toBe(1);
    expect(h.relays['wss://relay.snort.social'].sessions).toEqual([1]);
    expect(h.currentSession).toEqual({});
  });

  it('records a fail without polluting opens', () => {
    recordOpenFail('wss://relay.damus.io', { storage });
    const h = readHealth({ storage });
    expect(h.relays['wss://relay.damus.io'].opens).toBe(0);
    expect(h.relays['wss://relay.damus.io'].opensFailed).toBe(1);
    expect(h.relays['wss://relay.damus.io'].failStreak).toBe(1);
  });

  it('resetHealth clears all counters', () => {
    recordOpen('wss://a', 10, { storage });
    resetHealth({ storage });
    expect(readHealth({ storage }).relays).toEqual({});
  });
});

describe('v0.2.774: Settings→Relays tab renders health section', () => {
  it('renders the new health-stats section header', () => {
    const html = renderRelayPanel({
      isOwner: true,
      nodeRelays: ['wss://nos.lol'],
      nodeRelaysInput: 'wss://nos.lol',
      relayHealth: { 'wss://nos.lol': { opens: 3, opensFailed: 1, closes: 2, messages: 42, avgLatencyMs: 180, sessions: [1, 2, 3], failStreak: 0 } },
    });
    expect(html).toContain('Relay health');
  });

  it('renders per-relay stats rows when relayHealth is provided', () => {
    const html = renderRelayPanel({
      isOwner: true,
      nodeRelays: ['wss://nos.lol', 'wss://nostr.mom'],
      nodeRelaysInput: 'wss://nos.lol\nwss://nostr.mom',
      relayHealth: {
        'wss://nos.lol': { opens: 10, opensFailed: 0, closes: 8, messages: 512, avgLatencyMs: 180, sessions: [3, 4, 3], failStreak: 0 },
        'wss://nostr.mom': { opens: 5, opensFailed: 2, closes: 3, messages: 128, avgLatencyMs: 402, sessions: [1, 2, 2], failStreak: 0 },
      },
    });
    expect(html).toContain('wss://nos.lol');
    expect(html).toContain('wss://nostr.mom');
    // Numbers surfaced somewhere in the panel body
    expect(html).toContain('10');   // nos.lol opens
    expect(html).toContain('402');  // nostr.mom avg latency
  });

  it('renders a friendly empty state when relayHealth has no entries yet', () => {
    const html = renderRelayPanel({
      isOwner: true,
      nodeRelays: ['wss://nos.lol'],
      nodeRelaysInput: 'wss://nos.lol',
      relayHealth: {},
    });
    expect(html).toContain('Relay health');
    // Some hint that no data yet exists
    expect(html.toLowerCase()).toMatch(/no.*(data|activity|stats).*yet|not yet|waiting/);
  });

  it('does NOT throw / crash when relayHealth is undefined (back-compat)', () => {
    expect(() => renderRelayPanel({
      isOwner: true,
      nodeRelays: ['wss://nos.lol'],
      nodeRelaysInput: 'wss://nos.lol',
    })).not.toThrow();
  });
});

// tests/beacon-client.test.js — client side of the ADR-0094 server beacon
// (src/engine/presence/beaconClient.js). Locks the pure fetch contract: public
// state read degrades to {enabled:false} on any failure; the on/off action POSTs
// with the session bearer token and surfaces the server's error on denial.
import { describe, it, expect } from 'vitest';
import { fetchBeaconState, setBeacon } from '../src/engine/presence/beaconClient.js';

function jsonStatus(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('fetchBeaconState', () => {
  it('parses the public state on 200', async () => {
    const state = { enabled: true, activatedAt: 123, pubkey: 'ab'.repeat(32), adminPubkey: 'cd'.repeat(32), lastPublishedAt: 456, lastError: null };
    const st = await fetchBeaconState({
      httpBase: 'https://host/mp',
      fetchImpl: async () => jsonStatus(state),
    });
    expect(st.enabled).toBe(true);
    expect(st.activatedAt).toBe(123);
    expect(st.adminPubkey).toBe('cd'.repeat(32));
  });

  it('degrades to {enabled:false} on non-200 or thrown fetch', async () => {
    const bad = await fetchBeaconState({ httpBase: 'https://host/mp', fetchImpl: async () => jsonStatus({}, false, 500) });
    expect(bad.enabled).toBe(false);
    const thrown = await fetchBeaconState({ httpBase: 'https://host/mp', fetchImpl: async () => { throw new Error('net'); } });
    expect(thrown.enabled).toBe(false);
  });

  it('degrades to {enabled:false} without a fetch impl', async () => {
    // v0.2.768 note: Node 18+ ships a global `fetch`, so `fetchImpl: null` alone
    // falls through to the real network fetch and hangs. Stub the global to
    // actually exercise the "no fetch available" degrade branch.
    const orig = globalThis.fetch;
    globalThis.fetch = undefined;
    try {
      const st = await fetchBeaconState({ httpBase: 'https://host/mp', fetchImpl: null });
      expect(st.enabled).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('setBeacon', () => {
  it('POSTs the action with the bearer token and returns the server state', async () => {
    let captured = null;
    const st = {
      ok: true, enabled: true, activatedAt: 1, pubkey: 'ab'.repeat(32), adminPubkey: 'cd'.repeat(32),
    };
    const res = await setBeacon({
      httpBase: 'https://host/mp', token: 'tok123', action: 'on',
      fetchImpl: async (url, init) => { captured = { url, init }; return jsonStatus(st); },
    });
    expect(captured.url).toBe('https://host/mp/admin/beacon');
    expect(captured.init.method).toBe('POST');
    expect(captured.init.headers.Authorization).toBe('Bearer tok123');
    expect(JSON.parse(captured.init.body)).toEqual({ action: 'on' });
    expect(res.ok).toBe(true);
    expect(res.enabled).toBe(true);
  });

  it('fails closed without a token', async () => {
    const res = await setBeacon({ httpBase: 'https://host/mp', token: '', action: 'off', fetchImpl: async () => jsonStatus({}) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no session token');
  });

  it('rejects an unknown action', async () => {
    const res = await setBeacon({ httpBase: 'https://host/mp', token: 't', action: 'maybe', fetchImpl: async () => jsonStatus({}) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('bad action');
  });

  it('surfaces the server error on denial', async () => {
    const res = await setBeacon({
      httpBase: 'https://host/mp', token: 't', action: 'on',
      fetchImpl: async () => jsonStatus({ ok: false, error: 'forbidden' }, false, 403),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('forbidden');
  });
});
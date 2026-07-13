// session-auth.test.js — client login → session-token flow (v0.2.375-alpha).
//
// Locks the "1 sign at login" contract: loginForSessionToken calls the signer
// EXACTLY ONCE and derives its HTTP base from the same mount prefix the WS
// client uses (never a hard-coded /mp). fetch, the signer and storage are all
// injected, so no network / DOM.
import { describe, it, expect, vi } from 'vitest';
import {
  resolveMpHttpBase, httpBaseFromWsUrl,
  getStoredToken, setStoredToken, clearStoredToken,
  loginForSessionToken,
  SESSION_TOKEN_KEY, LOGIN_EVENT_KIND,
} from '../../src/engine/multiplayer/sessionAuth.js';
import { MP_WS_PATH } from '../../src/config.js';

// A minimal sessionStorage double.
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

// A fetch double: GET /auth-challenge → challenge, POST /session → token.
function fakeFetch({ challenge = 'c'.repeat(64), token = 'tok-xyz', npub = 'a'.repeat(64), sessionStatus = 200 } = {}) {
  const calls = [];
  const impl = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth-challenge')) {
      return { ok: true, status: 200, json: async () => ({ challenge, ttl: 60 }) };
    }
    if (url.endsWith('/session')) {
      const ok = sessionStatus >= 200 && sessionStatus < 300;
      return { ok, status: sessionStatus, json: async () => (ok ? { token, npub } : { error: 'nope' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  impl.calls = calls;
  return impl;
}

describe('resolveMpHttpBase', () => {
  it('derives https base from the page host + MP_WS_PATH', () => {
    const base = resolveMpHttpBase({ location: { host: 'arena.example', protocol: 'https:' } });
    expect(base).toBe(`https://arena.example${MP_WS_PATH}`);
  });

  it('uses http when the page is http (local dev)', () => {
    const base = resolveMpHttpBase({ location: { host: 'localhost:5000', protocol: 'http:' } });
    expect(base).toBe(`http://localhost:5000${MP_WS_PATH}`);
  });

  it('returns null when no location is available', () => {
    expect(resolveMpHttpBase({ location: null })).toBeNull();
  });
});

describe('httpBaseFromWsUrl', () => {
  it('maps wss → https and ws → http, preserving the path', () => {
    expect(httpBaseFromWsUrl('wss://host/mp')).toBe('https://host/mp');
    expect(httpBaseFromWsUrl('ws://host:5000/mp')).toBe('http://host:5000/mp');
  });
});

describe('token storage', () => {
  it('round-trips a token through the injected storage', () => {
    const s = fakeStorage();
    expect(getStoredToken(s)).toBeNull();
    setStoredToken('abc', s);
    expect(s._map.get(SESSION_TOKEN_KEY)).toBe('abc');
    expect(getStoredToken(s)).toBe('abc');
    clearStoredToken(s);
    expect(getStoredToken(s)).toBeNull();
  });

  it('setStoredToken ignores empty / non-string tokens', () => {
    const s = fakeStorage();
    expect(setStoredToken('', s)).toBe(false);
    expect(setStoredToken(null, s)).toBe(false);
    expect(getStoredToken(s)).toBeNull();
  });
});

describe('loginForSessionToken — one sign, one token', () => {
  const httpBase = 'https://arena.example/mp';

  it('signs EXACTLY ONCE and returns { token, npub }, storing the token', async () => {
    const signEvent = vi.fn(async (unsigned) => ({ ...unsigned, pubkey: 'a'.repeat(64), id: 'd'.repeat(64), sig: 'b'.repeat(128) }));
    const fetchImpl = fakeFetch({ token: 'tok-1', npub: 'a'.repeat(64) });
    const store = fakeStorage();
    const res = await loginForSessionToken({
      httpBase, signEvent, fetchImpl, now: () => 1_700_000_000_000,
      setToken: (t) => setStoredToken(t, store),
    });
    expect(res).toEqual({ token: 'tok-1', npub: 'a'.repeat(64) });
    expect(signEvent).toHaveBeenCalledTimes(1);
    // The signed event is a NIP-98 kind:27235 scoped to POST /session.
    const unsigned = signEvent.mock.calls[0][0];
    expect(unsigned.kind).toBe(LOGIN_EVENT_KIND);
    expect(unsigned.tags).toContainEqual(['u', `${httpBase}/session`]);
    expect(unsigned.tags).toContainEqual(['method', 'POST']);
    expect(unsigned.tags).toContainEqual(['challenge', 'c'.repeat(64)]);
    // Token persisted for the WS client to replay.
    expect(getStoredToken(store)).toBe('tok-1');
    // Exactly the two HTTP endpoints, both under the derived base (no hard /mp).
    expect(fetchImpl.calls[0].url).toBe(`${httpBase}/auth-challenge`);
    expect(fetchImpl.calls[1].url).toBe(`${httpBase}/session`);
  });

  it('returns null (and does not throw) when the server rejects the login', async () => {
    const signEvent = vi.fn(async (u) => ({ ...u, pubkey: 'a'.repeat(64), id: 'd'.repeat(64), sig: 'b'.repeat(128) }));
    const fetchImpl = fakeFetch({ sessionStatus: 401 });
    const res = await loginForSessionToken({ httpBase, signEvent, fetchImpl });
    expect(res).toBeNull();
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('returns null when the signer throws (falls back to getPublicKey in caller)', async () => {
    const signEvent = vi.fn(async () => { throw new Error('user rejected'); });
    const fetchImpl = fakeFetch();
    const res = await loginForSessionToken({ httpBase, signEvent, fetchImpl });
    expect(res).toBeNull();
  });

  it('returns null on a bad httpBase without calling the signer', async () => {
    const signEvent = vi.fn();
    expect(await loginForSessionToken({ httpBase: '', signEvent, fetchImpl: fakeFetch() })).toBeNull();
    expect(signEvent).not.toHaveBeenCalled();
  });
});

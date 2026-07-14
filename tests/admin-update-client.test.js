// tests/admin-update-client.test.js — client side of the admin "Update Now" flow
// (src/engine/update/adminUpdateClient.js, UPD-2, v0.2.387-alpha).
//
// The client signs ONE fresh intent event, POSTs it with the session bearer token,
// and polls status — it NEVER installs anything and NEVER sends a target ref. These
// tests inject every edge (fetch, signer, RNG, clock) so the whole flow runs with
// fakes and asserts: nonce shape, intent-event shape, admin-identity comparison, the
// public capability probe, the signed POST (auth header + body), and the fail-closed
// error results (never throws).
import { describe, it, expect, vi } from 'vitest';
import {
  INTENT_KIND, deployCommand, newNonce, buildIntentEvent, isAdminOperator,
  fetchCapability, requestUpdate, fetchStatus,
} from '../src/engine/update/adminUpdateClient.js';

const HEX = 'a'.repeat(64);

describe('newNonce', () => {
  it('produces a ≥16-char lowercase-hex nonce from the injected RNG', () => {
    const n = newNonce((k) => new Uint8Array(k).fill(0xab));
    expect(n).toMatch(/^[0-9a-f]{16,}$/);
    expect(n).toBe('ab'.repeat(12));
  });
});

describe('buildIntentEvent', () => {
  it('builds the unsigned kind:1 intent with the update-now content and unix-seconds clock', () => {
    const evt = buildIntentEvent({ nonce: 'deadbeefdeadbeef', now: () => 1_700_000_000_000 });
    expect(evt.kind).toBe(INTENT_KIND);
    expect(evt.kind).toBe(1);
    expect(evt.content).toBe('torii-quest:update-now:deadbeefdeadbeef');
    expect(evt.created_at).toBe(1_700_000_000); // seconds, not ms
    expect(evt.tags).toEqual([]);
  });
});

describe('isAdminOperator', () => {
  it('is true only when both are the same hex64 (case-insensitive)', () => {
    expect(isAdminOperator(HEX, HEX)).toBe(true);
    expect(isAdminOperator(HEX.toUpperCase(), HEX)).toBe(true);
    expect(isAdminOperator(HEX, 'b'.repeat(64))).toBe(false);
    expect(isAdminOperator('', HEX)).toBe(false);
    expect(isAdminOperator(HEX, null)).toBe(false);
    expect(isAdminOperator('zz', 'zz')).toBe(false);
  });
});

describe('deployCommand', () => {
  it('inlines the tag (adding a v prefix) into the host deploy command', () => {
    const cmd = deployCommand('0.2.387-alpha');
    expect(cmd).toContain('git checkout v0.2.387-alpha');
    expect(cmd).toContain('npm ci');
    expect(cmd).toContain('npm run build');
  });
  it('degrades to a <tag> placeholder for a missing/garbage tag', () => {
    expect(deployCommand(null)).toContain('<tag>');
    expect(deployCommand('garbage')).toContain('<tag>');
  });
});

describe('fetchCapability', () => {
  it('returns the parsed capability on a 200', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ autoUpdate: true, adminPubkey: HEX }) });
    const c = await fetchCapability({ httpBase: 'https://h/mp', fetchImpl });
    expect(c).toEqual({ autoUpdate: true, adminPubkey: HEX });
  });
  it('degrades to autoUpdate:false / adminPubkey:null on any failure', async () => {
    expect(await fetchCapability({ httpBase: 'https://h/mp', fetchImpl: async () => ({ ok: false }) }))
      .toEqual({ autoUpdate: false, adminPubkey: null });
    expect(await fetchCapability({ httpBase: 'https://h/mp', fetchImpl: async () => { throw new Error('x'); } }))
      .toEqual({ autoUpdate: false, adminPubkey: null });
    expect(await fetchCapability({})).toEqual({ autoUpdate: false, adminPubkey: null });
  });
});

describe('requestUpdate', () => {
  const signed = { kind: 1, content: 'torii-quest:update-now:deadbeefdeadbeef', pubkey: HEX, sig: 'f'.repeat(128) };

  it('signs the intent and POSTs it with the bearer token + { event } body', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, state: 'requested' }) }));
    const signEvent = vi.fn(async () => signed);
    const res = await requestUpdate({
      httpBase: 'https://h/mp', token: 'tok123', signEvent,
      nonce: 'deadbeefdeadbeef', now: () => 1_700_000_000_000, fetchImpl,
    });
    expect(res).toEqual({ ok: true, state: 'requested' });
    expect(signEvent).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://h/mp/admin/update');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok123');
    const body = JSON.parse(init.body);
    expect(body.event).toEqual(signed);
    // NEVER a client-supplied install target.
    expect(body.ref).toBeUndefined();
    expect(body.target).toBeUndefined();
  });

  it('fails closed (no throw) when the signer rejects', async () => {
    const res = await requestUpdate({
      httpBase: 'https://h/mp', token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      signEvent: async () => { throw new Error('user rejected'); },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign/);
  });

  it('reports the server error code/message on a non-ok response', async () => {
    const res = await requestUpdate({
      httpBase: 'https://h/mp', token: 't',
      signEvent: async () => signed,
      fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'update already running' }) }),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(409);
    expect(res.error).toMatch(/already running/);
  });

  it('guards missing inputs without throwing', async () => {
    expect((await requestUpdate({})).ok).toBe(false);
    expect((await requestUpdate({ httpBase: 'https://h/mp' })).ok).toBe(false);
    expect((await requestUpdate({ httpBase: 'https://h/mp', token: 't' })).ok).toBe(false);
  });
});

describe('fetchStatus', () => {
  it('returns the status JSON with the bearer token', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'running' }) }));
    const s = await fetchStatus({ httpBase: 'https://h/mp', token: 'tok', fetchImpl });
    expect(s).toEqual({ state: 'running' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://h/mp/admin/update-status');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
  it('degrades to { state:"unavailable" } on any failure', async () => {
    expect(await fetchStatus({ httpBase: 'https://h/mp', token: 't', fetchImpl: async () => ({ ok: false }) }))
      .toEqual({ state: 'unavailable' });
    expect(await fetchStatus({ httpBase: 'https://h/mp', token: 't', fetchImpl: async () => { throw new Error('x'); } }))
      .toEqual({ state: 'unavailable' });
    expect(await fetchStatus({})).toEqual({ state: 'unavailable' });
  });
});

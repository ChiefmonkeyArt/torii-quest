// ADR-0140 stage 3 (v0.2.918): every Nostr read, publish and Plebeian
// subscription shares the Applesauce pool (one socket per relay) once it's up.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { setSharedRelay, sharedRelay } from '../../src/engine/relay/sharedRelay.js';
import { fanoutReq, fanoutPublish } from '../../src/nostr.js';
import { subscribeByAuthor, subscribeAuction, fetchProfiles } from '../../src/engine/plebeian/plebeianRelay.js';
import { createSharedRelay, SHARED_PUBLISH_TIMEOUT_MS } from '../../src/engine/gateway/applesauceTransport.js';
import { signEvent } from '../../conformance/gateway-v1/gate-v1.mjs';

afterEach(() => setSharedRelay(null));
const SK = '44'.repeat(32);

describe('registry', () => {
  it('holds one layer with a request function, else null', () => {
    expect(sharedRelay()).toBeNull();
    setSharedRelay({ request: () => {} });
    expect(sharedRelay()).not.toBeNull();
    setSharedRelay({ nope: 1 });
    expect(sharedRelay()).toBeNull();
  });
});

describe('callers route through the shared layer when registered', () => {
  it('fanoutReq delegates (same args)', async () => {
    const request = vi.fn(async () => ({ events: [], used: ['wss://a'], failed: [] }));
    setSharedRelay({ request });
    const r = await fanoutReq(['wss://a'], [{ kinds: [0] }], { timeoutMs: 1234 });
    expect(request).toHaveBeenCalledWith(['wss://a'], [{ kinds: [0] }], { timeoutMs: 1234 });
    expect(r.used).toEqual(['wss://a']);
  });
  it('fanoutPublish uses shared publish and keeps the reasons', async () => {
    const publish = vi.fn(async (url) => (url === 'wss://ok' ? { ok: true, relay: url, accepted: true } : { ok: true, relay: url, accepted: false, error: 'rejected', reason: 'blocked: spam' }));
    setSharedRelay({ request: vi.fn(), publish });
    const r = await fanoutPublish(['wss://ok', 'wss://no'], { id: 'x' });
    expect(r).toMatchObject({ accepted: 1, used: ['wss://ok'], failed: ['wss://no'] });
    expect(r.reasons['wss://no']).toBe('rejected: blocked: spam');
  });
  it('Plebeian subscriptions and profiles use it', async () => {
    const subs = [];
    const subscribe = vi.fn((relays, filters, onEvent) => { subs.push({ relays, filters, onEvent }); return vi.fn(); });
    const request = vi.fn(async () => ({ events: [{ kind: 0, pubkey: 'a'.repeat(64), id: '1', content: JSON.stringify({ name: 'Ann', picture: 'https://x/a.png' }), tags: [], created_at: 1 }], used: [], failed: [] }));
    setSharedRelay({ request, subscribe });
    const got = [];
    const s1 = subscribeByAuthor({ url: 'wss://r', filters: [{ authors: ['b'.repeat(64)], kinds: [30402] }], onUpdate: (e) => got.push(e.length) });
    subs[0].onEvent({ id: 'p1', kind: 30402, created_at: 1, tags: [['d', 'x']] });
    expect(got).toEqual([1]);
    s1.close();
    const auc = [];
    subscribeAuction({ url: 'wss://r', auctionId: 'A', onUpdate: (x) => auc.push([!!x.auction, x.bids.length]) });
    subs[1].onEvent({ id: 'A', kind: 30408 });
    subs[1].onEvent({ id: 'B1', kind: 1023 });
    expect(auc).toEqual([[true, 0], [true, 1]]);
    expect(subs[1].filters).toEqual([{ ids: ['A'] }, { '#e': ['A'], kinds: [1023], limit: 500 }]);
    const profiles = await fetchProfiles(['a'.repeat(64)], ['wss://r']);
    expect(profiles.get('a'.repeat(64)).name).toBe('Ann');
    expect(request.mock.calls[0][2].timeoutMs).toBeLessThanOrEqual(6000);
  });
});

describe('createSharedRelay publish', () => {
  const poolWith = (publishImpl, ready = true) => async () => ({ relays: new Map([['wss://r', { ready }]]), relay: () => ({ publish: publishImpl }) });
  it('accepted, rejected with the relay reason, thrown', async () => {
    expect(await createSharedRelay({ getPool: poolWith(async () => ({ ok: true, from: 'wss://r' })) }).publish('wss://r', {})).toEqual({ ok: true, relay: 'wss://r', accepted: true, error: null });
    expect(await createSharedRelay({ getPool: poolWith(async () => ({ ok: false, message: 'blocked: new key', from: 'wss://r' })) }).publish('wss://r', {})).toEqual({ ok: true, relay: 'wss://r', accepted: false, error: 'rejected', reason: 'blocked: new key' });
    expect((await createSharedRelay({ getPool: poolWith(async () => { throw new Error('socket closed'); }) }).publish('wss://r', {})).reason).toBe('socket closed');
  });
  it('skips a relay in backoff, times out, and falls back when the pool is unusable', async () => {
    expect((await createSharedRelay({ getPool: poolWith(async () => ({ ok: true }), false) }).publish('wss://r', {})).error).toBe('cooling-down');
    expect((await createSharedRelay({ getPool: poolWith(() => new Promise(() => {})) }).publish('wss://r', {}, { timeoutMs: 30 })).error).toBe('timeout');
    const fallbackPublish = vi.fn(async () => ({ ok: true, relay: 'wss://r', accepted: true }));
    await createSharedRelay({ getPool: async () => { throw new Error('no lib'); }, fallbackPublish }).publish('wss://r', { id: 'e' });
    expect(fallbackPublish).toHaveBeenCalled();
    expect(SHARED_PUBLISH_TIMEOUT_MS).toBe(5000);
  });
});

describe('end to end: one socket per relay (real pool + local relay)', () => {
  it('reads, publishes and subscriptions share a single connection', async () => {
    const wss = new WebSocketServer({ port: 0 });
    let connections = 0; const stored = []; const live = new Set();
    wss.on('connection', (ws) => {
      connections++;
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') { live.add({ ws, id: m[1] }); for (const e of stored) ws.send(JSON.stringify(['EVENT', m[1], e])); ws.send(JSON.stringify(['EOSE', m[1]])); }
        if (m[0] === 'CLOSE') for (const s of live) if (s.ws === ws && s.id === m[1]) live.delete(s);
        if (m[0] === 'EVENT') { stored.push(m[1]); ws.send(JSON.stringify(['OK', m[1].id, true, ''])); for (const s of live) s.ws.send(JSON.stringify(['EVENT', s.id, m[1]])); }
      });
    });
    await new Promise((r) => wss.once('listening', r));
    const url = `ws://127.0.0.1:${wss.address().port}`;
    const prev = globalThis.WebSocket;
    const { default: WS } = await import('ws');
    globalThis.WebSocket = WS;
    const { RelayPool } = await import('applesauce-relay');
    const pool = new RelayPool({ keepAlive: 60000, requestReconnect: 0 });
    setSharedRelay(createSharedRelay({ getPool: async () => pool }));
    try {
      const ev = signEvent({ kind: 30402, created_at: 1700000000, tags: [['d', 'hat']], content: 'hat' }, SK);
      const pub = await fanoutPublish([url], ev);
      expect(pub.accepted).toBe(1);
      const r = await fanoutReq([url], [{ kinds: [30402] }], { timeoutMs: 2000 });
      expect(r.events.map((e) => e.id)).toEqual([ev.id]);
      const seen = [];
      const sub = subscribeByAuthor({ url, filters: [{ authors: [ev.pubkey], kinds: [30402] }], onUpdate: (list) => seen.push(list.length) });
      for (let i = 0; i < 50 && !seen.length; i++) await new Promise((res) => setTimeout(res, 20));
      expect(seen.at(-1)).toBe(1);
      for (let i = 0; i < 3; i++) await fanoutReq([url], [{ kinds: [30402] }], { timeoutMs: 2000 });
      expect(connections).toBe(1);
      sub.close();
    } finally {
      setSharedRelay(null); globalThis.WebSocket = prev;
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
    }
  }, 15000);
});

describe('wiring', () => {
  const main = readFileSync('src/main.js', 'utf8');
  it('registers only after the pool starts, with DIRECT fallbacks (no loop)', () => {
    expect(main).toMatch(/try \{ await m\.getPool\(\); setSharedRelay\(m\.createSharedRelay\(\{ fallbackRequest: fanoutReqDirect, fallbackPublish: publishEvent \}\)\); \}/);
    expect(main).toMatch(/fanout: fanoutReqDirect,/);
    expect(main).toMatch(/sharedRelay: \(sharedRelay\(\) && sharedRelay\(\)\.kind\) \|\| 'direct',/);
  });
});

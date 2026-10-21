// ADR-0140 stage 2: live directory subscription + the adopted size budget.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createLiveWorlds, LIVE_MAX_EVENTS } from '../../src/engine/gateway/liveWorlds.js';
import { createLiveSubscribe, LIVE_SUB_OPTIONS, createLiveWorlds as reExported } from '../../src/engine/gateway/applesauceTransport.js';
import { createGatewayRequestGetter, LIVE_PRESENCE_POLL_MS, LIVE_CHECK_MS } from '../../src/engine/gateway/gatewayTransport.js';
import { worldsFromEvents } from '../../src/engine/gateway/worldPresence.js';
import { verifyNostrEventSig, _sigCacheSize, SIG_CACHE_MAX } from '../../src/engine/crypto/nostrSig.js';
import { checkApplesauceBudget, LAZY_MAX_GZIP, ENTRY_SIDE_MAX_GZIP } from '../../tools/applesauce-budget.mjs';
import { signEvent } from '../../conformance/gateway-v1/gate-v1.mjs';

const HB = JSON.parse(readFileSync('conformance/gateway-v1/fixtures/heartbeats.json', 'utf8'));
const valid = HB.cases[0].event; // owner-signed, live at HB.nowSec
const tampered = HB.cases[2].event;
const tick = () => new Promise((r) => setTimeout(r, 0));
const ev = (pubkey, d, at) => ({ id: (pubkey.slice(0, 8) + d + at).padEnd(64, '0').slice(0, 64), pubkey, created_at: at, kind: 30078, tags: [['d', d]], content: '', sig: '' });

describe('createLiveWorlds', () => {
  it('subscribes only when wanted, restarts on relay change, stops when not wanted', () => {
    const stops = []; const subs = [];
    const sub = vi.fn((relays) => { subs.push(relays); const s = vi.fn(); stops.push(s); return s; });
    const L = createLiveWorlds({ getSubscribe: () => sub, onEvents: () => {} });
    L.setWanted(false, ['wss://a'], []);
    expect(sub).not.toHaveBeenCalled();
    L.setWanted(true, ['wss://a'], []); L.setWanted(true, ['wss://a'], []);
    expect(sub).toHaveBeenCalledTimes(1); // idempotent per frame
    expect(L.active).toBe(true);
    L.setWanted(true, ['wss://a', 'wss://b'], []);
    expect(stops[0]).toHaveBeenCalled();
    expect(subs[1]).toEqual(['wss://a', 'wss://b']);
    L.setWanted(false, [], []);
    expect(stops[1]).toHaveBeenCalled();
    expect(L.active).toBe(false);
  });
  it('stays inert while no live transport is available (fanout)', () => {
    const L = createLiveWorlds({ getSubscribe: () => null, onEvents: () => {} });
    L.setWanted(true, ['wss://a'], []);
    expect(L.active).toBe(false);
  });
  it('keeps the newest event per (pubkey, d), drops junk, batches the sink', async () => {
    let push; const seen = [];
    let release; const gate = new Promise((r) => { release = r; });
    const onEvents = vi.fn(async (list) => { seen.push(list.length); if (seen.length === 1) await gate; });
    const L = createLiveWorlds({ getSubscribe: () => (r, f, on) => { push = on; return () => {}; }, onEvents });
    L.setWanted(true, ['wss://a'], []);
    const pk = 'a'.repeat(64);
    push(ev(pk, 'z', 10)); // starts flush #1 (held open by the gate)
    push(ev(pk, 'z', 5)); // older: ignored
    push(ev(pk, 'z', 20)); push(ev(pk, 'y', 20)); push(null); push({ id: 'short' });
    release(); await tick(); await tick(); await tick();
    expect(onEvents).toHaveBeenCalledTimes(2); // the burst coalesced into ONE more flush
    expect(L.events().map((e) => e.created_at).sort()).toEqual([20, 20]);
    expect(L.received).toBe(4);
  });
  it('caps the buffer', () => {
    let push;
    const L = createLiveWorlds({ getSubscribe: () => (r, f, on) => { push = on; return () => {}; }, onEvents: () => {} });
    L.setWanted(true, ['wss://a'], []);
    for (let i = 0; i < LIVE_MAX_EVENTS + 25; i++) push(ev('b'.repeat(64), 'd' + i, 1));
    expect(L.events()).toHaveLength(LIVE_MAX_EVENTS);
  });
  it('a throwing subscribe or sink never escapes', async () => {
    const L = createLiveWorlds({ getSubscribe: () => () => { throw new Error('x'); }, onEvents: () => { throw new Error('y'); } });
    expect(() => L.setWanted(true, ['wss://a'], [])).not.toThrow();
    expect(L.active).toBe(false);
  });
});

describe('pushed events get the same trust as scanned ones', () => {
  it('worldsFromEvents keeps verified worlds and drops a tampered push', () => {
    const w = worldsFromEvents([valid, tampered], { nowSec: HB.nowSec, verify: true });
    expect(w.ok).toBe(true);
    expect(w.worlds.map((x) => x.zoneId)).toEqual(['nap-main']);
  });
  it('signature verdicts are cached, but altered content is still rejected', () => {
    expect(verifyNostrEventSig(valid)).toBe(true);
    const before = _sigCacheSize();
    expect(verifyNostrEventSig(valid)).toBe(true);
    expect(_sigCacheSize()).toBe(before); // cache hit, no new entry
    expect(verifyNostrEventSig({ ...valid, content: valid.content + ' ' })).toBe(false); // id recomputed first
    expect(SIG_CACHE_MAX).toBeLessThanOrEqual(4096);
  });
});

describe('createLiveSubscribe', () => {
  it('passes events through, uses reconnect options, and unsubscribes', async () => {
    const unsub = vi.fn(); let next;
    const pool = { subscription: vi.fn((relays, filters, opts) => ({ subscribe(o) { next = o.next; return { unsubscribe: unsub }; } })) };
    const got = [];
    const stop = createLiveSubscribe({ getPool: async () => pool })(['wss://a'], [{ kinds: [30078] }], (e) => got.push(e));
    await tick(); await tick();
    expect(pool.subscription.mock.calls[0][2].reconnect).toEqual(LIVE_SUB_OPTIONS.reconnect);
    next('EOSE'); next(valid);
    expect(got).toEqual([valid]);
    stop();
    expect(unsub).toHaveBeenCalled();
  });
  it('stopping before the pool resolves never subscribes', async () => {
    const pool = { subscription: vi.fn() };
    const stop = createLiveSubscribe({ getPool: async () => pool })(['wss://a'], [{}], () => {});
    stop(); await tick(); await tick();
    expect(pool.subscription).not.toHaveBeenCalled();
  });
  it('the controller is re-exported from the lazy chunk module', () => {
    expect(reExported).toBe(createLiveWorlds);
  });
});

describe('getter wiring', () => {
  it('exposes an inert stand-in until loaded, then the real controller', async () => {
    const fanout = async () => null;
    const onLiveEvents = vi.fn();
    const g = createGatewayRequestGetter({ mode: 'applesauce', fanout, onLiveEvents,
      loadApplesauce: async () => ({ createApplesauceRequest: () => async () => null, createLiveSubscribe: () => () => () => {}, createLiveWorlds }) });
    expect(g.liveWorlds().active).toBe(false);
    expect(() => g.liveWorlds().setWanted(true, ['wss://a'], [])).not.toThrow();
    await g.ready();
    g.liveWorlds().setWanted(true, ['wss://a'], []);
    expect(g.liveWorlds().active).toBe(true);
    expect(LIVE_PRESENCE_POLL_MS).toBe(60000);
    expect(LIVE_CHECK_MS).toBe(1000);
  });
  it('main.js holds the subscription only while the list is visible and slows the rescan', () => {
    const m = readFileSync('src/main.js', 'utf8');
    expect(m).toMatch(/const want = \(!isPlaying\(\) && !!state\.nostrPubkey\) \|\| isGatewayScreenOpen\(\);/);
    expect(m).toMatch(/liveWorlds\(\)\.active \? LIVE_PRESENCE_POLL_MS : POLL_MS\.presence/);
    expect(m).toMatch(/worldsFromEvents\(\[\.\.\._lastScanEvents, \.\.\._gatewayTransport\.liveWorlds\(\)\.events\(\)\], \{ verify: true/);
    expect(m).not.toMatch(/from '\.\/engine\/gateway\/liveWorlds\.js'/); // controller stays lazy
  });
});

describe('size budget (adopted v0.2.911)', () => {
  const big = (n) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join(''));
  it('budgets are the adopted numbers', () => {
    expect(LAZY_MAX_GZIP).toBe(55 * 1024);
    expect(ENTRY_SIDE_MAX_GZIP).toBe(1024);
  });
  it('passes a lazy chunk graph within budget, excluding chunks the entry loads anyway', () => {
    const assets = new Map([
      ['torii-entry-x.js', Buffer.from('import"./shared-r.js";console.log(1)')],
      ['shared-r.js', big(100000)],
      ['applesauceTransport-a.js', Buffer.from('import("./dist-b.js");import"./shared-r.js"')],
      ['dist-b.js', Buffer.from('x'.repeat(5000))],
    ]);
    const r = checkApplesauceBudget({ assets, entryName: 'torii-entry-x.js', entrySideGzip: 700 });
    expect(r.ok).toBe(true);
    expect(r.lazyFiles.sort()).toEqual(['applesauceTransport-a.js', 'dist-b.js']);
  });
  it('fails on an oversized lazy chunk, library code in the entry, or a fat entry-side module', () => {
    const assets = new Map([
      ['torii-entry-x.js', Buffer.from('class RelayConnectionError{}')],
      ['applesauceTransport-a.js', Buffer.from('import(`./dist-b.js`)')],
      ['dist-b.js', randomBytes(200000)],
    ]);
    const r = checkApplesauceBudget({ assets, entryName: 'torii-entry-x.js', entrySideGzip: 2000 });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/lazy Applesauce chunks .* > budget/);
    expect(r.errors.join('\n')).toMatch(/entry contains Applesauce/);
    expect(r.errors.join('\n')).toMatch(/entry-side gatewayTransport\.js/);
  });
  it('test:release enforces it', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['test:release']).toMatch(/npm run budget:applesauce/);
  });
});

describe('real Applesauce pool against a local relay (live arrival)', () => {
  it('backfills, then delivers a heartbeat published after subscribing', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const clients = new Set();
    const now = Math.floor(Date.now() / 1000);
    const mk = (zone, at) => signEvent({ kind: 30078, created_at: at, content: JSON.stringify({ zoneId: zone, website: 'https://w.example.org/', version: 1 }), tags: [['d', zone], ['t', 'torii-gateway'], ['expiration', String(at + 1200)]] }, '1'.repeat(64));
    const backfill = mk('first', now - 30);
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') { clients.add({ ws, id: m[1] }); ws.send(JSON.stringify(['EVENT', m[1], backfill])); ws.send(JSON.stringify(['EOSE', m[1]])); }
      });
    });
    await new Promise((r) => wss.once('listening', r));
    const url = `ws://127.0.0.1:${wss.address().port}`;
    const prevWS = globalThis.WebSocket;
    const { default: WS } = await import('ws');
    globalThis.WebSocket = WS;
    const { RelayPool } = await import('applesauce-relay');
    const pool = new RelayPool({ keepAlive: 1000 });
    const flushes = [];
    const L = createLiveWorlds({ getSubscribe: () => createLiveSubscribe({ getPool: async () => pool }), onEvents: (list) => { flushes.push(worldsFromEvents(list, { verify: true }).worlds.map((w) => w.zoneId).sort()); } });
    try {
      L.setWanted(true, [url], [{ kinds: [30078], '#t': ['torii-gateway'], limit: 200 }]);
      const until = async (pred) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 30)); };
      await until(() => flushes.some((f) => f.includes('first')));
      expect(flushes.at(-1)).toEqual(['first']);
      const t0 = Date.now();
      const live = mk('second', now);
      for (const c of clients) c.ws.send(JSON.stringify(['EVENT', c.id, live]));
      await until(() => flushes.some((f) => f.includes('second')));
      expect(flushes.at(-1)).toEqual(['first', 'second']);
      expect(Date.now() - t0).toBeLessThan(1000); // pushed, not polled
    } finally {
      L.stop();
      globalThis.WebSocket = prevWS;
      await new Promise((r) => wss.close(r));
    }
  }, 15000);
});

// ADR-0140: Applesauce relay layer for the gateway directory read path.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { relayKey, createReqCollector } from '../../src/engine/gateway/reqCollector.js';
import { reqRound, partitionReady, createApplesauceRequest, getPool, _resetPoolForTests, STRAGGLE_MS } from '../../src/engine/gateway/applesauceTransport.js';
import { resolveGatewayTransport, createGatewayRequestGetter, GATEWAY_TRANSPORT_KEY } from '../../src/engine/gateway/gatewayTransport.js';
import { GATEWAY_TRANSPORT } from '../../src/config.js';

const ev = (id) => ({ id: id.padEnd(64, '0'), kind: 30078, pubkey: 'a'.repeat(64), created_at: 1, tags: [], content: '', sig: 'b'.repeat(128) });
const A = 'wss://a.example', B = 'wss://b.example', C = 'wss://c.example';

/** A fake pool: `script(relays)` returns [delayMs, msg] pairs. */
function fakePool(script, { notReady = [] } = {}) {
  const relays = new Map();
  for (const u of [A, B, C]) relays.set(u + '/', { ready: !notReady.includes(u) });
  const calls = [];
  return {
    relays, calls,
    req(list, filters) {
      calls.push(list.slice());
      return { subscribe(o) {
        const timers = script(list, filters).map(([ms, m]) => setTimeout(() => o.next(m), ms));
        return { unsubscribe() { timers.forEach(clearTimeout); } };
      } };
    },
  };
}

describe('reqCollector', () => {
  it('normalises relay URLs', () => {
    expect(relayKey('wss://NOS.lol/')).toBe(relayKey('wss://nos.lol'));
    expect(relayKey('')).toBe('');
  });
  it('dedupes by id and accounts used / failed / pending like fanoutReq', () => {
    const c = createReqCollector([A, B, C]);
    c.onMessage({ type: 'EVENT', from: A + '/', event: ev('1') });
    c.onMessage({ type: 'EVENT', from: B + '/', event: ev('1') });
    c.onMessage({ type: 'EOSE', from: A + '/' });
    c.onMessage({ type: 'ERROR', from: C + '/' });
    expect(c.settled()).toBe(false); // B still pending
    c.onMessage({ type: 'EOSE', from: B });
    expect(c.settled()).toBe(true);
    const r = c.result();
    expect(r.events).toHaveLength(1);
    expect(r.used).toEqual([A, B]);
    expect(r.failed).toEqual([C]);
  });
  it('a relay that answered then CLOSED still counts as used; EOSE with nothing is neither', () => {
    const c = createReqCollector([A, B]);
    c.onMessage({ type: 'EVENT', from: A, event: ev('2') });
    c.onMessage({ type: 'CLOSED', from: A });
    c.onMessage({ type: 'EOSE', from: B });
    expect(c.result()).toMatchObject({ used: [A], failed: [] });
  });
  it('ignores junk and unknown relays, and treats pending-at-deadline as failed', () => {
    const c = createReqCollector([A]);
    c.onMessage(null); c.onMessage({ type: 'EVENT', from: 'wss://evil.example', event: ev('3') });
    expect(c.result()).toEqual({ events: [], used: [], failed: [A] });
  });
});

describe('reqRound / partitionReady', () => {
  it('resolves as soon as every relay settles', async () => {
    const pool = fakePool(() => [[5, { type: 'EVENT', from: A, event: ev('4') }], [6, { type: 'EOSE', from: A }], [8, { type: 'EOSE', from: B }]]);
    const c = createReqCollector([A, B]);
    const t = Date.now();
    await reqRound(pool, [A, B], [{}], c, { timeoutMs: 3000 });
    expect(Date.now() - t).toBeLessThan(500);
    expect(c.result().used).toEqual([A]);
  });
  it('caps the wait for a silent relay after the first EOSE (straggler cap)', async () => {
    const pool = fakePool(() => [[2, { type: 'EVENT', from: A, event: ev('9') }], [5, { type: 'EOSE', from: A }]]);
    const c = createReqCollector([A, B]);
    const t = Date.now();
    await reqRound(pool, [A, B], [{}], c, { timeoutMs: 5000, straggleMs: 60 });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(c.result().failed).toEqual([B]);
    expect(STRAGGLE_MS).toBe(3000);
  });
  it('an EMPTY early EOSE does not start the straggler cap', async () => {
    const pool = fakePool(() => [[2, { type: 'EOSE', from: A }], [150, { type: 'EVENT', from: B, event: ev('8') }], [160, { type: 'EOSE', from: B }]]);
    const c = createReqCollector([A, B]);
    await reqRound(pool, [A, B], [{}], c, { timeoutMs: 3000, straggleMs: 60 });
    expect(c.result().used).toEqual([B]); // B's late events were still collected
  });
  it('respects the overall deadline when no relay answers', async () => {
    const c = createReqCollector([A]);
    await reqRound(fakePool(() => []), [A], [{}], c, { timeoutMs: 40 });
    expect(c.result().failed).toEqual([A]);
  });
  it('a throwing pool marks every relay failed instead of throwing', async () => {
    const c = createReqCollector([A, B]);
    await reqRound({ req() { throw new Error('x'); } }, [A, B], [{}], c, { timeoutMs: 40 });
    expect(c.result().failed).toEqual([A, B]);
  });
  it('skips relays the pool knows are in reconnect backoff', () => {
    const pool = fakePool(() => [], { notReady: [B] });
    expect(partitionReady(pool, [A, B, 'wss://new.example'])).toEqual({ ask: [A, 'wss://new.example'], skip: [B] });
  });
});

describe('createApplesauceRequest', () => {
  it('returns fanoutReq-shaped results and never asks a backed-off relay', async () => {
    const pool = fakePool((list) => list.map((u, i) => [3 + i, { type: 'EOSE', from: u }]).concat([[1, { type: 'EVENT', from: A, event: ev('5') }]]), { notReady: [C] });
    const rq = createApplesauceRequest({ getPool: async () => pool });
    const r = await rq([A, B, C], [{ kinds: [30078] }], { timeoutMs: 2000, retries: 1 });
    expect(r.events).toHaveLength(1);
    expect(r.used).toEqual([A]);
    expect(r.failed).toEqual([C]);
    expect(pool.calls.flat()).not.toContain(C);
  });
  it('retries a relay that failed fast, once per retry', async () => {
    let n = 0;
    const pool = fakePool((list) => (n++ === 0 ? [[2, { type: 'ERROR', from: A }]] : [[2, { type: 'EVENT', from: A, event: ev('6') }], [3, { type: 'EOSE', from: A }]]));
    const r = await createApplesauceRequest({ getPool: async () => pool })([A], [{}], { timeoutMs: 1000, retries: 1 });
    expect(pool.calls).toEqual([[A], [A]]);
    expect(r.used).toEqual([A]);
  });
  it('falls back to the supplied transport when the library fails to load', async () => {
    const fallback = vi.fn(async () => ({ events: [ev('7')], used: [A], failed: [] }));
    const r = await createApplesauceRequest({ fallback, getPool: async () => { throw new Error('chunk 404'); } })([A], [{}], {});
    expect(fallback).toHaveBeenCalledOnce();
    expect(r.used).toEqual([A]);
  });
  it('empty relay list is a no-op', async () => {
    expect(await createApplesauceRequest({ getPool: async () => { throw new Error('unused'); } })([], [{}])).toEqual({ events: [], used: [], failed: [] });
  });
  it('getPool builds ONE shared pool and retries the load after a failure', async () => {
    _resetPoolForTests();
    class RelayPool { constructor(o) { this.o = o; } }
    let fail = true;
    const load = vi.fn(async () => { if (fail) throw new Error('offline'); return { RelayPool }; });
    await expect(getPool(load)).rejects.toThrow('offline');
    fail = false;
    const p1 = await getPool(load), p2 = await getPool(load);
    expect(p1).toBe(p2);
    expect(p1.o).toMatchObject({ keepAlive: 60000, requestReconnect: 0 });
    _resetPoolForTests();
  });
});

describe('gatewayTransport', () => {
  const storage = (v) => ({ getItem: (k) => (k === GATEWAY_TRANSPORT_KEY ? v : null) });
  it('URL param beats storage beats the config default; junk is ignored', () => {
    expect(resolveGatewayTransport({ fallback: 'applesauce' })).toBe('applesauce');
    expect(resolveGatewayTransport({ fallback: 'applesauce', storage: storage('fanout') })).toBe('fanout');
    expect(resolveGatewayTransport({ fallback: 'fanout', storage: storage('fanout'), search: '?gateway-transport=Applesauce' })).toBe('applesauce');
    expect(resolveGatewayTransport({ fallback: 'bogus', storage: storage('rm -rf'), search: '?gateway-transport=<x>' })).toBe('fanout');
    expect(resolveGatewayTransport({ storage: { getItem() { throw new Error('blocked'); } } })).toBe('fanout');
  });
  it('serves fanout until Applesauce has loaded, then Applesauce', async () => {
    const fanout = async () => ({ events: [], used: [], failed: [] });
    let run = null;
    const g = createGatewayRequestGetter({ mode: 'applesauce', fanout, loadApplesauce: async () => ({ createApplesauceRequest: ({ fallback }) => Object.assign(async () => 'as', { fallback }) }), schedule: (fn) => { run = fn; } });
    expect(g.get()).toBe(fanout); // first scan at boot: no library download yet
    expect(g.active).toBe('fanout');
    run(); // idle callback fires
    const t = await g.ready();
    expect(t.fallback).toBe(fanout);
    expect(g.get()).toBe(t);
    expect(g.active).toBe('applesauce');
  });
  it('a failed load pins fanout; mode fanout never loads the library', async () => {
    const fanout = async () => null;
    const g = createGatewayRequestGetter({ mode: 'applesauce', fanout, loadApplesauce: async () => { throw new Error('x'); } });
    expect(await g.ready()).toBe(fanout);
    const load = vi.fn();
    const h = createGatewayRequestGetter({ mode: 'fanout', fanout, loadApplesauce: load });
    expect(await h.ready()).toBe(fanout);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  const main = readFileSync('src/main.js', 'utf8');
  it('directory scan and owner profiles use the gateway transport', () => {
    expect(main).toMatch(/const req = _gatewayTransport\.get\(\);\n  const r = await fetchOnlineWorlds\(\{/);
    expect(main).toMatch(/const ownerRequest = _gatewayTransport\.get\(\);/);
    expect(main).toMatch(/loadApplesauce: async \(\) => \{\n\s+const m = await import\('\.\/engine\/gateway\/applesauceTransport\.js'\);/);
    expect(main).toMatch(/requestIdleCallback\(fn, \{ timeout: 8000 \}\)/);
  });
  it('applesauce is never statically imported (stays out of entry + arena chunks)', () => {
    const t = readFileSync('src/engine/gateway/applesauceTransport.js', 'utf8');
    expect(t).not.toMatch(/^import .*applesauce-relay/m);
    expect(t).toMatch(/import\('applesauce-relay'\)/);
    expect(main).not.toMatch(/^import .*applesauceTransport/m);
  });
  it('default transport is applesauce (ADR-0140 accepted for the directory read path)', () => {
    expect(GATEWAY_TRANSPORT).toBe('applesauce');
  });
  it('applesauce-relay is pinned exactly', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['applesauce-relay']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

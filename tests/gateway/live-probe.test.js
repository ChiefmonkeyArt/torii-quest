// ADR-0140 stage 2: the operator live probe (ToriiDebug.gatewayLiveProbe).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { buildProbeEvent, runLiveProbe, PROBE_TTL_SEC, PROBE_VISIBLE_SEC } from '../../src/engine/gateway/liveProbe.js';
import { readGateways, PRESENCE_GRACE_SEC } from '../../src/engine/gateway/gatewayRead.js';
import { worldsFromEvents } from '../../src/engine/gateway/worldPresence.js';
import { createLiveWorlds } from '../../src/engine/gateway/liveWorlds.js';
import { createLiveSubscribe } from '../../src/engine/gateway/applesauceTransport.js';
import { readHeartbeat } from '../../conformance/gateway-v1/gate-v1.mjs';

const SK = new Uint8Array(32).fill(7);
const NOW = 1792540800;

describe('probe heartbeat', () => {
  const { event, zoneId } = buildProbeEvent({ nowSec: NOW, website: 'https://quest.example.org/', secretKey: SK, tag: 'abcd1234' });
  it('is a signed, verifiable Gate v1 heartbeat that Quest and the kit both list', () => {
    expect(zoneId).toBe('live-probe-abcd1234');
    const q = readGateways([event], { nowSec: NOW, verify: true });
    expect(q.count).toBe(1);
    expect(q.gateways[0].trust).toBe('signature-verified');
    expect(readHeartbeat(event, { nowSec: NOW }).ok).toBe(true);
  });
  it('leaves every Gate v1 directory within 90 s (expiry + back-dated grace)', () => {
    expect(PROBE_TTL_SEC).toBe(60);
    expect(event.created_at).toBe(NOW - PRESENCE_GRACE_SEC + PROBE_VISIBLE_SEC);
    for (const t of [NOW + 30, NOW + 89]) expect(readGateways([event], { nowSec: t, verify: true }).count, String(t)).toBe(1);
    for (const t of [NOW + 91, NOW + 600]) {
      expect(readGateways([event], { nowSec: t, verify: true }).count, String(t)).toBe(0);
      expect(readHeartbeat(event, { nowSec: t }).ok).toBe(false);
    }
  });
  it('is clearly labelled as a test', () => {
    expect(JSON.parse(event.content).title).toMatch(/live probe \(test/);
  });
});

describe('runLiveProbe', () => {
  it('refuses when the live list is not active', async () => {
    const r = await runLiveProbe({ live: { active: false }, publish: vi.fn(), isListed: () => false, website: 'https://q.example/' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/live-inactive/);
  });
  it('refuses a non-https website, and reports no-relay-accepted', async () => {
    const live = { active: true, onArrival: () => () => {} };
    expect((await runLiveProbe({ live, publish: vi.fn(), isListed: () => false, website: 'http://q.example/' })).error).toMatch(/https/);
    const r = await runLiveProbe({ live, publish: async () => ({ accepted: 0 }), isListed: () => false, website: 'https://q.example/', secretKey: SK });
    expect(r.error).toMatch(/no relay accepted/);
  });
  it('times out cleanly when nothing comes back, and unhooks its listener', async () => {
    const offs = [];
    const live = { active: true, onArrival: () => { const off = vi.fn(); offs.push(off); return off; } };
    const r = await runLiveProbe({ live, publish: async () => ({ accepted: 2 }), isListed: () => false, website: 'https://q.example/', secretKey: SK, timeoutMs: 80 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not pushed within 80 ms/);
    expect(offs[0]).toHaveBeenCalled();
  });
  it('measures the listing independently of a slow publish (v0.2.914)', async () => {
    let fire;
    const live = { active: true, onArrival: (fn) => { fire = fn; return () => {}; } };
    let listedNow = false;
    const publish = async (ev) => {
      setTimeout(() => { fire(ev, Date.now()); listedNow = true; }, 20); // pushed back fast
      await new Promise((r) => setTimeout(r, 400)); // one slow relay holds publish
      return { accepted: 5, failed: ['wss://slow.example'] };
    };
    const r = await runLiveProbe({ live, publish, isListed: () => listedNow, website: 'https://q.example/', secretKey: SK, timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    expect(r.publishMs).toBeGreaterThanOrEqual(380);
    expect(r.listedMs).toBeLessThan(300);
    expect(r.failedRelays).toEqual(['wss://slow.example']);
  });
  it('the controller exposes onArrival and its stand-in is inert', () => {
    const L = createLiveWorlds({ getSubscribe: () => null, onEvents: () => {} });
    const off = L.onArrival(() => {});
    expect(typeof off).toBe('function');
  });
});

describe('end to end: real Applesauce pool + local relay', () => {
  it('publish → pushed back → listed, with timings', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const subs = new Set(); const stored = [];
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') { subs.add({ ws, id: m[1] }); for (const e of stored) ws.send(JSON.stringify(['EVENT', m[1], e])); ws.send(JSON.stringify(['EOSE', m[1]])); }
        if (m[0] === 'EVENT') { stored.push(m[1]); ws.send(JSON.stringify(['OK', m[1].id, true, ''])); for (const s of subs) s.ws.send(JSON.stringify(['EVENT', s.id, m[1]])); }
      });
    });
    await new Promise((r) => wss.once('listening', r));
    const url = `ws://127.0.0.1:${wss.address().port}`;
    const prev = globalThis.WebSocket;
    const { default: WS } = await import('ws');
    globalThis.WebSocket = WS;
    const { RelayPool } = await import('applesauce-relay');
    const pool = new RelayPool({ keepAlive: 1000 });
    let listed = [];
    const L = createLiveWorlds({ getSubscribe: () => createLiveSubscribe({ getPool: async () => pool }), onEvents: (list) => { listed = worldsFromEvents(list, { verify: true }).worlds; } });
    try {
      L.setWanted(true, [url], [{ kinds: [30078], '#t': ['torii-gateway'], limit: 200 }]);
      for (let i = 0; i < 50 && !L.active; i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 150)); // subscription open
      const publish = (ev) => new Promise((resolve) => {
        const ws = new WS(url);
        ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
        ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m[0] === 'OK') { ws.close(); resolve({ accepted: m[2] ? 1 : 0 }); } });
      });
      const r = await runLiveProbe({ live: L, publish, isListed: (z) => listed.some((w) => w.zoneId === z), website: 'https://quest.example.org/', transport: 'applesauce', timeoutMs: 5000 });
      expect(r.error).toBeNull();
      expect(r.ok).toBe(true);
      expect(r.accepted).toBe(1);
      expect(r.arrivalMs).toBeLessThan(2000);
      expect(r.listedMs).toBeGreaterThanOrEqual(r.arrivalMs);
    } finally {
      L.stop(); globalThis.WebSocket = prev;
      await new Promise((r) => wss.close(r));
    }
  }, 15000);
});

describe('wiring', () => {
  it('ToriiDebug.gatewayLiveProbe lazy-loads the probe and uses the live controller', () => {
    const m = readFileSync('src/main.js', 'utf8');
    expect(m).toMatch(/window\.ToriiDebug\.gatewayLiveProbe = async \(\) => \{\n\s+const m = await import\('\.\/engine\/gateway\/liveProbe\.js'\);/);
    expect(m).toMatch(/live: _gatewayTransport\.liveWorlds\(\),/);
    expect(m).not.toMatch(/^import .*liveProbe/m);
  });
});

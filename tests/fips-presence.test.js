import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  BACKOFF_MS, MAX_PEERS, createFipsPresence, createReloadingFipsPresence, meshAddress, parsePeerConfig, publicAddress, queryHeartbeat, validHeartbeat,
} from '../server/presence/fipsPresence.js';
import { MAX_PEER_EVENTS, createNodePresenceCache, mergeNodeWorlds } from '../src/engine/presence/nodePresenceClient.js';

const owner = '2'.repeat(64);
const sk = generateSecretKey();
const beaconPubkey = getPublicKey(sk);
const transportNpub = nip19.npubEncode(getPublicKey(generateSecretKey()));
const peer = parsePeerConfig({ version: 1, peers: [{
  beaconPubkey, ownerPubkey: owner, zoneId: 'torii-quest',
  website: 'https://peer.example/', transportNpub,
}] })[0];

function heartbeat(nowMs = 1_800_000_000_000) {
  const created_at = Math.floor(nowMs / 1000) - 10;
  return finalizeEvent({
    kind: 30078, created_at, pubkey: beaconPubkey,
    tags: [
      ['d', 'torii-quest'], ['t', 'torii-gateway'], ['p', owner],
      ['expiration', String(created_at + 1200)],
    ],
    content: JSON.stringify({
      zoneId: 'torii-quest', website: 'https://peer.example/',
      title: 'Remote world', version: 1,
    }),
  }, sk);
}

// n distinct peers, each with its own beacon key, world and fresh heartbeat.
function fleet(n, nowMs = 1_800_000_000_000) {
  return Array.from({ length: n }, (_, i) => {
    const key = generateSecretKey();
    const raw = {
      beaconPubkey: getPublicKey(key), ownerPubkey: owner, zoneId: `world-${i}`,
      website: `https://peer${i}.example/`, transportNpub: nip19.npubEncode(getPublicKey(generateSecretKey())),
    };
    const created_at = Math.floor(nowMs / 1000) - 10;
    const event = finalizeEvent({
      kind: 30078, created_at,
      tags: [['d', raw.zoneId], ['t', 'torii-gateway'], ['p', owner], ['expiration', String(created_at + 1200)]],
      content: JSON.stringify({ zoneId: raw.zoneId, website: raw.website, title: `World ${i}`, version: 1 }),
    }, key);
    return { raw, event, get peer() { return this._p ??= parsePeerConfig({ version: 1, peers: [raw] })[0]; } };
  });
}

describe('two-node FIPS presence boundary', () => {
  it('derives the documented npub-bound fd address', () => {
    expect(meshAddress(transportNpub)).toMatch(/^fd[0-9a-f]{2}(?::[0-9a-f]{4}){7}$/);
  });

  it('accepts only an authentic, pinned, fresh heartbeat', () => {
    const now = 1_800_000_000_000;
    const good = heartbeat(now);
    expect(validHeartbeat(good, peer, now)).toBe(true);
    expect(validHeartbeat({ ...good, sig: '0'.repeat(128) }, peer, now)).toBe(false);
    expect(validHeartbeat(heartbeat(now - 1_300_000), peer, now)).toBe(false);
    expect(validHeartbeat({ ...good, content: JSON.stringify({
      zoneId: 'torii-quest', website: 'https://attacker.example/',
    }) }, peer, now)).toBe(false);
  });

  it('rejects unsafe and duplicate peer configuration', () => {
    const config = { version: 1, peers: [{
      beaconPubkey, ownerPubkey: owner, zoneId: 'torii-quest',
      website: 'https://localhost/', transportNpub,
    }] };
    expect(() => parsePeerConfig(config)).toThrow();
    config.peers[0].website = 'https://peer.example/';
    config.peers.push(config.peers[0]);
    expect(() => parsePeerConfig(config)).toThrow(/duplicate/);
  });

  it('accepts 8 peers and refuses a ninth (ADR-0151)', () => {
    expect(MAX_PEERS).toBe(8);
    const eight = { version: 1, peers: fleet(8).map(f => f.raw) };
    expect(parsePeerConfig(eight)).toHaveLength(8);
    expect(JSON.stringify(eight).length).toBeLessThan(8192);
    expect(() => parsePeerConfig({ version: 1, peers: fleet(9).map(f => f.raw) })).toThrow(/at most 8/);
    expect(() => createFipsPresence({ peers: fleet(9).map(f => f.peer) })).toThrow(/at most 8/);
  });

  it('reads peers one at a time, round-robin, and lists every live heartbeat', async () => {
    const now = 1_800_000_000_000;
    const peers = fleet(3, now);
    const query = vi.fn(async (url, p) => (url === p.meshUrl ? peers.find(f => f.peer === p).event : null));
    const p = createFipsPresence({ peers: peers.map(f => f.peer), query, now: () => now });
    for (let i = 0; i < 3; i++) await p.poll();
    expect(query.mock.calls.map(c => c[1])).toEqual(peers.map(f => f.peer));
    const snap = p.snapshot();
    expect(snap.peers).toBe(3);
    expect(snap.events.map(e => e.id).sort()).toEqual(peers.map(f => f.event.id).sort());
    // Same-origin client accepts the whole list (up to 8) and verifies each.
    const cache = createNodePresenceCache({
      now: () => now, origin: 'https://home.example',
      fetchImpl: async () => new Response(JSON.stringify(snap)),
    });
    await cache.refresh('/mp');
    expect(cache.worlds('')).toHaveLength(3);
  });

  it('never runs two reads at once across peers', async () => {
    const peers = fleet(2);
    let release;
    const query = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const p = createFipsPresence({ peers: peers.map(f => f.peer), query, now: () => 1_800_000_000_000 });
    const first = p.poll();
    await p.poll();
    expect(query).toHaveBeenCalledTimes(1);
    release(null); await Promise.resolve(); await Promise.resolve(); release(null);
    await first;
  });

  it('backs off a failing peer so the others keep their turns', async () => {
    let now = 1_800_000_000_000;
    const peers = fleet(2, now);
    const [bad, good] = peers;
    const query = vi.fn(async (url, p) => (p === good.peer ? good.event : null));
    const p = createFipsPresence({ peers: peers.map(f => f.peer), query, now: () => now });
    await p.poll(); // bad fails (mesh + wss)
    await p.poll(); // good
    query.mockClear();
    for (let i = 0; i < 3; i++) await p.poll();
    expect(query.mock.calls.every(c => c[1] === good.peer)).toBe(true);
    now += BACKOFF_MS[0];
    query.mockClear();
    await p.poll(); await p.poll();
    expect(query.mock.calls.some(c => c[1] === bad.peer)).toBe(true);
  });

  it('refuses a snapshot list longer than 8 in the browser', async () => {
    const now = 1_800_000_000_000;
    const events = fleet(9, now).map(f => f.event);
    const cache = createNodePresenceCache({
      now: () => now, origin: 'https://home.example',
      fetchImpl: async () => new Response(JSON.stringify({ events })),
    });
    await cache.refresh('/mp');
    expect(cache.worlds('')).toHaveLength(0);
    expect(MAX_PEER_EVENTS).toBe(MAX_PEERS);
  });

  it('tries FIPS first, then bounded WSS fallback, outside UI flow', async () => {
    const good = heartbeat();
    const query = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(good);
    const p = createFipsPresence({ peers: [peer], query, now: () => 1_800_000_000_000 });
    await p.poll();
    expect(query.mock.calls.map(c => c[0])).toEqual([peer.meshUrl, peer.fallbackUrl]);
    expect(p.snapshot().events).toEqual([JSON.parse(JSON.stringify(good))]);
    expect(p.snapshot().via).toBe('wss');
  });

  it('bounds relay frames and terminates the socket', async () => {
    class FakeSocket {
      handlers = {};
      terminated = false;
      constructor() { queueMicrotask(() => this.handlers.open?.()); }
      on(name, fn) { this.handlers[name] = fn; }
      send() {
        for (let i = 0; i < 9; i++) this.handlers.message(Buffer.from('["NOTICE","x"]'));
      }
      terminate() { this.terminated = true; }
    }
    await expect(queryHeartbeat(peer.meshUrl, peer, {
      WebSocketImpl: FakeSocket, timeoutMs: 20,
    })).resolves.toBe(null);
  });

  it('merges a verified same-origin snapshot without waiting for it', async () => {
    const good = heartbeat();
    const body = JSON.stringify({ events: [good] });
    const cache = createNodePresenceCache({
      now: () => 1_800_000_000_000,
      origin: 'https://home.example',
      fetchImpl: async () => new Response(body),
    });
    await cache.refresh('/mp');
    const mesh = cache.worlds('');
    expect(mesh).toHaveLength(1);
    expect(mergeNodeWorlds(mesh, mesh)).toHaveLength(1);
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1',
    'fd00::1', '::ffff:127.0.0.1', '2001:db8::1', '192.168.1.1'])('blocks private fallback address %s', address => {
    expect(publicAddress(address)).toBe(false);
  });

  it('permits globally routable fallback addresses', () => {
    expect(publicAddress('1.1.1.1')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('does not fetch the visited world server or any other origin', async () => {
    const fetchImpl = vi.fn();
    const cache = createNodePresenceCache({ origin: 'https://home.example', fetchImpl });
    await cache.refresh('https://other.example/mp');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('expires an accepted event during outage and recovers without overlap', async () => {
    let now = 1_800_000_000_000;
    const good = heartbeat(now);
    let release;
    const query = vi.fn().mockResolvedValueOnce(good)
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const p = createFipsPresence({ peers: [peer], query, now: () => now });
    await p.poll();
    now += 1_300_000;
    expect(p.snapshot().events).toEqual([]);
    const pending = p.poll();
    await p.poll();
    expect(query).toHaveBeenCalledTimes(2);
    release(heartbeat(now));
    await pending;
    expect(p.snapshot().events).toHaveLength(1);
    expect(p.snapshot().via).toBe('fips');
  });

  it('falls back even if the mesh transport throws', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce(heartbeat());
    const p = createFipsPresence({ peers: [peer], query, now: () => 1_800_000_000_000 });
    await p.poll();
    expect(p.snapshot().via).toBe('wss');
  });

  it('rejects correctly signed but unauthorized or ambiguous heartbeats', () => {
    const good = heartbeat();
    const signed = patch => finalizeEvent({ ...good, ...patch }, sk);
    for (const event of [
      signed({ created_at: good.created_at + 200 }),
      signed({ tags: good.tags.map(t => t[0] === 'p' ? ['p', '3'.repeat(64)] : t) }),
      signed({ tags: [...good.tags, ['expiration', String(good.created_at + 500)]] }),
      signed({ tags: good.tags.map(t => t[0] === 'd' ? ['d', 'different-world'] : t) }),
      signed({ tags: good.tags.map(t => t[0] === 'expiration' ? ['expiration', String(good.created_at + 99999)] : t) }),
      signed({ content: 'x'.repeat(9000) }),
    ]) expect(validHeartbeat(event, peer, 1_800_000_000_000)).toBe(false);
  });

  it('reloads a changed peer file without a restart, and survives a bad one', () => {
    let st = { ino: 1, size: 10, mtimeMs: 1 }, configs = [{ peers: [] }];
    const made = [];
    const create = cfg => { const o = { cfg, started: 0, stopped: 0, snapshot: () => ({ n: cfg.peers.length }), poll() {},
      start() { this.started++; }, stop() { this.stopped++; } }; made.push(o); return o; };
    const r = createReloadingFipsPresence('/etc/torii/fips/peers.json', {
      stat: () => st, load: () => configs.shift() ?? { peers: [], error: 'invalid-peer-config' }, create, intervalMs: 1e9,
    });
    r.start();
    expect(r.check()).toBe(false);
    configs.push({ peers: [1, 2] });
    st = { ...st, mtimeMs: 2 };
    expect(r.check()).toBe(true);
    expect(made[0].stopped).toBe(1);
    expect(made[1].started).toBe(1);
    expect(r.snapshot()).toEqual({ n: 2 });
    st = { ...st, size: 11 };
    expect(r.check()).toBe(true);
    expect(made[2].cfg.error).toBe('invalid-peer-config');
    r.stop();
  });
});

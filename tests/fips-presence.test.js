import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  createFipsPresence, meshAddress, parsePeerConfig, publicAddress, queryHeartbeat, validHeartbeat,
} from '../server/presence/fipsPresence.js';
import { createNodePresenceCache, mergeNodeWorlds } from '../src/engine/presence/nodePresenceClient.js';

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

  it('rejects unsafe and multi-peer proof configuration', () => {
    const config = { version: 1, peers: [{
      beaconPubkey, ownerPubkey: owner, zoneId: 'torii-quest',
      website: 'https://localhost/', transportNpub,
    }] };
    expect(() => parsePeerConfig(config)).toThrow();
    config.peers[0].website = 'https://peer.example/';
    config.peers.push(config.peers[0]);
    expect(() => parsePeerConfig(config)).toThrow(/at most one/);
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
});

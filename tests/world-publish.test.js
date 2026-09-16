// tests/world-publish.test.js — the beacon's publish half of world-as-data
// (server/world/worldPublish.js, ADR-0119 slice 4). Node-safe; verifies the
// zone sampling maps the legacy heightfield convention exactly, the manifest
// round-trips through the schema, the reference mint carries the right tags, and
// the end-to-end publish uploads-then-signs-then-publishes with injected transports.
import { describe, it, expect } from 'vitest';
import {
  buildWorldZones, buildWorldManifest, publishWorld, worldReferenceForManifest,
} from '../server/world/worldPublish.js';
import { ARENA_GRID, NAP_GRID, ARENA_TERRAIN, NAP_TERRAIN } from '../src/terrain/heightmap.js';
import { sha256Hex } from '../src/engine/world/worldResolver.js';

const LEGACY = {
  name: 'Test Arena',
  mode: 'arena-shooter',
  spawns: { player: { x: -14, y: 3.1, z: -14, yaw: -2.356194490192345 } },
  lights: [{ type: 'ambient', color: '#fff', intensity: 1 }],
  objects: [{ type: 'torii-gate', pos: [20, 0, 0], rot: 0 }],
  combat: { botCount: 5 },
  bounds: { arenaHalf: 20 },
};

describe('buildWorldZones', () => {
  it('samples arena + nap zones matching the legacy createHeightfield convention', () => {
    const zones = buildWorldZones();
    expect(zones).toHaveLength(2);
    const [arena, nap] = zones;
    expect(arena.rows).toBe(ARENA_GRID.rowsZ);
    expect(arena.cols).toBe(ARENA_GRID.colsX);
    expect(arena.scale[0]).toBeCloseTo(ARENA_TERRAIN.gWidth, 4);
    expect(arena.scale[1]).toBe(1);
    expect(arena.scale[2]).toBeCloseTo(ARENA_TERRAIN.gDepth, 4);
    expect(arena.offset[0]).toBeCloseTo(ARENA_TERRAIN.gCenterX, 4);
    expect(arena.offset[2]).toBeCloseTo(ARENA_TERRAIN.gCenterZ, 4);
    expect(arena.heights.length).toBe(ARENA_GRID.rowsZ * ARENA_GRID.colsX);
    expect(nap.rows).toBe(NAP_GRID.rowsZ);
    expect(nap.cols).toBe(NAP_GRID.colsX);
    expect(nap.heights.length).toBe(NAP_GRID.rowsZ * NAP_GRID.colsX);
  });
});

describe('buildWorldManifest', () => {
  it('serializes the legacy config + zones into a valid, hash-stable manifesto', () => {
    const zones = buildWorldZones();
    const a = buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones });
    const b = buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones: buildWorldZones() });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.manifestJson).toBe(b.manifestJson); // deterministic → stable content address
    const world = JSON.parse(a.manifestJson);
    expect(world.version).toBe(1);
    expect(world.id).toBe('torii-quest');
    expect(world.terrain.zones).toHaveLength(2);
    expect(world.sea).toBe(true);
    expect(world.foliage).toBe(true);
    expect(world.combat).toEqual({ botCount: 5 });
    expect(world.bounds).toEqual({ arenaHalf: 20 });
  });

  it('fails loudly on a bad worldId or missing zones', () => {
    expect(buildWorldManifest({ worldId: 'BAD ID!', legacy: LEGACY, zones: buildWorldZones() }).ok).toBe(false);
    expect(buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones: [] }).ok).toBe(false);
  });
});

describe('worldReferenceForManifest', () => {
  it('mints a kind:30078 torii-world reference scoped to the manifest hash', () => {
    const m = buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones: buildWorldZones() });
    const r = worldReferenceForManifest({
      manifestJson: m.manifestJson,
      worldId: 'torii-quest',
      relays: ['wss://relay.example.com'],
      blossomServer: 'https://blossom.primal.net',
      version: 'v0.2.860-alpha',
    });
    expect(r.ok).toBe(true);
    expect(r.unsigned.kind).toBe(30078);
    expect(r.unsigned.content).toBe('');
    const tags = Object.fromEntries(r.unsigned.tags.map((t) => [t[0], t[1]]));
    expect(tags.d).toBe('torii-quest');
    expect(tags.t).toBe('torii-world');
    expect(tags.manifest).toBe(r.manifestHash);
    expect(tags.manifest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('publishWorld', () => {
  it('uploads to Blossom then signs + publishes the reference (happy path)', async () => {
    const m = buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones: buildWorldZones() });
    const hash = sha256Hex(m.manifestJson);
    const uploads = [];
    const signedEvents = [];
    const pubCalls = [];
    const r = await publishWorld({
      manifestJson: m.manifestJson,
      worldId: 'torii-quest',
      relays: ['wss://r1', 'wss://r2'],
      blossomServer: 'https://blossom.primal.net',
      version: 'v0.2.860-alpha',
      signEvent: async (unsigned) => { signedEvents.push(unsigned); return { id: 'c'.repeat(64), sig: 'd'.repeat(128), ...unsigned }; },
      relayPub: async (signed, relays) => { pubCalls.push({ relays }); return { ok: true }; },
      fetchImpl: async (url, opts) => {
        uploads.push({ url, body: opts.body, hasAuth: /^Nostr /.test(opts.headers.Authorization) });
        return { ok: true, status: 200, json: async () => ({ sha256: hash }) };
      },
    });
    expect(r.ok).toBe(true);
    expect(r.manifestHash).toBe(hash);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe('https://blossom.primal.net/upload');
    expect(uploads[0].body).toBe(m.manifestJson);
    expect(uploads[0].hasAuth).toBe(true);
    expect(signedEvents).toHaveLength(2); // 1 = Blossom auth, 2 = world reference
    expect(signedEvents[0].kind).toBe(24242);   // BUD-11 upload auth
    expect(signedEvents[1].kind).toBe(30078);   // torii-world reference
    expect(pubCalls).toHaveLength(1);
    expect(pubCalls[0].relays).toEqual(['wss://r1', 'wss://r2']);
  });

  it('fails with upload-failed when the Blossom PUT rejects', async () => {
    const m = buildWorldManifest({ worldId: 'torii-quest', legacy: LEGACY, zones: buildWorldZones() });
    const r = await publishWorld({
      manifestJson: m.manifestJson,
      worldId: 'torii-quest',
      relays: ['wss://r1'],
      signEvent: async () => ({ id: 'c'.repeat(64), sig: 'd'.repeat(128) }),
      relayPub: async () => ({ ok: true }),
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/upload-failed/);
  });
});
// v0.2.931 (ADR-0147 M1): visitors build the owner's Starter Pack island from the
// published world description: `base: 'starter-island'` + components + owner.
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const subs = [];
const RELAY = '../../src/engine/plebeian/plebeianRelay.js';

const { validateWorld } = await import('../../src/engine/world/worldSchema.js');
const { serializeArenaWorld } = await import('../../src/engine/world/arenaSerialize.js');
const { buildWorldManifest, buildWorldZones } = await import('../../server/world/worldPublish.js');
const { resolveHomeWorldPaths } = await import('../../server/world/worldConfigPath.js');
const { planFromWorld } = await import('../../src/engine/world/homeWorld.js');

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const OWNER = 'ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25';
const OTHER = 'a'.repeat(64);
const legacy = JSON.parse(read('worlds/default/world.json'));

describe('schema: base + owner', () => {
  it('keeps starter-island and a hex owner', () => {
    const v = validateWorld({ id: 'w', version: 1, name: 'W', base: 'starter-island', owner: OWNER });
    expect(v.ok).toBe(true);
    expect(v.world.base).toBe('starter-island');
    expect(v.world.owner).toBe(OWNER);
  });
  it('drops an unknown base and a bad owner without failing the world', () => {
    for (const owner of ['EC' + OWNER.slice(2), 'npub1xyz', 42, OWNER + '0']) {
      const v = validateWorld({ id: 'w', version: 1, name: 'W', base: 'castle', owner });
      expect(v.ok).toBe(true);
      expect(v.world.base).toBeUndefined();
      expect(v.world.owner).toBeUndefined();
    }
  });
});

describe('serializer + publish', () => {
  const zones = buildWorldZones();
  it('emits base, components and owner when the home is known', () => {
    const r = serializeArenaWorld({ worldId: 'home', legacy, zones, home: ['world.island', 'world.sea', 'nap.zone'], owner: OWNER });
    expect(r.ok).toBe(true);
    expect(r.world.base).toBe('starter-island');
    expect(r.world.components).toEqual([{ id: 'world.island' }, { id: 'world.sea' }, { id: 'nap.zone' }]);
    expect(r.world.owner).toBe(OWNER);
    expect(r.world.terrain).toBeTruthy(); // older clients still render the data copy
    const plan = planFromWorld(r.world);
    expect(plan.source).toBe('file');
    expect([...plan.plan].sort()).toEqual(['nap.zone', 'world.island', 'world.sea']);
  });
  it('stays a plain data world without a home (back-compat) and filters bad ids', () => {
    const plain = serializeArenaWorld({ worldId: 'home', legacy, zones });
    expect(plain.world.base).toBeUndefined();
    expect(plain.world.owner).toBeUndefined();
    const bad = serializeArenaWorld({ worldId: 'home', legacy, zones, home: ['<script>', 7, 'Nope.X'], owner: 'nope' });
    expect(bad.world.base).toBeUndefined();
    expect(bad.world.owner).toBeUndefined();
  });
  it('buildWorldManifest passes home + owner through', () => {
    const r = buildWorldManifest({ worldId: 'home', legacy, zones, home: ['world.island'], owner: OWNER });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.manifestJson).base).toBe('starter-island');
  });
  it('home description paths: env, operator data, cwd, current', () => {
    const p = resolveHomeWorldPaths('/srv/q/mp', { QUEST_HOME_WORLD_JSON_PATH: '/x/home.json' });
    expect(p).toEqual(['/x/home.json', join('/srv/q', 'data/worlds/home/world.json'), join('/srv/q/mp', 'worlds/home/world.json'), join('/srv/q', 'current/worlds/home/world.json')]);
    expect(resolveHomeWorldPaths('/a/b', {}).length).toBe(3);
  });
});

describe('ownerBoards owner override', () => {
  // The suite runs with isolate:false, so load a FRESH ownerBoards bound to a
  // fake relay for this block only, and restore the shared state afterwards.
  let ob; let hadWindow; let prevWindow;
  beforeAll(async () => {
    hadWindow = 'window' in globalThis; prevWindow = globalThis.window;
    vi.resetModules();
    vi.doMock(RELAY, () => ({
      PLEBEIAN_PRODUCT_KIND: 30402, PLEBEIAN_AUCTION_KIND: 30408,
      subscribeByAuthor: (o) => { const s = { o, closed: false, close() { this.closed = true; } }; subs.push(s); return s; },
    }));
    ob = await import('../../src/engine/plebeian/ownerBoards.js');
  });
  afterAll(() => {
    ob._resetOwnerBoards();
    vi.doUnmock(RELAY);
    vi.resetModules();
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  });
  beforeEach(() => { ob._resetOwnerBoards(); subs.length = 0; globalThis.window = { __toriiHostPubkey: OWNER }; });
  it('a visited owner replaces this node\u2019s owner and reopens the feeds', () => {
    ob.setBoardsWorldWanted(true);
    expect(ob._ownerBoardsState().owner).toBe(OWNER);
    const first = subs.length;
    expect(first).toBeGreaterThan(0);
    ob.setBoardOwnerOverride(OTHER);
    expect(subs.slice(0, first).every((s) => s.closed)).toBe(true);
    expect(ob._ownerBoardsState().owner).toBe(OTHER);
    expect(ob._ownerBoardsState().override).toBe(OTHER);
    expect(subs.slice(first).every((s) => s.o.filters.every((f) => !f.authors || f.authors.includes(OTHER)))).toBe(true);
  });
  it('an invalid owner blocks the store (never falls back to home)', () => {
    ob.setBoardOwnerOverride('not-a-key');
    ob.setBoardsWorldWanted(true);
    expect(ob._ownerBoardsState().owner).toBe('');
    expect(ob._ownerBoardsState().subs).toBe(0);
  });
  it('null returns to this node\u2019s owner', () => {
    ob.setBoardOwnerOverride(OTHER);
    ob.setBoardOwnerOverride(null);
    ob.setBoardsWorldWanted(true);
    expect(ob._ownerBoardsState().owner).toBe(OWNER);
    expect(ob._ownerBoardsState().override).toBe(null);
  });
});

describe('wiring', () => {
  const rt = read('src/arenaRuntime.js');
  it('a starter-island world takes the engine island path', () => {
    expect(rt).toMatch(/if \(world\.base === 'starter-island'\) return _buildVisitedStarterIsland\(world, \{ worldId, arrival \}\);/);
    const i = rt.indexOf('async function _buildVisitedStarterIsland');
    const seg = rt.slice(i, rt.indexOf('async function travelToWorld', i));
    for (const re of [/plan = planFromWorld\(world\)\.plan/, /_minimal = false;/, /buildArena\(scene, plan\)/, /buildArenaColliders\(plan\)/,
      /setBoardOwnerOverride\(owner\)/, /if \(owner\) \{/, /cache: false/, /setNapNpcPresent\(false\)/, /resolveArrival\(world\)/]) expect(seg).toMatch(re);
  });
  it('data worlds clear the visit state; homecoming reloads or rebuilds', () => {
    expect(rt).toMatch(/_visitingStarter = false; _visitPlan = null;\n\s*try \{ setBoardOwnerOverride\(null\); \}/);
    expect(rt).toMatch(/if \(_homeWasLegacy && \(_minimal \|\| _visitingStarter\)\) \{/);
    expect(rt).toMatch(/if \(\(!_minimal && !_visitingStarter\) \|\| !_homeWorld\) return;/);
  });
  it('home-only paths stay off while visiting', () => {
    expect(rt).toMatch(/if \(!_visitingStarter\) _portalTrigger\.tick\(playerObj\.position\);/);
    expect(rt).toMatch(/_homeHas = \(id\) => homeIncludes\(_visitingStarter \? _visitPlan :/);
    expect(rt).toMatch(/if \(_gz && _combatHere\(\)\) _gz\.frame/);
    expect(rt).toMatch(/_combatHere = \(\) => !_visitingStarter \|\| !_visitPlan \|\| _visitPlan\.has\('game\.arena'\)/);
    expect(rt).toMatch(/disposeMirror\(\);[^\n]*\n\s*sweepLegacyArena\(scene\);/);
  });
  it('boards never read or write the home cache while visiting', () => {
    const mb = read('src/engine/plebeian/marketBoards3d.js');
    expect(mb).toMatch(/_saved = _useCache \? _loadSaved\(\) : null;/);
    expect(mb).toMatch(/if \(!_useCache \|\| !_saveDue/);
  });
  it('mirror frees its render target; hidden greeter loses its sensor', () => {
    expect(read('src/mirror.js')).toMatch(/export function disposeMirror\(\) \{[\s\S]*?m\.dispose\(\)/);
    expect(read('src/napNpc.js')).toMatch(/_npcColliderBody\.body\.setEnabled\(!!present\)/);
  });
  it('the server publishes the home components + configured owner', () => {
    const ws = read('server/arena-ws.js');
    expect(ws).toMatch(/homeComponents: _resolveHomeComponents\(\),/);
    expect(ws).toMatch(/if \(text\.length > HOME_WORLD_MAX_BYTES\) continue;/);
    expect(read('server/presence/beacon.js')).toMatch(/home: homeComponents, owner: configured \? admin : undefined/);
  });
});

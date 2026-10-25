// ADR-0147 Milestone 1 (v0.2.923): the home loads its own world description, and
// Starter Pack group 1 (island, sea, coastline) is built through components.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planFromWorld, homeIncludes, loadHomeWorld, BUNDLED_HOME_WORLD, HOME_WORLD_PATH, HOME_WORLD_MAX_BYTES, HOME_REQUIRED } from '../../src/engine/world/homeWorld.js';
import { STARTER_PACK_IDS, starterPackEntry } from '../../src/engine/components/starterPack.js';
import { createBuiltinRegistry } from '../../src/engine/components/registry.js';
import { createWorldIsland, createWorldSea, createWorldCoastline, STARTER_PACK_FACTORIES } from '../../src/engine/components/starterPackComponents.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const world = (components) => ({ version: 1, id: 'home', name: 'Home', components });
const ids = (arr) => arr.map((id) => ({ id }));

describe('home world description file', () => {
  const w = JSON.parse(read('worlds/home/world.json'));
  it('lists the full Starter Pack in catalogue order and plans cleanly', () => {
    expect(w.components.map((c) => c.id)).toEqual([...STARTER_PACK_IDS]);
    const r = planFromWorld(w);
    expect(r.source).toBe('file');
    expect(r.errors).toEqual([]);
    expect(r.plan.size).toBe(STARTER_PACK_IDS.length);
  });
  it('is tiny and served from the base-relative worlds path', () => {
    expect(read('worlds/home/world.json').length).toBeLessThan(HOME_WORLD_MAX_BYTES);
    expect(HOME_WORLD_PATH).toBe('worlds/home/world.json');
  });
});

describe('planFromWorld', () => {
  it('honours a list without sea/coastline', () => {
    const r = planFromWorld(world(ids(['world.island', 'nap.zone'])));
    expect(r.source).toBe('file');
    expect([...r.plan]).toEqual(['world.island', 'nap.zone']);
    expect(r.errors).toEqual([]);
  });
  it('reports unknown or id-less entries and ignores them', () => {
    const r = planFromWorld(world([{ id: 'world.island' }, { id: 'evil.thing' }, { config: {} }]));
    expect([...r.plan]).toEqual(['world.island']);
    expect(r.errors.join(' ')).toMatch(/unknown component evil\.thing/);
    expect(r.errors.join(' ')).toMatch(/missing id/);
  });
  it('puts the required ground back (a home never boots into the void)', () => {
    expect(HOME_REQUIRED).toContain('world.island');
    const r = planFromWorld(world([]));
    expect([...r.plan]).toEqual(['world.island']);
    expect(r.errors.join(' ')).toMatch(/required/);
  });
  it('falls back to the full pack for missing, invalid or list-less worlds', () => {
    for (const bad of [null, 'x', { version: 1, id: 'home', name: 'Home' }, { nope: true }]) {
      const r = planFromWorld(bad);
      expect(r.source).toBe('default');
      expect(r.plan.size).toBe(STARTER_PACK_IDS.length);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    const huge = planFromWorld(world(ids(Array(257).fill('world.sea'))));
    expect(huge.source).toBe('default');
    expect(huge.errors[0]).toMatch(/too many/);
  });
});

describe('homeIncludes', () => {
  it('null plan builds everything', () => {
    for (const id of STARTER_PACK_IDS) expect(homeIncludes(null, id)).toBe(true);
  });
  it('gates migrated pieces only; unmigrated pieces are always built', () => {
    const plan = new Set(['world.island']);
    expect(homeIncludes(plan, 'world.island')).toBe(true);
    expect(homeIncludes(plan, 'world.sea')).toBe(false);
    expect(homeIncludes(plan, 'world.coastline')).toBe(false);
    expect(homeIncludes(plan, 'arena.crates')).toBe(false);
    for (const id of STARTER_PACK_IDS) if (!starterPackEntry(id).builtIn) expect(homeIncludes(plan, id), id).toBe(true);
    expect(homeIncludes(plan, 'not.a.pack.piece')).toBe(true);
  });
});

describe('loadHomeWorld never throws', () => {
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  it('loads the file through the injected fetch at base + path', async () => {
    let seen = null;
    const r = await loadHomeWorld({ base: '/quest/', fetchImpl: async (u, o) => { seen = [u, o]; return res(200, JSON.stringify(world(ids(['world.island', 'world.sea'])))); } });
    expect(seen[0]).toBe('/quest/worlds/home/world.json');
    expect(seen[1]).toMatchObject({ credentials: 'same-origin' });
    expect(r.source).toBe('file');
    expect([...r.plan]).toEqual(['world.island', 'world.sea']);
  });
  it('404 (no operator override) → the bundled description, silently', async () => {
    const r = await loadHomeWorld({ fetchImpl: async () => res(404, '') });
    expect(r.source).toBe('bundled');
    expect(r.errors).toEqual([]);
    expect(r.plan.size).toBe(STARTER_PACK_IDS.length);
    expect(BUNDLED_HOME_WORLD.components.map((c) => c.id)).toEqual([...STARTER_PACK_IDS]);
  });
  it('a 404 with a trimmed bundled copy uses that copy', async () => {
    const r = await loadHomeWorld({ fetchImpl: async () => res(404, ''), fallback: world(ids(['world.island', 'world.sea'])) });
    expect(r.source).toBe('bundled');
    expect([...r.plan]).toEqual(['world.island', 'world.sea']);
  });
  it('an invalid bundled copy → the full pack (never nothing)', async () => {
    const r = await loadHomeWorld({ fetchImpl: async () => res(404, ''), fallback: null });
    expect(r.source).toBe('default');
    expect(r.plan.size).toBe(STARTER_PACK_IDS.length);
  });
  it('an operator file that is invalid falls back to bundled, with the reason', async () => {
    const r = await loadHomeWorld({ fetchImpl: async () => res(200, JSON.stringify({ nope: 1 })) });
    expect(r.source).toBe('bundled');
    expect(r.errors.length).toBe(1);
  });
  it('500, oversize, non-JSON, rejected fetch, no fetch → bundled with one reason', async () => {
    const cases = [
      { fetchImpl: async () => res(500, '') },
      { fetchImpl: async () => res(200, ' '.repeat(HOME_WORLD_MAX_BYTES + 1)) },
      { fetchImpl: async () => res(200, '{not json') },
      { fetchImpl: async () => { throw new Error('offline'); } },
      { fetchImpl: async () => null },
      {},
    ];
    for (const c of cases) {
      const r = await loadHomeWorld(c);
      expect(r.source).toBe('bundled');
      expect(r.plan.size).toBe(STARTER_PACK_IDS.length);
      expect(r.errors.length).toBe(1);
    }
  });
});

describe('group 1 host-backed components', () => {
  it('are registered and marked built in', () => {
    const reg = createBuiltinRegistry();
    for (const id of ['world.island', 'world.sea', 'world.coastline']) {
      expect(reg.load(id, {}).ok, id).toBe(true);
      expect(starterPackEntry(id).builtIn).toBe(true);
    }
    expect(STARTER_PACK_FACTORIES.slice(0, 3)).toEqual([createWorldIsland, createWorldSea, createWorldCoastline]);
  });
  it('mount calls the host builder; unmount runs its undo; no builder → false', () => {
    let built = 0, undone = 0;
    expect(createWorldSea().mount({}, {})).toBe(false);
    const c = createWorldSea();
    expect(c.mount({}, { hostBuilders: { 'world.sea': () => { built++; return () => { undone++; }; } } })).toBe(true);
    expect(built).toBe(1);
    c.unmount(); c.unmount();
    expect(undone).toBe(1);
  });
});

describe('wiring', () => {
  const arena = read('src/arena.js');
  const physics = read('src/physics.js');
  const rt = read('src/arenaRuntime.js');
  it('arena builds island, coastline, sea through components and gates crates', () => {
    expect(arena).toMatch(/_piece\('world\.island', scene, plan\);\n\s*_piece\('world\.coastline', scene, plan\);/);
    expect(arena).toMatch(/_piece\('world\.sea', scene, plan\);/);
    expect(arena).toMatch(/if \(homeIncludes\(plan, 'arena\.crates'\)\) _buildCrates\(scene\);/);
    expect(arena).toMatch(/export const ARENA_HOST_BUILDERS = Object\.freeze\(\{[\s\S]*'world\.island'[\s\S]*'world\.coastline'[\s\S]*'world\.sea'/);
    expect(arena).not.toMatch(/function _buildFloor\(/);
    // NAP ground mesh belongs to world.island now (built once, not in _buildNapZone too).
    expect(arena.match(/buildNapTerrainMesh\(scene\)/g).length).toBe(1);
  });
  it('physics gates ground, crates and shore wall by the same plan', () => {
    expect(physics).toMatch(/function _buildArenaStatics\(plan\) \{\n\s*if \(homeIncludes\(plan, 'world\.island'\)\) \{/);
    expect(physics).toMatch(/if \(homeIncludes\(plan, 'arena\.crates'\)\) for \(const \[cx, cz, hw, hd, ch\] of CRATES\)/);
    expect(physics).toMatch(/const rings = homeIncludes\(plan, 'world\.coastline'\) \? fenceRing\(\) : \[\];/);
  });
  it('runtime loads the home description before building, base-aware, and reuses it for colliders', () => {
    const i = rt.indexOf("_homePlan = await loadHomeWorld({ fetchImpl: (u, o) => fetch(u, o), base: assetUrl('') });");
    const j = rt.indexOf('_islandScene(_homePlan.plan, { home: true });');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(rt).toMatch(/_islandPhysics\(_homePlan \? _homePlan\.plan : null\)/);
    expect(rt).toMatch(/home: \(\) => \(_homePlan \? \{ source: _homePlan\.source/);
  });
});

describe('group 2: NAP Zone, tree, mirror, greeter (v0.2.925)', () => {
  const arena = read('src/arena.js');
  const physics = read('src/physics.js');
  const rt = read('src/arenaRuntime.js');
  const config = read('src/config.js');
  it('are registered host-backed components and marked built in', () => {
    const reg = createBuiltinRegistry();
    for (const id of ['nap.zone', 'nap.tree', 'nap.mirror', 'npc.greeter']) {
      expect(reg.load(id, {}).ok, id).toBe(true);
      expect(starterPackEntry(id).builtIn, id).toBe(true);
    }
  });
  it('arena builds the zone light and tree through components', () => {
    expect(arena).toMatch(/function _buildNapZone\(scene, plan = null\) \{[\s\S]*?_piece\('nap\.zone', scene, plan\);\n\s*_piece\('nap\.tree', scene, plan\);/);
    expect(arena).toMatch(/_buildNapZone\(scene, plan\);/);
    expect(arena).toMatch(/'nap\.zone': \(scene\) => \{ _buildNapZoneLight\(scene\); \}/);
    expect(arena).toMatch(/'nap\.tree': \(scene\) => \{ _buildNapTree\(NAP_TREE_X, NAP_TREE_Z, scene\); \}/);
    expect(arena.match(/_buildNapTree\(NAP_TREE_X, NAP_TREE_Z, scene\)/g).length).toBe(1);
  });
  it('the tree trunk collider follows nap.tree; one owner per obstacle', async () => {
    const { OBSTACLE_OWNERS } = await import('../../src/physics.js').catch(() => ({}));
    const owners = OBSTACLE_OWNERS || physics.match(/OBSTACLE_OWNERS = Object\.freeze\((\[[^\]]*\])\)/)[1];
    const rows = config.match(/export const OBSTACLES = \[([\s\S]*?)\n\];/)[1].split('\n').filter((l) => /^\s*\[/.test(l));
    const list = Array.isArray(owners) ? owners : JSON.parse(owners.replace(/'/g, '"'));
    expect(list.length).toBe(rows.length);
    expect(list[0]).toBe('nap.tree');
    expect(rows[0]).toMatch(/NAP_TREE_X/);
    expect(physics).toMatch(/if \(!homeIncludes\(plan, OBSTACLE_OWNERS\[i\]\)\) return;/);
  });
  it('runtime gates the mirror and the deferred greeter build by the home plan', () => {
    expect(rt).toMatch(/function _islandMirror\(plan\) \{ if \(homeIncludes\(plan, 'nap\.mirror'\)\) buildMirror\(\); \}/);
    expect(rt).toMatch(/if \(homeIncludes\(plan, 'npc\.greeter'\)\) \{ if \(getNpcRoot\(\)\) setNapNpcPresent\(true\); else buildNapNpc\(\); \}/);
    expect(rt).toMatch(/try \{ _islandNpc\(_homePlan \? _homePlan\.plan : null\); \}/);
    // the mirror's plan is loaded before it is built
    expect(rt.indexOf('_homePlan = await loadHomeWorld')).toBeLessThan(rt.indexOf('_islandMirror(_homePlan.plan);'));
    expect(rt).toMatch(/const _homeHas = \(id\) => homeIncludes\(_activePlan\(\), id\);/);
    expect(rt).toMatch(/const _activePlan = \(\) => \(_visitingStarter \? _visitPlan : \(_homePlan \? _homePlan\.plan : null\)\);/);
  });
  it('a trimmed plan leaves them out; unmigrated pieces still build', () => {
    const plan = new Set(['world.island']);
    for (const id of ['nap.zone', 'nap.tree', 'nap.mirror', 'npc.greeter']) expect(homeIncludes(plan, id)).toBe(false);
    expect(homeIncludes(plan, 'game.arena')).toBe(true);
  });
});

describe('group 3: signs + PRODUCT/AUCTION boards (v0.2.926)', () => {
  const arena = read('src/arena.js');
  const rt = read('src/arenaRuntime.js');
  const m3 = read('src/engine/plebeian/marketBoards3d.js');
  it('are registered and built in', () => {
    const reg = createBuiltinRegistry();
    for (const id of ['sign.board', 'market.products', 'market.auctions']) {
      expect(reg.load(id, {}).ok, id).toBe(true);
      expect(starterPackEntry(id).builtIn, id).toBe(true);
    }
  });
  it('signs are built through sign.board', () => {
    expect(arena).toMatch(/'sign\.board': \(scene\) => \{ buildProofSurfaceMeshes\(scene\); \}/);
    expect(arena).toMatch(/_piece\('sign\.board', scene, plan\);/);
    expect(arena.match(/buildProofSurfaceMeshes\(scene\)/g).length).toBe(1);
  });
  it('each board follows its own piece; prompts only for boards that exist', () => {
    expect(rt).toMatch(/products: homeIncludes\(plan, 'market\.products'\), auctions: homeIncludes\(plan, 'market\.auctions'\), cache: home \}\);/);
    expect(rt).toMatch(/if \(marketBoardHas\('products'\)\) _productPanelTrigger\.tick/);
    expect(rt).toMatch(/if \(marketBoardHas\('auctions'\)\) _auctionBoardTrigger\.tick/);
    expect(rt).toMatch(/\(marketBoardHas\('products'\) && _productPanelTrigger\.inRange\(\)\) \|\| \(marketBoardHas\('auctions'\) && _auctionBoardTrigger\.inRange\(\)\)/);
  });
  it('board module: neither → nothing; no AUCTION board → no bid sockets; null-safe everywhere', async () => {
    expect(m3).toMatch(/if \(!wantProducts && !wantAuctions\) return false;/);
    expect(m3).toMatch(/if \(!ids\.length \|\| !\(_boards && _boards\.auctions\)\) return;/);
    expect(m3).toMatch(/if \(b\.products && b\.products\.dirty\) _paint\('products'\);/);
    expect(m3).toMatch(/if \(b\.auctions && b\.auctions\.dirty\) _paint\('auctions'\);/);
    expect(m3).toMatch(/if \(_boards\.twin\) \{/);
    const mod = await import('../../src/engine/plebeian/marketBoards3d.js');
    expect(mod.initMarketBoards3d({ scene: {}, getBoard: () => null, products: false, auctions: false })).toBe(false);
    expect(mod.marketBoardHas('products')).toBe(false);
    expect(mod.marketBoardHas('auctions')).toBe(false);
    expect(mod.marketBoards3dState().boards).toEqual({ products: false, auctions: false });
    expect(() => mod.tickMarketBoards3d(0.016, null, true)).not.toThrow();
  });
});

describe('group 4: foliage, bridges, torii gate (v0.2.927)', () => {
  const arena = read('src/arena.js');
  const physics = read('src/physics.js');
  const rt = read('src/arenaRuntime.js');
  it('are registered and built in; gateway + arena game documented as always on', () => {
    const reg = createBuiltinRegistry();
    for (const id of ['world.foliage', 'world.bridge', 'torii.gate']) {
      expect(reg.load(id, {}).ok, id).toBe(true);
      expect(starterPackEntry(id).builtIn, id).toBe(true);
    }
    expect(starterPackEntry('torii.gateway').provides).toMatch(/always built/);
    expect(starterPackEntry('game.arena').builtIn).toBe(false);
    expect(starterPackEntry('game.arena').provides).toMatch(/server-authoritative/);
  });
  it('arena builds bridges + torii through components; the gateway always', () => {
    expect(arena).toMatch(/_piece\('world\.bridge', scene, plan\);\n\s*_piece\('torii\.gate', scene, plan\);/);
    expect(arena).toMatch(/\n  _buildTravelGateway\(scene\);\n/);
    expect(arena.match(/buildBridge\(scene\)/g).length).toBe(1);
    expect(arena.match(/_buildToriiGate\(scene\);/g).length).toBe(1);
  });
  it('bridge decks follow world.bridge; torii pillars follow torii.gate', () => {
    expect(physics).toMatch(/if \(!homeIncludes\(plan, 'world\.bridge'\)\) return;\n\s*\/\/ Bridge 1 deck/);
    expect(physics).toMatch(/OBSTACLE_OWNERS = Object\.freeze\(\['nap\.tree', 'torii\.gate', 'torii\.gate'\]\)/);
    const plan = new Set(['world.island']);
    expect(homeIncludes(plan, 'torii.gate')).toBe(false);
  });
  it('foliage build follows world.foliage', () => {
    expect(rt).toMatch(/if \(homeIncludes\(plan, 'world\.foliage'\)\) await buildFoliage\(onProgress\);/);
  });
  it('only the gateway and the arena game remain always-on', async () => {
    const { starterPackProgress } = await import('../../src/engine/components/starterPack.js');
    expect(starterPackProgress().remaining).toEqual(['game.arena']);
  });
});

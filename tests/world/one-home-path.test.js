// v0.2.932 (ADR-0147 M1.5): the classic home path is retired. The island home is
// a `base: 'starter-island'` world from its description, built by the SAME helpers
// as a visit, and homecoming rebuilds it in place. Combat follows game.arena.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { starterIslandWorld, planFromWorld, loadHomeWorld, BUNDLED_HOME_WORLD } from '../../src/engine/world/homeWorld.js';
import { validateWorld } from '../../src/engine/world/worldSchema.js';
import { STARTER_PACK } from '../../src/engine/components/starterPack.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('the home is a world', () => {
  it('the bundled description says base: starter-island and lists the full pack', () => {
    expect(BUNDLED_HOME_WORLD.base).toBe('starter-island');
    expect(BUNDLED_HOME_WORLD.components.map((c) => c.id).sort()).toEqual(STARTER_PACK.map((c) => c.id).sort());
  });
  it('starterIslandWorld builds a valid starter-island world from a plan', () => {
    const w = starterIslandWorld(new Set(['world.island', 'world.sea']), { grassColor: undefined });
    const v = validateWorld(w);
    expect(v.ok).toBe(true);
    expect(v.world.base).toBe('starter-island');
    expect(v.world.components.map((c) => c.id)).toEqual(['world.island', 'world.sea']);
    expect(starterIslandWorld(null).components.length).toBe(STARTER_PACK.length);
  });
  it('planFromWorld returns the world for a file, the full pack, and a bad file', () => {
    const r = planFromWorld({ version: 1, id: 'home', name: 'H', components: [{ id: 'world.island' }, { id: 'nap.zone' }] });
    expect(r.source).toBe('file');
    expect(r.world.base).toBe('starter-island'); // a description without base is still an island
    expect(r.world.components.map((c) => c.id).sort()).toEqual(['nap.zone', 'world.island']);
    for (const bad of [null, { id: 'x' }, { version: 1, id: 'h', name: 'H' }]) {
      const d = planFromWorld(bad);
      expect(d.source).toBe('default');
      expect(d.world.components.length).toBe(STARTER_PACK.length);
    }
  });
  it('loadHomeWorld hands back the world on every path', async () => {
    const ok = await loadHomeWorld({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: 1, id: 'home', name: 'H', components: [{ id: 'world.island' }] }) }), base: '/' });
    expect(ok.source).toBe('file');
    expect(ok.world.components.map((c) => c.id)).toEqual(['world.island']);
    const miss = await loadHomeWorld({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }), base: '/' });
    expect(miss.source).toBe('bundled');
    expect(miss.world.base).toBe('starter-island');
  });
});

describe('one island builder for boot, visits and homecoming', () => {
  const rt = read('src/arenaRuntime.js');
  const boot = rt.slice(rt.indexOf('_homePlan = await loadHomeWorld'), rt.indexOf('function _islandBoards('));
  const builder = rt.slice(rt.indexOf('async function _buildStarterIsland('), rt.indexOf('async function travelToWorld('));
  it('boot runs the shared helpers', () => {
    for (const s of ['_islandScene(_homePlan.plan, { home: true });', '_islandMirror(_homePlan.plan);', 'await _islandFoliage(_homePlan.plan,', "_islandPhysics(_homePlan ? _homePlan.plan : null)", '_islandNpc(_homePlan ? _homePlan.plan : null)', 'if (!_minimal) _islandPortal();']) {
      expect(rt).toContain(s);
    }
    expect(boot).not.toMatch(/buildArena\(undefined/);
  });
  it('travel + homecoming run the same helpers', () => {
    for (const s of ['_islandScene(plan, { home, owner })', '_islandPhysics(plan)', 'await _islandFoliage(plan)', '_islandMirror(plan)', '_islandNpc(plan)', 'if (home) { try { _islandPortal(); }']) {
      expect(builder).toContain(s);
    }
    expect(builder).toMatch(/if \(home\) plan = _homePlan \? _homePlan\.plan : null;/);
    expect(builder).toMatch(/_visitingStarter = !home;/);
  });
  it('the island home is captured as a world; homecoming never reloads', () => {
    expect(rt).toContain('_homeWorld = _homePlan.world || starterIslandWorld(_homePlan.plan);');
    expect(rt).not.toMatch(/_homeWasLegacy/);
    expect(rt).toMatch(/let _atHome = false;/);
    const restore = rt.slice(rt.indexOf('async function _restoreHomeWorld()'), rt.indexOf('async function enter()'));
    expect(restore).not.toMatch(/location\.reload/);
  });
  it('leaving the island removes the market portal too', () => {
    const td = rt.slice(rt.indexOf('function _teardownStarterIsland() {'), rt.indexOf('sweepLegacyArena(scene);', rt.indexOf('function _teardownStarterIsland() {')));
    expect(td).toMatch(/disposePortalMesh\(\);/);
  });
  it('parity fixes: signboards rebuild, the data-world platform goes', () => {
    const ps = read('src/engine/world/proofSurfaceMeshes.js');
    expect(ps).toMatch(/export function disposeProofSurfaceMeshes\(scene = null\) \{/);
    expect(ps).toMatch(/_boards\.clear\(\);/);
    expect(ps).toMatch(/reasons: \['disposed'\]/); // the next build renders again (rendered:false)
    const rb = rt.slice(rt.indexOf('async function _rebuildWorldInPlace('), rt.indexOf("if (world.base === 'starter-island') return _buildStarterIsland"));
    expect(rb).toMatch(/_removePlatformCollider\(\);/);
    expect(rt).toMatch(/function _removePlatformCollider\(\) \{\n\s*if \(!_platformBody\) return false;/);
  });
  it('the debug seam can come home and report state', () => {
    expect(rt).toMatch(/goHome: async \(\) => \{ const was = _atHome; await returnHome\(\);/);
    expect(rt).toMatch(/inventory: \(\) => \{/);
  });
});

describe('game.arena follows the description', () => {
  const rt = read('src/arenaRuntime.js');
  const ws = read('server/arena-ws.js');
  it('client: no game.arena → no bot sim and no shots', () => {
    expect(rt).toMatch(/if \(_gz && _combatHere\(\)\) _gz\.frame/);
    expect(rt).toMatch(/if \(!_combatHere\(\)\) return;\n\s*\/\/ Arena: the Game Zone recoil/);
  });
  it('server: the game zone runs only when the home description includes game.arena', () => {
    expect(ws).toMatch(/const GAME_ARENA_IN_HOME = HOME_COMPONENTS\.includes\('game\.arena'\);/);
    expect(ws).toMatch(/const gameZone = \(GAMEZONE_ENABLED && GAME_ARENA_IN_HOME\) \? createGameZoneServer\(\{/);
    expect(ws).toMatch(/gamezone=\$\{gameZone \? 'v2' : 'off'\}/);
    expect(ws.indexOf('const HOME_COMPONENTS = _resolveHomeComponents();')).toBeLessThan(ws.indexOf('const GAME_ARENA_IN_HOME'));
  });
});

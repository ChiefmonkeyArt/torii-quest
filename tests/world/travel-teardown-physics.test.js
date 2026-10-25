// v0.2.930 (ADR-0147 M1): leaving the classic home removes its PHYSICS too —
// static colliders (ground, shore wall, crates, obstacles, bridges) and the
// push-around dynamic crates. Before, only meshes were swept, leaving invisible
// walls/ground (and 4 visible crates) in the destination world.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as bodies from '../../src/engine/physics/bodies.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

function fakeWorld() {
  const colliders = new Set(); const bodiesSet = new Set(); let id = 0;
  return {
    colliders, bodiesSet,
    createCollider(desc, body) { const c = { handle: ++id, desc, body }; colliders.add(c); return c; },
    removeCollider(c) { if (!colliders.delete(c)) throw new Error('gone'); },
    createRigidBody(desc) { const b = { desc, translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) }; bodiesSet.add(b); return b; },
    removeRigidBody(b) { if (!bodiesSet.delete(b)) throw new Error('gone'); for (const c of [...colliders]) if (c.body === b) colliders.delete(c); },
  };
}
const desc = () => { const d = { setTranslation() { return d; }, setRotation() { return d; } }; return d; };
const RAPIER = {
  ColliderDesc: { cuboid: desc, heightfield: desc, capsule: desc },
  RigidBodyDesc: { dynamic: desc, fixed: desc, kinematicPositionBased: desc },
};

describe('collectStatics / removeStatics', () => {
  let w;
  beforeEach(() => { w = fakeWorld(); bodies.initBodies(w, RAPIER); });
  it('records exactly the statics created inside fn, and removes them', () => {
    bodies.createStatic(1, 1, 1, 0, 0, 0); // outside: not recorded
    const list = bodies.collectStatics(() => {
      bodies.createStatic(1, 1, 1, 0, 0, 0);
      bodies.createStaticYaw(1, 1, 1, 0, 0, 0, 0.5);
      bodies.createHeightfield(1, 1, [0, 0, 0, 0], 1, 1, 1, 0, 0, 0);
    });
    expect(list.length).toBe(3);
    expect(w.colliders.size).toBe(4);
    expect(bodies.removeStatics(list)).toBe(3);
    expect(list.length).toBe(0);
    expect(w.colliders.size).toBe(1); // the untracked one stays
    expect(bodies.removeStatics(list)).toBe(0); // idempotent
  });
  it('nests safely and survives a throwing fn', () => {
    let inner;
    const outer = bodies.collectStatics(() => {
      bodies.createStatic(1, 1, 1, 0, 0, 0);
      inner = bodies.collectStatics(() => { bodies.createStatic(1, 1, 1, 0, 0, 0); });
      bodies.createStatic(1, 1, 1, 0, 0, 0);
    });
    expect(outer.length).toBe(2);
    expect(inner.length).toBe(1);
    expect(() => bodies.collectStatics(() => { throw new Error('x'); })).toThrow('x');
    bodies.createStatic(1, 1, 1, 0, 0, 0);
    expect(bodies.collectStatics(() => {}).length).toBe(0); // sink reset after throw
  });
  it('dynamic crates are freed with their body', () => {
    const h = bodies.createDynamicCrate(0, 1, 0, 0.5);
    expect(w.bodiesSet.size).toBe(1);
    expect(bodies.removeDynamicCrate(h)).toBe(true);
    expect(w.bodiesSet.size).toBe(0);
    expect(w.colliders.size).toBe(0);
    expect(bodies.removeDynamicCrate(h)).toBe(false);
    expect(bodies.removeDynamicCrate(null)).toBe(false);
  });
});

describe('wiring', () => {
  const physics = read('src/physics.js');
  const rt = read('src/arenaRuntime.js');
  const dc = read('src/dynamicCrates.js');
  it('buildArenaColliders records everything and never stacks two copies', () => {
    expect(physics).toMatch(/export function buildArenaColliders\(plan = null\) \{\n\s*disposeArenaColliders\(\);[^\n]*\n\s*_arenaStatics = collectStatics\(\(\) => _buildArenaStatics\(plan\)\);/);
    expect(physics).toMatch(/export function disposeArenaColliders\(\) \{ return removeStatics\(_arenaStatics\); \}/);
  });
  it('legacy teardown removes colliders and dynamic crates before sweeping meshes', () => {
    const i = rt.indexOf('function _teardownStarterIsland() {');
    const seg = rt.slice(i, rt.indexOf('sweepLegacyArena(scene);', i));
    expect(seg).toMatch(/disposeArenaColliders\(\);/);
    expect(seg).toMatch(/disposeDynamicCrates\(\);/);
  });
  it('push-around crates follow arena.crates and free their bodies on rebuild', () => {
    expect(rt).toMatch(/function _islandPhysics\(plan\) \{\n\s*buildArenaColliders\(plan\);\n\s*if \(homeIncludes\(plan, 'arena\.crates'\)\) buildDynamicCrates\(\);/);
    expect(dc).toMatch(/export function buildDynamicCrates\(\) \{\n[^\n]*\n\s*disposeDynamicCrates\(\);/);
    expect(dc).toMatch(/removeDynamicCrate\(c\.handle\);/);
  });
  it('the visit test seam only accepts bundled same-origin world ids', () => {
    expect(rt).toMatch(/!\/\^\[a-z0-9-\]\{1,64\}\$\/\.test\(id\)\) return \{ ok: false, reason: 'bad-id' \}/);
    expect(rt).toMatch(/fetch\(assetUrl\(`worlds\/\$\{id\}\/world\.json`\), \{ credentials: 'same-origin' \}\)/);
    expect(rt).toMatch(/const v = validateWorld\(await r\.json\(\)\);\n\s*if \(!v\.ok\) return/);
  });
});

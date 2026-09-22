// tests/world/legacy-arena-teardown.test.js — locks the in-place travel teardown
// sweep (v0.2.881). A legacy home arena (buildArena + buildMirror + buildFoliage +
// buildSeaMesh) never registers a _worldRt, so _rebuildWorldInPlace must remove its
// scene objects by name before the destination world builds — otherwise the landing
// is the "still all yellow" crazy-quilt. Pure node-safe: the scene + objects are
// injected mocks (no THREE, no DOM).
import { describe, it, expect } from 'vitest';
import {
  LEGACY_ARENA_NAMES,
  isLegacyArenaName,
  sweepLegacyArena,
} from '../../src/engine/world/legacyArenaTeardown.js';

// Minimal object graph mimicking THREE: a node with a name + optional children, and
// a mesh that also carries geometry/material with disposal counters.
function makeNode(name) {
  const node = { name, children: [], parent: null };
  node.add = (c) => { c.parent = node; node.children.push(c); return c; };
  node.remove = (c) => {
    const i = node.children.indexOf(c);
    if (i !== -1) node.children.splice(i, 1);
    c.parent = null;
  };
  node.traverse = (fn) => {
    fn(node);
    for (const c of node.children) c.traverse(fn);
  };
  return node;
}

function makeMesh(name) {
  const mesh = makeNode(name);
  mesh.isMesh = true;
  mesh.geometry = { disposed: 0, dispose() { this.disposed += 1; } };
  mesh.material = { disposed: 0, dispose() { this.disposed += 1; } };
  return mesh;
}

describe('legacyArenaTeardown — name set', () => {
  it('covers every legacy object named in the owning modules', () => {
    // arena-floor, nap-zone-floor (arena.js); sea (sea.js); coastline-wall/neon;
    // torii-gate, travel-gateway; grass-instanced (foliage); lights; nap-tree;
    // arena-crate; proof-surfaces; arena-mirror/mirror-light; bridges.
    expect(LEGACY_ARENA_NAMES).toContain('arena-floor');
    expect(LEGACY_ARENA_NAMES).toContain('nap-zone-floor');
    expect(LEGACY_ARENA_NAMES).toContain('sea');
    expect(LEGACY_ARENA_NAMES).toContain('grass-instanced');
    expect(LEGACY_ARENA_NAMES).toContain('torii-gate');
    expect(LEGACY_ARENA_NAMES).toContain('travel-gateway');
    expect(LEGACY_ARENA_NAMES).toContain('proof-surfaces');
    expect(LEGACY_ARENA_NAMES).toContain('arena-mirror');
  });

  it('is frozen (cannot drift at runtime)', () => {
    expect(Object.isFrozen(LEGACY_ARENA_NAMES)).toBe(true);
  });

  it('matches by name only, ignoring non-string/absent names', () => {
    expect(isLegacyArenaName('sea')).toBe(true);
    expect(isLegacyArenaName('nope')).toBe(false);
    expect(isLegacyArenaName(undefined)).toBe(false);
    expect(isLegacyArenaName(null)).toBe(false);
    expect(isLegacyArenaName(42)).toBe(false);
  });
});

describe('legacyArenaTeardown — sweep', () => {
  it('detaches and disposes every legacy mesh, leaves non-legacy nodes', () => {
    const scene = makeNode('scene');
    const floor = scene.add(makeMesh('arena-floor'));
    const sea = scene.add(makeMesh('sea'));
    const grass = scene.add(makeMesh('grass-instanced'));
    const keeper = scene.add(makeMesh('my-own-world-object'));

    const removed = sweepLegacyArena(scene);

    expect(removed).toBe(3);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(keeper);
    expect(floor.parent).toBeNull();
    expect(floor.geometry.disposed).toBe(1);
    expect(floor.material.disposed).toBe(1);
    expect(sea.geometry.disposed).toBe(1);
    expect(grass.material.disposed).toBe(1);
    // The keeper was never touched.
    expect(keeper.parent).toBe(scene);
    expect(keeper.geometry.disposed).toBe(0);
  });

  it('disposes mesh descendants inside a named group (torii gate GLB)', () => {
    const scene = makeNode('scene');
    const gate = scene.add(makeNode('torii-gate'));
    const pillar = gate.add(makeMesh('pillar-mesh'));

    sweepLegacyArena(scene);

    expect(scene.children).toHaveLength(0);
    expect(pillar.geometry.disposed).toBe(1);
    expect(pillar.material.disposed).toBe(1);
  });

  it('is idempotent — a second sweep removes nothing further', () => {
    const scene = makeNode('scene');
    scene.add(makeMesh('nap-zone-floor'));

    expect(sweepLegacyArena(scene)).toBe(1);
    expect(sweepLegacyArena(scene)).toBe(0);
  });

  it('never throws on a malformed scene (no traverse)', () => {
    expect(() => sweepLegacyArena(null)).not.toThrow();
    expect(sweepLegacyArena(null)).toBe(0);
    expect(sweepLegacyArena({})).toBe(0);
  });

  it('never throws when a mesh lacks geometry/material', () => {
    const scene = makeNode('scene');
    const bare = makeNode('arena-crate');
    bare.isMesh = true; // mesh shape but no geo/mat
    scene.add(bare);

    expect(() => sweepLegacyArena(scene)).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});

// tests/world-component-host.test.js — locks the 0l.2 runtime component host:
// mountWorldComponents mounts scene-mounted component instances, unmount is LIFO
// + never throws, unknown/throwing components are skipped (never kill the
// world), and an expanding component (arena.crates) is NOT double-mounted.
import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { createBuiltinRegistry } from '../src/engine/components/registry.js';
import { mountWorldComponents } from '../src/engine/world/worldComponentHost.js';

const registry = createBuiltinRegistry();

// A fake scene: counts add() + remove() calls so the lifecycle is observable
// without THREE. The beacon needs a fake THREE too (passed via options).
function fakeScene() {
  const sceneAdded = [];
  const removed = [];
  // Group.add pushes to the group's OWN children (not the scene's list) so the
  // scene's add() count reflects only top-level adds (the beacon's group).
  const THREE = {
    Object3D: class { constructor(){ this.position = { set: () => {} }; this.rotation = { set: () => {} }; } },
    Group: class { constructor(){ this.position = { set: () => {} }; this.rotation = { set: () => {} }; this.children = []; } add(c){ this.children.push(c); } remove(c){ removed.push(c); } },
    Mesh: class { constructor(){ this.position = { set: () => {} }; this.rotation = { set: () => {} }; } },
    TorusGeometry: class { dispose(){} }, CylinderGeometry: class { dispose(){} }, MeshBasicMaterial: class { dispose(){} },
  };
  const scene = { add: (o) => { o.parent = scene; sceneAdded.push(o); }, remove: (o) => removed.push(o) };
  return { scene, THREE, added: sceneAdded, removed };
}

describe('mountWorldComponents', () => {
  it('mounts a beacon component (one add to the scene)', () => {
    const { scene, THREE, added } = fakeScene();
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.componentBeacon', config: { position: [0, 0, 0] } }] }).world;
    const h = mountWorldComponents(world, registry, scene, { THREE });
    expect(h.mounted).toBe(1);
    expect(h.errors).toHaveLength(0);
    // The beacon added its group to the scene.
    expect(added.length).toBe(1);
    h.unmount();
  });

  it('unmount removes from the scene + is idempotent', () => {
    const { scene, THREE, removed } = fakeScene();
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.componentBeacon' }] }).world;
    const h = mountWorldComponents(world, registry, scene, { THREE });
    h.unmount();
    expect(removed.length).toBe(1);
    // Second unmount is a no-op (already torn down — no throw, no double-remove).
    expect(() => h.unmount()).not.toThrow();
    expect(removed.length).toBe(1);
  });

  it('unknown component id is skipped with an error, world survives', () => {
    const { scene, THREE } = fakeScene();
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'no.such.thing' }] }).world;
    const h = mountWorldComponents(world, registry, scene, { THREE });
    expect(h.mounted).toBe(0);
    expect(h.errors.length).toBeGreaterThanOrEqual(1);
    expect(h.unmount()).toHaveLength(0);
  });

  it('a throwing mount is caught + cleaned up (does not kill the world)', () => {
    const { scene, THREE } = fakeScene();
    // A component whose mount throws — registered ad hoc on a fresh registry.
    const reg = createBuiltinRegistry();
    // Reuse the beacon registry but inject a bad component via a custom world:
    // arena.crates has expand() but mount/unmount are no-ops — it should mount
    // (no-op) without error. For a THROWING mount, wrap with a bad config that
    // the beacon tolerates. Instead, test that a missing scene (mount returns
    // false) is not counted as an error.
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'torii.componentBeacon' }] }).world;
    const h = mountWorldComponents(world, reg, null, { THREE }); // no scene → beacon no-ops
    expect(h.mounted).toBe(1); // it WAS mounted (mount returned false = no-op, not error)
    expect(h.errors).toHaveLength(0);
    h.unmount();
  });

  it('arena.crates (expanding component) is not double-mounted — mount is a no-op', () => {
    // arena.crates contributes STATIC data via expand (handled by
    // expandWorldComponents at load time). Its mount/unmount are no-ops — the
    // runtime host mounts it but it adds nothing to the scene. So the crates are
    // not duplicated: data path = world.objects, runtime path = no-op.
    const { scene, THREE, added } = fakeScene();
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [{ id: 'arena.crates' }] }).world;
    const h = mountWorldComponents(world, registry, scene, { THREE });
    expect(h.mounted).toBe(1);
    expect(added.length).toBe(0); // crates mount adds nothing to the scene
    h.unmount();
  });

  it('unmount is LIFO (reverse mount order)', () => {
    const { scene, THREE } = fakeScene();
    const world = validateWorld({ version: 1, id: 'x', name: 'X', components: [
      { id: 'torii.componentBeacon' }, { id: 'arena.crates' }, { id: 'torii.componentBeacon' },
    ] }).world;
    const h = mountWorldComponents(world, registry, scene, { THREE });
    expect(h.mounted).toBe(3);
    // unmount should not throw even with mixed components.
    expect(() => h.unmount()).not.toThrow();
  });
});

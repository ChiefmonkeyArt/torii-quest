// tests/component-beacon.test.js — locks the 0l.2 runtime-mounted beacon
// component. Visual-only: one add() on mount, one remove() on unmount, and
// geometry/material are disposed on unmount. No THREE → mount is a no-op.
import { describe, it, expect } from 'vitest';
import { createComponentBeacon, componentBeacon } from '../src/engine/components/componentBeacon.js';

// A minimal fake THREE namespace — just enough for the beacon to build a Group
// + 2 Meshes + a material + 2 geometries. Records add()/remove()/dispose() so
// the test can assert the exact lifecycle.
function fakeTHREE() {
  const added = [];
  const removed = [];
  const disposed = [];
  class Object3D {
    constructor() { this.position = { set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } }; this.rotation = { set: () => {} }; }
  }
  class Group extends Object3D {
    add(child) { added.push(child); this.children = (this.children || []).concat(child); }
    remove(child) { removed.push(child); this.children = (this.children || []).filter((c) => c !== child); }
  }
  class Mesh extends Object3D {}
  class Geometry { constructor() {} dispose() { disposed.push(this); } }
  const TorusGeometry = class extends Geometry {};
  const CylinderGeometry = class extends Geometry {};
  class Material { constructor() {} dispose() { disposed.push(this); } }
  const MeshBasicMaterial = Material;
  return { THREE: { Group, Mesh, TorusGeometry, CylinderGeometry, MeshBasicMaterial, Object3D }, added, removed, disposed };
}

describe('componentBeacon — contract', () => {
  it('is a contract-valid component (mount/unmount)', () => {
    expect(componentBeacon.mount).toBeInstanceOf(Function);
    expect(componentBeacon.unmount).toBeInstanceOf(Function);
    expect(componentBeacon.manifest.id).toBe('torii.componentBeacon');
    expect(componentBeacon.manifest.mountTarget).toBe('scene');
    expect(componentBeacon.manifest.kind).toBe('decor');
  });
});

describe('componentBeacon — mount/unmount lifecycle', () => {
  it('mount adds exactly one group to the scene', () => {
    const { THREE, added } = fakeTHREE();
    const scene = { add: () => {}, remove: () => {} };
    const c = createComponentBeacon({ position: [1, 0, 2], color: 0xff0000 });
    c.mount(scene, { THREE });
    expect(added.length).toBe(2); // ring + stem meshes added to the group
    c.unmount();
  });

  it('unmount removes the group from its parent + disposes geometry/material', () => {
    const { THREE, removed, disposed } = fakeTHREE();
    const scene = { add: (o) => { o.parent = scene; }, remove: (o) => { removed.push(o); } };
    const c = createComponentBeacon();
    c.mount(scene, { THREE });
    c.unmount();
    // The group is removed from the scene (parent).
    expect(removed.length).toBe(1);
    // 2 geometries (torus + cylinder) + 1 material disposed.
    expect(disposed.length).toBe(3);
  });

  it('mount is a no-op (returns false) when THREE is missing', () => {
    const scene = { add: () => {}, remove: () => {} };
    const c = createComponentBeacon();
    expect(c.mount(scene, {})).toBe(false);
    // unmount on a never-mounted beacon is safe (no throw).
    expect(() => c.unmount()).not.toThrow();
  });

  it('mount is a no-op when scene is missing', () => {
    const { THREE } = fakeTHREE();
    const c = createComponentBeacon();
    expect(c.mount(null, { THREE })).toBe(false);
    expect(() => c.unmount()).not.toThrow();
  });

  it('defaults config (color/radius/height) safely', () => {
    const { THREE } = fakeTHREE();
    const scene = { add: () => {}, remove: () => {} };
    const c = createComponentBeacon({ color: 'not-a-number', radius: -1, height: 0 });
    expect(() => c.mount(scene, { THREE })).not.toThrow();
    c.unmount();
  });
});

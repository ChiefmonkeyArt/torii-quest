// tests/world-objects-visible.test.js — locks the Phase 0k.3 `visible` field:
// collision-only objects (legacy torii pillars, coastline wall) skip the visual
// mesh in worldObjectsRenderer but keep their collider in buildWorldObjectColliders.
// Mirrors the co-located renderer test (real three in node) + collider test
// (fake Rapier) patterns.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { buildWorldObjects } from '../src/engine/world/worldObjectsRenderer.js';
import { buildWorldObjectColliders } from '../src/engine/world/worldObjectColliders.js';

function fakeLoadGltfOk() {
  return () => Promise.resolve({ scene: new THREE.Group() });
}

// Fake Rapier (mirrors worldObjectColliders.test.js).
function makeFakeRapier() {
  const colliderDescs = [];
  const createdColliders = [];
  const RigidBodyDesc = {
    fixed() {
      const d = { _tx: 0, _ty: 0, _tz: 0, setTranslation(x, y, z) { this._tx = x; this._ty = y; this._tz = z; return this; } };
      return d;
    },
  };
  const ColliderDesc = {
    cuboid(hx, hy, hz) {
      const d = { kind: 'cuboid', hx, hy, hz, _rot: null, _sensor: false, setRotation(q) { this._rot = q; return this; }, setSensor(v) { this._sensor = v; return this; } };
      colliderDescs.push(d);
      return d;
    },
  };
  const physicsWorld = {
    createRigidBody(d) { return { handle: 0, _desc: d }; },
    createCollider(d, rb) { const c = { handle: createdColliders.length, _desc: d }; createdColliders.push(c); return c; },
    removeCollider() {}, removeRigidBody() {},
  };
  return { physicsWorld, Rapier: { RigidBodyDesc, ColliderDesc }, colliderDescs, createdColliders };
}

describe('worldSchema — visible field', () => {
  it('preserves visible === false on a validated object', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [0, 0, 0], visible: false, collider: { shape: 'box', size: [1, 1, 1] } }],
    });
    expect(v.ok).toBe(true);
    expect(v.world.objects[0].visible).toBe(false);
  });

  it('omits visible when true or non-boolean (object stays visible by default)', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [
        { type: 'box', position: [0, 0, 0], visible: true },
        { type: 'box', position: [1, 0, 0], visible: 'no' },
      ],
    });
    expect(v.ok).toBe(true);
    expect(v.world.objects[0].visible).toBeUndefined();
    expect(v.world.objects[1].visible).toBeUndefined();
  });
});

describe('buildWorldObjects — visible:false skips the mesh', () => {
  it('adds no mesh for a visible:false box (collision-only)', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [
        { type: 'box', position: [0, 0, 0], visible: false, collider: { shape: 'box', size: [1, 1, 1] } },
        { type: 'box', position: [1, 0, 0] }, // visible (default)
      ],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const meshes = scene.children.filter((c) => c.isMesh);
    expect(meshes.length).toBe(1); // only the visible box
  });
});

describe('buildWorldObjectColliders — visible:false still builds the collider', () => {
  it('creates a cuboid collider for a visible:false box', () => {
    const f = makeFakeRapier();
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [2, 1, 3], visible: false, collider: { shape: 'box', size: [0.8, 3.38, 0.8] } }],
    });
    expect(v.ok).toBe(true);
    const r = buildWorldObjectColliders(v.world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(1);
    expect(f.colliderDescs[0].kind).toBe('cuboid');
    expect(f.colliderDescs[0].hx).toBeCloseTo(0.4, 5); // 0.8/2
    expect(f.colliderDescs[0].hz).toBeCloseTo(0.4, 5);
  });
});

// src/engine/world/worldObjectColliders.test.js — locks the Phase 0i per-object
// collider builder. Pure vitest with a FAKE Rapier: the build takes injected
// { physicsWorld, Rapier } deps (mirrors _addPlatformCollider), so no real WASM
// is loaded. No three/DOM — importable in the node env.
import { describe, it, expect } from 'vitest';
import { buildWorldObjectColliders } from './worldObjectColliders.js';

// ── Fake Rapier fixture ──────────────────────────────────────────────────────
// Mirrors the Rapier surface the builder touches: RigidBodyDesc.fixed().setTranslation
// + ColliderDesc.cuboid/cylinder + desc.setRotation/setSensor. Records every call
// so tests can assert half-extents, position, yaw rotation, + sensor flag.
function makeFakeRapier() {
  const createdColliders = [];
  const createdBodies = [];
  const colliderDescs = [];
  const bodyDescs = [];

  const RigidBodyDesc = {
    fixed() {
      const desc = {
        _tx: 0, _ty: 0, _tz: 0,
        setTranslation(x, y, z) { this._tx = x; this._ty = y; this._tz = z; return this; },
      };
      bodyDescs.push(desc);
      return desc;
    },
  };

  const ColliderDesc = {
    cuboid(hx, hy, hz) {
      const desc = {
        kind: 'cuboid', hx, hy, hz,
        _rot: null, _sensor: false,
        setRotation(q) { this._rot = q; return this; },
        setSensor(v) { this._sensor = v; return this; },
      };
      colliderDescs.push(desc);
      return desc;
    },
    cylinder(halfHeight, radius) {
      const desc = {
        kind: 'cylinder', halfHeight, radius,
        _rot: null, _sensor: false,
        setRotation(q) { this._rot = q; return this; },
        setSensor(v) { this._sensor = v; return this; },
      };
      colliderDescs.push(desc);
      return desc;
    },
  };

  const physicsWorld = {
    createRigidBody(desc) {
      const rb = { handle: createdBodies.length, _desc: desc };
      createdBodies.push(rb);
      return rb;
    },
    createCollider(desc, rb) {
      const c = { handle: createdColliders.length, _desc: desc, _rb: rb };
      createdColliders.push(c);
      return c;
    },
    removedColliders: [],
    removedBodies: [],
    removeCollider(c, flag) { this.removedColliders.push(c); },
    removeRigidBody(rb) { this.removedBodies.push(rb); },
  };

  const Rapier = { RigidBodyDesc, ColliderDesc };
  return { physicsWorld, Rapier, createdColliders, createdBodies, colliderDescs, bodyDescs };
}

describe('buildWorldObjectColliders — box collider', () => {
  it('creates a cuboid desc with half-extents = size/2 at position+offset', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{
        type: 'box', position: [10, 2, -3],
        collider: { shape: 'box', size: [4, 6, 8], offset: [1, 0, 1], sensor: false },
      }],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(1);
    expect(r.bodies).toHaveLength(1);
    const desc = f.colliderDescs[0];
    expect(desc.kind).toBe('cuboid');
    expect(desc.hx).toBe(2); // 4/2
    expect(desc.hy).toBe(3); // 6/2
    expect(desc.hz).toBe(4); // 8/2
    // rigid body translation = position + offset
    expect(f.bodyDescs[0]._tx).toBe(11); // 10 + 1
    expect(f.bodyDescs[0]._ty).toBe(2);  // 2 + 0
    expect(f.bodyDescs[0]._tz).toBe(-2); // -3 + 1
  });

  it('applies object yaw rotation via desc.setRotation', () => {
    const f = makeFakeRapier();
    const yaw = 0.6;
    const world = {
      objects: [{
        type: 'box', position: [0, 0, 0], rotation: [0, yaw, 0],
        collider: { shape: 'box', size: [2, 2, 2] },
      }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    const desc = f.colliderDescs[0];
    expect(desc._rot).not.toBeNull();
    // quaternion for yaw about Y: {x:0, y:sin(yaw/2), z:0, w:cos(yaw/2)}
    const s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
    expect(desc._rot).toEqual({ x: 0, y: s, z: 0, w: c });
  });

  it('does not apply rotation when object has no rotation field', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{ type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [2, 2, 2] } }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(f.colliderDescs[0]._rot).toBeNull();
  });

  it('defaults offset to [0,0,0] when omitted', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{ type: 'box', position: [5, 1, 2], collider: { shape: 'box', size: [2, 2, 2] } }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(f.bodyDescs[0]._tx).toBe(5);
    expect(f.bodyDescs[0]._ty).toBe(1);
    expect(f.bodyDescs[0]._tz).toBe(2);
  });
});

describe('buildWorldObjectColliders — cylinder collider', () => {
  it('creates a cylinder desc with height/2 + radius', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{
        type: 'cylinder', position: [0, 1, 0],
        collider: { shape: 'cylinder', radius: 0.5, height: 4 },
      }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    const desc = f.colliderDescs[0];
    expect(desc.kind).toBe('cylinder');
    expect(desc.halfHeight).toBe(2); // 4/2
    expect(desc.radius).toBe(0.5);
  });
});

describe('buildWorldObjectColliders — sensor', () => {
  it('calls setSensor(true) when collider.sensor is true', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{
        type: 'box', position: [0, 0, 0],
        collider: { shape: 'box', size: [2, 2, 2], sensor: true },
      }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(f.colliderDescs[0]._sensor).toBe(true);
  });

  it('does not call setSensor when sensor is false/omitted', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{
        type: 'box', position: [0, 0, 0],
        collider: { shape: 'box', size: [2, 2, 2], sensor: false },
      }],
    };
    buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(f.colliderDescs[0]._sensor).toBe(false);
  });
});

describe('buildWorldObjectColliders — multiple + visual-only objects', () => {
  it('creates one collider per object with a collider field', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [
        { type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } },
        { type: 'box', position: [1, 0, 0] }, // visual-only, no collider
        { type: 'cylinder', position: [2, 0, 0], collider: { shape: 'cylinder', radius: 1, height: 2 } },
        { type: 'torii-gate', position: [3, 0, 0] }, // visual-only
      ],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(2);
    expect(r.bodies).toHaveLength(2);
    expect(f.colliderDescs[0].kind).toBe('cuboid');
    expect(f.colliderDescs[1].kind).toBe('cylinder');
  });

  it('skips an object without a collider field (no collider created)', () => {
    const f = makeFakeRapier();
    const world = { objects: [{ type: 'box', position: [0, 0, 0] }] };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });

  it('handles an empty objects array', () => {
    const f = makeFakeRapier();
    const r = buildWorldObjectColliders({ objects: [] }, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });
});

describe('buildWorldObjectColliders — fail-safe (never throws)', () => {
  it('returns empty when physicsWorld is null', () => {
    const r = buildWorldObjectColliders(
      { objects: [{ type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } }] },
      { physicsWorld: null, Rapier: {} },
    );
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
    expect(typeof r.dispose).toBe('function');
  });

  it('returns empty when Rapier is null', () => {
    const r = buildWorldObjectColliders(
      { objects: [{ type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } }] },
      { physicsWorld: {}, Rapier: null },
    );
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });

  it('returns empty when world is null', () => {
    const r = buildWorldObjectColliders(null, { physicsWorld: {}, Rapier: {} });
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });

  it('returns empty when world.objects is not an array', () => {
    const r = buildWorldObjectColliders({ objects: 'nope' }, { physicsWorld: {}, Rapier: {} });
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });

  it('returns empty when deps are omitted entirely', () => {
    const r = buildWorldObjectColliders({ objects: [] });
    expect(r.colliders).toHaveLength(0);
    expect(r.bodies).toHaveLength(0);
  });
});

describe('buildWorldObjectColliders — per-object try/catch', () => {
  it('one object throwing does not abort the others', () => {
    const f = makeFakeRapier();
    // Sabotage the second object's createRigidBody path by giving it a position
    // that will cause createRigidBody to throw via a poisoned size? No — the
    // builder reads size inside the try. Instead, make the collider.shape valid
    // but have Rapier.ColliderDesc.cuboid throw for one call only.
    let cuboidCalls = 0;
    const origCuboid = f.Rapier.ColliderDesc.cuboid;
    f.Rapier.ColliderDesc.cuboid = function (hx, hy, hz) {
      cuboidCalls++;
      if (cuboidCalls === 1) throw new Error('boom');
      return origCuboid(hx, hy, hz);
    };
    const world = {
      objects: [
        { type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } }, // throws
        { type: 'box', position: [1, 0, 0], collider: { shape: 'box', size: [2, 2, 2] } }, // ok
      ],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    // The first threw inside the try → skipped; the second still built.
    expect(r.colliders).toHaveLength(1);
    expect(r.bodies).toHaveLength(1);
    expect(f.colliderDescs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildWorldObjectColliders — dispose', () => {
  it('dispose removes all colliders + rigid bodies', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [
        { type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } },
        { type: 'box', position: [1, 0, 0], collider: { shape: 'box', size: [2, 2, 2] } },
      ],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(r.colliders).toHaveLength(2);
    r.dispose();
    expect(f.physicsWorld.removedColliders).toHaveLength(2);
    expect(f.physicsWorld.removedBodies).toHaveLength(2);
  });

  it('dispose is idempotent (safe to call twice)', () => {
    const f = makeFakeRapier();
    const world = {
      objects: [{ type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } }],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    r.dispose();
    r.dispose(); // must not throw / not double-remove
    expect(f.physicsWorld.removedColliders).toHaveLength(1);
    expect(f.physicsWorld.removedBodies).toHaveLength(1);
  });

  it('dispose never throws even if removeCollider throws', () => {
    const f = makeFakeRapier();
    f.physicsWorld.removeCollider = () => { throw new Error('stuck'); };
    f.physicsWorld.removeRigidBody = () => { throw new Error('stuck'); };
    const world = {
      objects: [{ type: 'box', position: [0, 0, 0], collider: { shape: 'box', size: [1, 1, 1] } }],
    };
    const r = buildWorldObjectColliders(world, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(() => r.dispose()).not.toThrow();
  });

  it('dispose on a no-op build (missing deps) is a safe empty function', () => {
    const r = buildWorldObjectColliders(null, { physicsWorld: null, Rapier: null });
    expect(() => r.dispose()).not.toThrow();
  });
});

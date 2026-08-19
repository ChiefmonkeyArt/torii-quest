// tests/world-coastline.test.js — locks the Phase 0k.6 coastline-wall primitive:
// a baked segment-set (coastline-wall.json) expanded into N Rapier cuboid
// colliders at runtime. Mirrors worldObjectColliders.test.js's fake Rapier +
// the terrain round-trip fileFetch pattern.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { loadCoastlineWallData, buildCoastlineWallColliders, validateCoastlineData } from '../src/engine/world/worldCoastline.js';
import { fenceRing } from '../src/terrain/coastline.js';
import { sampleArenaHeight } from '../src/terrain/heightmap.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));
const COAST_PATH = new URL('../worlds/chiefmonkey-template/coastline-wall.json', import.meta.url);
const coast = JSON.parse(readFileSync(COAST_PATH, 'utf8'));

// File-backed fetch (mirrors the terrain round-trip test).
const fileFetch = () => Promise.resolve(JSON.parse(readFileSync(COAST_PATH, 'utf8')));

// Fake Rapier (mirrors worldObjectColliders.test.js).
function makeFakeRapier() {
  const colliderDescs = [];
  const createdColliders = [];
  const removedColliders = [];
  const removedBodies = [];
  const RigidBodyDesc = {
    fixed() { const d = { _tx: 0, _ty: 0, _tz: 0, setTranslation(x, y, z) { this._tx = x; this._ty = y; this._tz = z; return this; } }; return d; },
  };
  const ColliderDesc = {
    cuboid(hx, hy, hz) {
      const d = { kind: 'cuboid', hx, hy, hz, _rot: null, _sensor: false, setRotation(q) { this._rot = q; return this; }, setSensor(v) { this._sensor = v; return this; } };
      colliderDescs.push(d);
      return d;
    },
  };
  const physicsWorld = {
    createRigidBody() { return { handle: createdColliders.length, _desc: {} }; },
    createCollider(d, rb) { const c = { handle: createdColliders.length, _desc: d, _rb: rb }; createdColliders.push(c); return c; },
    removeCollider(c) { removedColliders.push(c); },
    removeRigidBody(rb) { removedBodies.push(rb); },
  };
  return { physicsWorld, Rapier: { RigidBodyDesc, ColliderDesc }, colliderDescs, createdColliders, removedColliders, removedBodies };
}

// Recompute a segment the way the bake script + legacy physics.js do.
function legacySegment(ring, i) {
  const rn = ring.length;
  const [ax, az] = ring[i];
  const [bx, bz] = ring[(i + 1) % rn];
  const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1e-6;
  const yaw = Math.atan2(-dz, dx);
  const cy = sampleArenaHeight(mx, mz) + 0.25;
  return [mx, cy, mz, len, yaw];
}

describe('coastline-wall schema', () => {
  it('validates a coastline-wall object (source required, no position)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', objects: [{ type: 'coastline-wall', source: 'coastline-wall.json' }] });
    expect(v.ok).toBe(true);
    expect(v.world.objects[0].source).toBe('coastline-wall.json');
    expect(v.world.objects[0].position).toBeUndefined();
  });

  it('silently drops a coastline-wall without a valid source (ok stays true)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', objects: [
      { type: 'coastline-wall' },            // missing source
      { type: 'coastline-wall', source: '/abs' }, // absolute path rejected
    ] });
    expect(v.ok).toBe(true);
    // Both malformed coastline-wall objects are silently omitted (mirrors the
    // terrain source + collider omit-on-bad-shape style — never fail the world).
    const objs = (v.world && v.world.objects) || [];
    expect(objs.filter((o) => o.type === 'coastline-wall')).toHaveLength(0);
  });
});

describe('coastline-wall bake', () => {
  it('bakes exactly 660 + 529 = 1189 segments', () => {
    expect(coast.segments.length).toBe(1189);
  });

  it('first/middle/last segment of each ring match the legacy formula', () => {
    const rings = fenceRing();
    // Ring 0 spans segments[0..659], ring 1 spans [660..1188].
    const checks = [
      { ring: rings[0], segIdx: 0 },
      { ring: rings[0], segIdx: 330 },
      { ring: rings[0], segIdx: 659 },
      { ring: rings[1], segIdx: 0, offset: 660 },
      { ring: rings[1], segIdx: 264, offset: 660 },
      { ring: rings[1], segIdx: 528, offset: 660 },
    ];
    for (const c of checks) {
      const exp = legacySegment(c.ring, c.segIdx);
      const got = coast.segments[c.segIdx + (c.offset || 0)];
      for (let k = 0; k < 5; k++) expect(got[k]).toBeCloseTo(exp[k], 4);
    }
  });
});

describe('coastline-wall load round-trip', () => {
  it('loadCoastlineWallData parses the real JSON into 1189 validated segments', async () => {
    const r = await loadCoastlineWallData({ source: 'coastline-wall.json', fetchImpl: fileFetch });
    expect(r.ok).toBe(true);
    expect(r.data.segments.length).toBe(1189);
    expect(r.data.height).toBeCloseTo(0.5, 5);
    expect(r.data.thickness).toBeCloseTo(0.2, 5);
  });
});

describe('coastline-wall collider build', () => {
  it('expands to 1189 colliders with correct half-extents + yaw', async () => {
    const r = await loadCoastlineWallData({ source: 'coastline-wall.json', fetchImpl: fileFetch });
    const f = makeFakeRapier();
    const out = buildCoastlineWallColliders(r.data, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    expect(out.colliders).toHaveLength(1189);
    expect(out.bodies).toHaveLength(1189);
    // First segment: half-extents = [len/2, 0.25, 0.1], yaw quaternion set.
    const s0 = r.data.segments[0];
    const d0 = f.colliderDescs[0];
    expect(d0.hx).toBeCloseTo(s0[3] / 2, 5);
    expect(d0.hy).toBeCloseTo(0.25, 5);
    expect(d0.hz).toBeCloseTo(0.1, 5);
    expect(d0._rot).toBeTruthy(); // yaw applied
  });

  it('dispose removes every collider + body', async () => {
    const r = await loadCoastlineWallData({ source: 'coastline-wall.json', fetchImpl: fileFetch });
    const f = makeFakeRapier();
    const out = buildCoastlineWallColliders(r.data, { physicsWorld: f.physicsWorld, Rapier: f.Rapier });
    out.dispose();
    expect(f.removedColliders.length).toBe(1189);
    expect(f.removedBodies.length).toBe(1189);
  });

  it('validates reject malformed data', () => {
    expect(validateCoastlineData({ height: 0.5, thickness: 0.2, segments: [] }).ok).toBe(false);
    expect(validateCoastlineData({ height: 0.5, thickness: 0.2, segments: [[1, 2, 3]] }).ok).toBe(false); // too few fields
    expect(validateCoastlineData({ height: -1, thickness: 0.2, segments: [[1, 2, 3, 4, 5]] }).ok).toBe(false);
  });
});

describe('chiefmonkey-template ships the coastline wall', () => {
  it('world.json references coastline-wall.json', () => {
    const obj = world.objects.find((o) => o && o.type === 'coastline-wall');
    expect(obj).toBeTruthy();
    expect(obj.source).toBe('coastline-wall.json');
  });

  it('coastline-wall.json is a non-empty valid segment-set', () => {
    expect(coast.segments.length).toBeGreaterThan(1000);
    expect(validateCoastlineData(coast).ok).toBe(true);
  });
});

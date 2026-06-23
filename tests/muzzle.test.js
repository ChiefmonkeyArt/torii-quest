// muzzle.test.js — locks the v0.2.129 barrel/muzzle origin side convention.
// The +right offset must land on the VISIBLE right-hand gun side, and the basis
// must be built from the camera's WORLD quaternion so the muzzle tracks player
// yaw (the v0.2.129 bullet-from-the-left regression). Pure THREE math only
// (Object3D/PerspectiveCamera/Quaternion/Vector3 are DOM-free), so node-fast.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  muzzlePoint, barrelWorldFromCamera,
  MUZZLE_FORWARD, MUZZLE_RIGHT, MUZZLE_UP,
} from '../src/engine/weapons/muzzle.js';

const v = () => ({ x: 0, y: 0, z: 0 });

describe('muzzle constants — side convention', () => {
  it('+right offset is positive (visible right-hand gun side)', () => {
    expect(MUZZLE_RIGHT).toBeGreaterThan(0);
  });
  it('forward is positive (applied to a -Z forward vector), up is negative', () => {
    expect(MUZZLE_FORWARD).toBeGreaterThan(0);
    expect(MUZZLE_UP).toBeLessThan(0);
  });
});

describe('muzzlePoint — scalar offset application', () => {
  it('applies forward/right/up along the supplied world basis', () => {
    // Identity-facing basis: forward -Z, right +X, up +Y.
    const out = muzzlePoint(
      0, 1.7, 0,
      0, 0, -1,
      1, 0, 0,
      0, 1, 0,
      v(),
    );
    expect(out.x).toBeCloseTo(MUZZLE_RIGHT, 12);
    expect(out.y).toBeCloseTo(1.7 + MUZZLE_UP, 12);
    expect(out.z).toBeCloseTo(-MUZZLE_FORWARD, 12);
  });

  it('puts the origin on the +right side of the camera ray', () => {
    // Right offset moves +X when facing -Z; that is screen-right.
    const out = muzzlePoint(0, 0, 0, 0, 0, -1, 1, 0, 0, 0, 1, 0, v());
    expect(out.x).toBeGreaterThan(0);
  });
});

// The real regression test: a camera parented under a yawing player. The barrel
// origin must stay to the camera's WORLD-right at EVERY facing, not drift to a
// fixed world axis (the local-quaternion bug that put the muzzle on the left).
function makeParentedCamera(yaw, pitch = 0) {
  const playerObj = new THREE.Object3D();
  playerObj.rotation.y = yaw;          // yaw lives on the player (matches player.js)
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  camera.rotation.x = pitch;           // pitch lives on the camera
  playerObj.add(camera);
  playerObj.updateMatrixWorld(true);
  return camera;
}

describe('barrelWorldFromCamera — tracks player yaw (v0.2.129 fix)', () => {
  const _q = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _rgt = new THREE.Vector3();
  const _pos = new THREE.Vector3();

  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.3]) {
    it(`origin is on the camera world-right at yaw=${yaw.toFixed(2)}`, () => {
      const camera = makeParentedCamera(yaw);
      const out = barrelWorldFromCamera(camera, v());

      camera.getWorldPosition(_pos);
      camera.getWorldQuaternion(_q);
      _rgt.set(1, 0, 0).applyQuaternion(_q);
      _fwd.set(0, 0, -1).applyQuaternion(_q);

      // Project the (origin - camPos) offset onto the world-right axis: must be
      // the positive MUZZLE_RIGHT, regardless of facing.
      const ox = out.x - _pos.x, oy = out.y - _pos.y, oz = out.z - _pos.z;
      const rightComp = ox * _rgt.x + oy * _rgt.y + oz * _rgt.z;
      expect(rightComp).toBeCloseTo(MUZZLE_RIGHT, 6);

      // Forward component preserved (barrel→crosshair direction unchanged).
      const fwdComp = ox * _fwd.x + oy * _fwd.y + oz * _fwd.z;
      expect(fwdComp).toBeCloseTo(MUZZLE_FORWARD, 6);
    });
  }

  it('right offset follows world-right at yaw=90° (the local-quaternion bug)', () => {
    // At yaw=90° world-right is approx (0,0,-1). The OLD local-quaternion code
    // applied +X along the yaw-less local frame, leaving a +X residue. The fixed
    // code must instead push the right offset onto world -Z, with ~zero world-X
    // contribution FROM THE RIGHT TERM. Isolate it by differencing against a
    // zero-right reference is overkill; assert the right offset lands on -Z.
    const camera = makeParentedCamera(Math.PI / 2);
    const out = barrelWorldFromCamera(camera, v());
    camera.getWorldPosition(_pos);
    _rgt.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q));
    // world-right ≈ (0,0,-1): negligible world-X, dominant -Z.
    expect(_rgt.x).toBeCloseTo(0, 6);
    expect(_rgt.z).toBeCloseTo(-1, 6);
    // And the origin's projection onto world-right is the positive MUZZLE_RIGHT.
    const ox = out.x - _pos.x, oy = out.y - _pos.y, oz = out.z - _pos.z;
    expect(ox * _rgt.x + oy * _rgt.y + oz * _rgt.z).toBeCloseTo(MUZZLE_RIGHT, 6);
  });
});

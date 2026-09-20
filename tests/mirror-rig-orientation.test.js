// mirror-rig-orientation.test.js — locks the character rig's Z-up→Y-up "stand up"
// orientation (engine/mirror/rigOrientation.js) so the self-view mirror can never
// regress to the "crab" (character lying on its back).
//
// Cross-checks the pure math against THREE.Quaternion/Vector3 to guarantee the
// node-safe helpers are bit-compatible with what playerModel applies at runtime.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  rigLocalUp, orientQuaternion, computeRigWorldUp, isRigUpright,
  standUpQuaternion, turnAroundQuaternion, applyQuat, WORLD_UP,
} from '../src/engine/mirror/rigOrientation.js';

function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

describe('rigOrientation — quaternion parity with THREE', () => {
  it('standUp + turnAround match the original THREE.Quaternion construction', () => {
    const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const turnAround = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const expected = turnAround.clone().multiply(standUp); // the exact playerModel code

    const q = orientQuaternion(true);
    expect(close(q[0], expected.x)).toBe(true);
    expect(close(q[1], expected.y)).toBe(true);
    expect(close(q[2], expected.z)).toBe(true);
    expect(close(q[3], expected.w)).toBe(true);
  });

  it('applyQuat matches THREE.Vector3.applyQuaternion', () => {
    for (const v of [[0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [0.3, -0.4, 0.5]]) {
      for (const isZUp of [true, false]) {
        const q = orientQuaternion(isZUp);
        const q3 = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
        const got = applyQuat(q, v);
        const want = new THREE.Vector3(...v).applyQuaternion(q3);
        expect(close(got[0], want.x)).toBe(true);
        expect(close(got[1], want.y)).toBe(true);
        expect(close(got[2], want.z)).toBe(true);
      }
    }
  });
});

describe('rigOrientation — upright invariant', () => {
  it('a Z-up rig lands its head on world +Y (not on its back)', () => {
    // The Z-up model's head points −Z in bind pose; stand-up maps it to +Y.
    expect(rigLocalUp(true)).toEqual([0, 0, -1]);
    const u = computeRigWorldUp(true);
    expect(close(u[0], 0)).toBe(true);
    expect(close(u[1], 1)).toBe(true);
    expect(close(u[2], 0)).toBe(true);
    expect(isRigUpright(true)).toBe(true);
  });

  it('a Y-up rig stays upright under the 180° yaw', () => {
    expect(rigLocalUp(false)).toEqual([0, 1, 0]);
    const u = computeRigWorldUp(false);
    expect(close(u[0], 0)).toBe(true);
    expect(close(u[1], 1)).toBe(true);
    expect(close(u[2], 0)).toBe(true);
    expect(isRigUpright(false)).toBe(true);
  });

  it('the turn-around alone must NOT stand a Z-up rig (documents the required standUp)', () => {
    // Sanity: a 180° yaw alone leaves a Z-up head (−Z → +Z) horizontal — proof that
    // the stand-up rotation is load-bearing, not optional.
    const q = turnAroundQuaternion();
    const u = applyQuat(q, rigLocalUp(true));
    expect(close(u[1], 0)).toBe(true); // head is horizontal without standUp
  });

  it('the oriented up axis is a unit vector on the correct axis', () => {
    const u = computeRigWorldUp(true);
    const len = Math.hypot(u[0], u[1], u[2]);
    expect(close(len, 1)).toBe(true);
    expect(u[2]).toBeCloseTo(0, 5);
    expect(WORLD_UP).toEqual([0, 1, 0]);
  });
});
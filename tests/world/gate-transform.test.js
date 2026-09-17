import { describe, it, expect } from 'vitest';
import { gateTransform, quatFromYaw } from '../../src/engine/world/gateTransform.js';

describe('quatFromYaw — yaw-only rotation about +Y', () => {
  it('is the identity quaternion at yaw 0', () => {
    expect(quatFromYaw(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('maps a half-turn to { y: 1, w: 0 }', () => {
    const q = quatFromYaw(Math.PI);
    expect(Math.abs(q.y - 1)).toBeLessThan(1e-9);
    expect(Math.abs(q.w)).toBeLessThan(1e-9);
    expect(q.x).toBe(0);
    expect(q.z).toBe(0);
  });

  it('is normalised for an arbitrary yaw', () => {
    const q = quatFromYaw(1.234);
    const n = Math.hypot(q.x, q.y, q.z, q.w);
    expect(Math.abs(n - 1)).toBeLessThan(1e-9);
  });
});

describe('gateTransform — destination gate pose from a manifest', () => {
  it('reads an explicit gateway.position with an identity quaternion', () => {
    const t = gateTransform({ gateway: { position: [5, 1.6, -3] } });
    expect(t).toEqual({ position: { x: 5, y: 1.6, z: -3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  });

  it('reads a torii-gate object position + yaw from rotation[1]', () => {
    const t = gateTransform({
      objects: [{ type: 'box', position: [1, 0, 1] }, { type: 'torii-gate', position: [2, 0, 9], rotation: [0, Math.PI / 2, 0] }],
    });
    expect(t.position).toEqual({ x: 2, y: 0, z: 9 });
    expect(Math.abs(t.quaternion.y - Math.SQRT1_2)).toBeLessThan(1e-9);
    expect(Math.abs(t.quaternion.w - Math.SQRT1_2)).toBeLessThan(1e-9);
  });

  it('prefers an explicit gateway over a torii-gate object', () => {
    const t = gateTransform({
      gateway: { position: [0, 0, 0] },
      objects: [{ type: 'torii-gate', position: [10, 0, 10], rotation: [0, 1, 0] }],
    });
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.quaternion.w).toBe(1);
  });

  it('returns null when the manifest has no gate', () => {
    expect(gateTransform(null)).toBeNull();
    expect(gateTransform({})).toBeNull();
    expect(gateTransform({ objects: [{ type: 'box', position: [1, 0, 1] }] })).toBeNull();
  });

  it('tolerates a short/invalid gateway position', () => {
    expect(gateTransform({ gateway: { position: [1, 2] } })).toBeNull();
  });
});
// world-arrival.test.js — locks the traveller arrival pose (ADR-0119 playtest fix):
// arrive at the torii gate facing into the world, never at the owner's login spawn.
import { describe, it, expect } from 'vitest';
import { resolveArrival } from '../src/engine/world/worldArrival.js';

const MANIFEST = {
  id: 'bekka-world',
  name: 'Bekka World',
  spawn: { position: [-14, 3.1, -14], yaw: -2.356 },
  gateway: { position: [20, 0, 0] },
  objects: [
    { type: 'torii-gate', position: [20, 0, 0], rotation: [0, 0, 0] },
    { type: 'torii-gate', position: [42, 0, 16], rotation: [0, -0.785, 0] }, // travel-gate
  ],
};

describe('resolveArrival', () => {
  it('arrives at the gateway, not the owner spawn', () => {
    const a = resolveArrival(MANIFEST);
    // Not mid-arena.
    expect(Math.abs(a.x - (-14)) + Math.abs(a.z - (-14))).toBeGreaterThan(10);
    // Near the gate (inside by gateInset).
    const gdx = a.x - 20;
    const gdz = a.z - 0;
    expect(Math.hypot(gdx, gdz)).toBeCloseTo(2.6, 1);
  });

  it('faces into the world (toward the owner spawn)', () => {
    const a = resolveArrival(MANIFEST);
    const dx = Math.sign(Math.sin(a.yaw));
    const dz = Math.sign(Math.cos(a.yaw));
    // spawn (-14,-14) relative to gate (20,0) is direction (-34,-14) → dx<0, dz<0.
    expect(dx).toBe(-1);
    expect(dz).toBe(-1);
  });

  it('uses the first torii-gate object when gateway block is absent', () => {
    const { gateway, ...noGateway } = MANIFEST;
    const a = resolveArrival(noGateway);
    // First torii-gate object is the entry gate at (20,0).
    expect(a.x).toBeCloseTo(20 + (Math.sin(Math.atan2(-34, -14)) * 2.6), 1);
    expect(a.z).toBeCloseTo(0 + (Math.cos(Math.atan2(-34, -14)) * 2.6), 1);
  });

  it('falls back to the owner spawn when there is no gate', () => {
    const a = resolveArrival({ id: 'x', spawn: { position: [3, 0, 7], yaw: 0.5 } });
    expect(a).toEqual({ x: 3, z: 7, yaw: 0.5 });
  });

  it('returns origin when the manifest has neither gate nor spawn', () => {
    expect(resolveArrival(undefined)).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(resolveArrival({})).toEqual({ x: 0, z: 0, yaw: 0 });
  });

  it('respects a custom gate inset', () => {
    const a = resolveArrival(MANIFEST, { gateInset: 1.0 });
    const gdx = a.x - 20;
    const gdz = a.z - 0;
    expect(Math.hypot(gdx, gdz)).toBeCloseTo(1.0, 1);
  });
});
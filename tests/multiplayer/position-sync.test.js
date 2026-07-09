// position-sync.test.js — locks MP-1 remote-peer interpolation.
// Pure (no THREE, no clock deps).
import { describe, it, expect } from 'vitest';
import {
  createSnapshotBuffer, pushSnapshot, sample, lerpAngle,
  INTERP_DELAY_MS, EXTRAP_CAP_MS,
} from '../../src/engine/multiplayer/positionSync.js';

const snap = (clientTs, x, z, yaw = 0, vel = [0, 0, 0]) => ({
  pos: [x, 0, z], rot: [yaw, 0], vel, clientTs,
});

describe('positionSync', () => {
  it('returns null when the buffer is empty', () => {
    const buf = createSnapshotBuffer();
    expect(sample(buf, 1000)).toBeNull();
  });

  it('lerps between two bracketing snapshots at the interp delay', () => {
    const buf = createSnapshotBuffer();
    pushSnapshot(buf, snap(0,    0, 0));
    pushSnapshot(buf, snap(1000, 10, 0));
    // renderTime with the fixed 100ms delay lands the target at t=400 → 40%.
    const out = sample(buf, 500);
    expect(out.pos[0]).toBeCloseTo(4, 6);
  });

  it('holds at the earliest snapshot when target is before it', () => {
    const buf = createSnapshotBuffer();
    pushSnapshot(buf, snap(1000, 5, 5));
    pushSnapshot(buf, snap(2000, 8, 5));
    // renderTime very early — target < earliest.
    const out = sample(buf, 500);
    expect(out.pos).toEqual([5, 0, 5]);
  });

  it('extrapolates with velocity beyond the newest, capped at EXTRAP_CAP_MS', () => {
    const buf = createSnapshotBuffer();
    // Newest at t=1000, vel=+10 m/s along x.
    pushSnapshot(buf, snap(1000, 0, 0, 0, [10, 0, 0]));
    // renderTime such that target = newest + 500ms (over-cap by 300ms).
    const renderTime = 1000 + INTERP_DELAY_MS + 500;
    const out = sample(buf, renderTime);
    // Overshoot clamped to EXTRAP_CAP_MS (200ms) → 10 m/s * 0.2s = 2m.
    expect(out.pos[0]).toBeCloseTo(EXTRAP_CAP_MS / 1000 * 10, 6);
  });

  it('handles late-arriving snapshots by inserting in order', () => {
    const buf = createSnapshotBuffer();
    pushSnapshot(buf, snap(0,    0, 0));
    pushSnapshot(buf, snap(2000, 20, 0));
    // Out-of-order arrival at t=1000, halfway.
    pushSnapshot(buf, snap(1000, 10, 0));
    // Sample at 1100 → target = 1000. Should hit exactly the inserted snap.
    const out = sample(buf, 1100);
    expect(out.pos[0]).toBeCloseTo(10, 6);
  });

  it('lerpAngle wraps around ±π correctly', () => {
    // Going from +3 to -3 across the ±π seam: shortest path is via +π, not through 0.
    const mid = lerpAngle(3, -3, 0.5);
    // 3 → -3 the short way is +0.283... rad delta (TAU - 6), so midpoint ≈ 3 + 0.141.
    const expected = 3 + (Math.PI * 2 - 6) * 0.5;
    expect(mid).toBeCloseTo(expected, 6);
    // Short-path from 0 to π/2 is boring — verify it works normally.
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 6);
  });
});

// snapshot-ring.test.js — MP-2 pure ring buffer for lag-comp rewind.
// Locks: push/overflow, sampleAt clamp/interp, empty-safety, yaw shortest-arc.
import { describe, it, expect } from 'vitest';
import {
  createSnapshotRing,
  push,
  newest,
  oldest,
  sampleAt,
  lerpYaw,
  RING_CAPACITY,
} from '../../server/combat/snapshotRing.js';

const mkSnap = (ts, x = 0, y = 1.7, z = 0, yaw = 0, pitch = 0) => ({
  ts,
  pos: [x, y, z],
  rot: [yaw, pitch],
  vel: [0, 0, 0],
});

describe('snapshotRing (MP-2)', () => {
  it('empty ring: sampleAt / newest / oldest return null; RING_CAPACITY is 30', () => {
    expect(RING_CAPACITY).toBe(30);
    const ring = createSnapshotRing();
    expect(newest(ring)).toBeNull();
    expect(oldest(ring)).toBeNull();
    expect(sampleAt(ring, 1000)).toBeNull();
  });

  it('push honours capacity, overwrites oldest slot in FIFO order', () => {
    const ring = createSnapshotRing(4);
    for (let i = 0; i < 6; i++) push(ring, mkSnap(i * 10, i));
    // After 6 pushes into cap-4: entries should be ts=20,30,40,50
    expect(ring.size).toBe(4);
    expect(oldest(ring).ts).toBe(20);
    expect(newest(ring).ts).toBe(50);
    // No duplicates or wrap corruption.
    const all = [];
    for (let i = 0; i < ring.size; i++) {
      all.push(ring.buf[(ring.head + i) % ring.capacity].ts);
    }
    expect(all).toEqual([20, 30, 40, 50]);
  });

  it('sampleAt clamps to newest when t is in the future (no extrapolation)', () => {
    const ring = createSnapshotRing();
    push(ring, mkSnap(100, 1, 1.7, 2));
    push(ring, mkSnap(200, 3, 1.7, 4));
    const s = sampleAt(ring, 10_000);
    expect(s.pos).toEqual([3, 1.7, 4]);
  });

  it('sampleAt returns null when t precedes the oldest snap (no fabrication)', () => {
    const ring = createSnapshotRing();
    push(ring, mkSnap(1000));
    push(ring, mkSnap(1100));
    expect(sampleAt(ring, 500)).toBeNull();
  });

  it('sampleAt linearly interpolates position between flanking snaps', () => {
    const ring = createSnapshotRing();
    push(ring, mkSnap(0, 0, 1.7, 0, 0));
    push(ring, mkSnap(100, 10, 1.7, 20, 0));
    const s = sampleAt(ring, 50); // midpoint
    expect(s.pos[0]).toBeCloseTo(5, 6);
    expect(s.pos[2]).toBeCloseTo(10, 6);
  });

  it('yaw interp uses shortest arc across the ±π wrap', () => {
    // From 3.0 rad (~172°) to -3.0 rad (~-172°), shortest arc is ~+0.28 rad
    // through π, not the long -6.0 rad path.
    const mid = lerpYaw(3.0, -3.0, 0.5);
    // Both 3.0 → π and -3.0 → -π are close; the midpoint should hit ±π (equivalent).
    // Result is a + diff*0.5 where diff after wrap is +0.2832… → mid ≈ 3.1416.
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(0.02);
  });
});

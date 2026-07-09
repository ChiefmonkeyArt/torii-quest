// hit-resolver.test.js — MP-2 server-authoritative shot resolution.
import { describe, it, expect } from 'vitest';
import { resolveShot, DEFAULT_LAG_COMP_MS } from '../../server/combat/hitResolver.js';
import { createSnapshotRing, push } from '../../server/combat/snapshotRing.js';

// Helper: build a peer ring with one snapshot at time t0.
function mkRing(id, snap) {
  const ring = createSnapshotRing();
  push(ring, snap);
  return { id, ring };
}

// Standard peer snapshot: eye-level y=1.7 → foot=0.
const snapAt = (ts, x, z) => ({
  ts,
  pos: [x, 1.7, z],
  rot: [0, 0],
  vel: [0, 0, 0],
});

describe('resolveShot (MP-2)', () => {
  it('exports DEFAULT_LAG_COMP_MS = 300', () => {
    expect(DEFAULT_LAG_COMP_MS).toBe(300);
  });

  it('picks the nearest peer hit across a 3-peer fixture', () => {
    const now = 10_000;
    const peerRings = [
      mkRing('near', snapAt(now, 0, 3)), // closest along +z
      mkRing('mid',  snapAt(now, 0, 6)),
      mkRing('far',  snapAt(now, 0, 9)),
    ];
    const res = resolveShot({
      shooterId: 'shooter',
      shot: { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now },
      peerRings,
      now,
    });
    expect(res).not.toBeNull();
    expect(res.targetId).toBe('near');
    expect(res.zone).toBe('head'); // eye-level shot at head height
  });

  it('clamps shot.ts into [now - LAG_COMP_MS, now]', () => {
    const now = 10_000;
    // Shooter fires "at now" but claims ts=now-5000 (way past LAG_COMP).
    // Resolver should clamp to now-300 and still find the peer if present.
    const peerRings = [mkRing('p1', snapAt(now - 300, 0, 5))];
    const res = resolveShot({
      shooterId: 'shooter',
      shot: { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now - 5000 },
      peerRings,
      now,
      lagCompMs: 300,
    });
    expect(res).not.toBeNull();
    expect(res.targetId).toBe('p1');
  });

  it('skips peers whose ring is empty (no history to sample)', () => {
    const now = 10_000;
    const peerRings = [{ id: 'empty', ring: createSnapshotRing() }];
    const res = resolveShot({
      shooterId: 'shooter',
      shot: { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now },
      peerRings,
      now,
    });
    expect(res).toBeNull();
  });

  it('never returns self-hit even if the shooter has a ring entry', () => {
    const now = 10_000;
    const peerRings = [mkRing('shooter', snapAt(now, 0, 5))];
    const res = resolveShot({
      shooterId: 'shooter',
      shot: { origin: [0, 1.7, 0], dir: [0, 0, 1], ts: now },
      peerRings,
      now,
    });
    expect(res).toBeNull();
  });

  it('rejects malformed shot payloads (bad origin/dir/ts)', () => {
    const now = 10_000;
    const peerRings = [mkRing('p1', snapAt(now, 0, 5))];
    expect(resolveShot({ shooterId: 's', shot: null,                  peerRings, now })).toBeNull();
    expect(resolveShot({ shooterId: 's', shot: { origin: 'x', dir: [1,0,0], ts: now }, peerRings, now })).toBeNull();
    expect(resolveShot({ shooterId: 's', shot: { origin: [0,0,0], dir: [1,0,0], ts: NaN }, peerRings, now })).toBeNull();
  });
});

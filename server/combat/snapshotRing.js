// server/combat/snapshotRing.js — pure per-session position ring (MP-2, v0.2.364-alpha).
//
// Records each authoritative MOVE from a peer and answers "where was peer X at
// time T?" for lag-compensated shot resolution.
//
// Design constraints (from MP_2_SPEC.md §7):
//   • Pure. No timers, no I/O, no globals.
//   • Fixed-capacity ring — no growth, no GC pressure per push.
//   • sampleAt(t) returns interpolated {pos, rot} from the two flanking snaps,
//     or the newest snap if t is past the ring's newest, or null if the ring
//     is empty or t precedes the oldest snap.
//   • rot is stored as [yaw, pitch] (2-tuple) matching wireProtocol MOVE.rot.
//     Yaw interp uses shortest-arc; pitch is straight linear.

export const RING_CAPACITY = 30; // ≥1.5s at 20 Hz MOVE rate

/**
 * @typedef {{
 *   ts: number,
 *   pos: [number,number,number],
 *   rot: [number,number],
 *   vel: [number,number,number],
 * }} Snap
 */

/** Create a new empty ring. */
export function createSnapshotRing(capacity = RING_CAPACITY) {
  return {
    capacity,
    buf: new Array(capacity),
    /** number of live entries; ≤ capacity */
    size: 0,
    /** index of the OLDEST entry when size > 0 */
    head: 0,
  };
}

/** Push a snapshot; overwrites oldest when full. */
export function push(ring, snap) {
  if (!ring || !snap || typeof snap.ts !== 'number') return;
  const nextIdx = (ring.head + ring.size) % ring.capacity;
  if (ring.size < ring.capacity) {
    ring.size += 1;
  } else {
    // Full — advance head, overwrite oldest slot (which is head).
    ring.head = (ring.head + 1) % ring.capacity;
  }
  ring.buf[nextIdx] = snap;
}

/** Newest snap or null. */
export function newest(ring) {
  if (!ring || ring.size === 0) return null;
  const idx = (ring.head + ring.size - 1) % ring.capacity;
  return ring.buf[idx];
}

/** Oldest snap or null. */
export function oldest(ring) {
  if (!ring || ring.size === 0) return null;
  return ring.buf[ring.head];
}

/**
 * Sample the ring at wall-time t (ms). Returns an interpolated {pos, rot} or
 * null if the ring can't reasonably answer (empty, or t < oldest.ts).
 *
 * If t is at-or-newer than the newest snap, returns a copy of the newest
 * (clamp — do NOT extrapolate on the server; extrapolation is the client's
 * job for smoothing).
 */
export function sampleAt(ring, t) {
  if (!ring || ring.size === 0) return null;
  const n = newest(ring);
  if (t >= n.ts) {
    return { pos: [n.pos[0], n.pos[1], n.pos[2]], rot: [n.rot[0], n.rot[1]] };
  }
  const o = oldest(ring);
  if (t < o.ts) return null; // no history reaches that far back

  // Find the pair (a, b) with a.ts <= t < b.ts. Scan oldest→newest.
  let prev = null;
  for (let i = 0; i < ring.size; i++) {
    const idx = (ring.head + i) % ring.capacity;
    const snap = ring.buf[idx];
    if (snap.ts > t && prev) {
      return interp(prev, snap, t);
    }
    if (snap.ts === t) {
      return { pos: [snap.pos[0], snap.pos[1], snap.pos[2]], rot: [snap.rot[0], snap.rot[1]] };
    }
    prev = snap;
  }
  // Shouldn't reach — the newest clamp above covers t >= newest.ts.
  return prev ? { pos: [prev.pos[0], prev.pos[1], prev.pos[2]], rot: [prev.rot[0], prev.rot[1]] } : null;
}

// Linear interpolate pos; shortest-arc yaw; linear pitch.
function interp(a, b, t) {
  const dt = b.ts - a.ts;
  const u = dt <= 0 ? 0 : (t - a.ts) / dt;
  return {
    pos: [
      a.pos[0] + (b.pos[0] - a.pos[0]) * u,
      a.pos[1] + (b.pos[1] - a.pos[1]) * u,
      a.pos[2] + (b.pos[2] - a.pos[2]) * u,
    ],
    rot: [
      lerpYaw(a.rot[0], b.rot[0], u),
      a.rot[1] + (b.rot[1] - a.rot[1]) * u,
    ],
  };
}

// Shortest-arc yaw interpolation over a wrap-safe circle. Both inputs
// are radians in wireProtocol's ROT_ABS = 2π unwrapped range.
export function lerpYaw(a, b, u) {
  const TWO_PI = Math.PI * 2;
  let diff = b - a;
  // Reduce to (-π, π].
  diff = ((diff + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return a + diff * u;
}

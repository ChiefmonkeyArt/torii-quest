// positionSync.js — pure interpolation state for remote peer transforms.
// Node-pure (no THREE, no DOM).
//
// Given a stream of timestamped snapshots {pos, rot, vel, serverTs}, produces
// an interpolated {pos, rot} at any render time. Trades a small (INTERP_DELAY_MS)
// visual lag for smoothness — a proven pattern from Quake/CS-era netcode.
//
// Contract:
//   - const buf = createSnapshotBuffer();
//   - pushSnapshot(buf, { pos, rot, vel, serverTs });
//   - sample(buf, renderTime) -> { pos, rot } | null
//
// renderTime is on the CLIENT clock, in ms. Server timestamps are translated
// to client-clock via a running offset (see wsClient.js) before being pushed.
//
// If we run out of buffered snapshots ahead of renderTime we extrapolate using
// the last known velocity for up to EXTRAP_CAP_MS, then hold the last position.

export const INTERP_DELAY_MS = 100;   // render this far in the past for smoothness
export const EXTRAP_CAP_MS   = 200;   // clamp dead-reckoning to this
export const BUF_MAX         = 32;    // ring buffer size — ~1.6s at 20 Hz

/** Create an empty snapshot buffer. */
export function createSnapshotBuffer() {
  return { snaps: [], lastPos: null, lastRot: null, lastVel: null };
}

/** Insert a snapshot, keeping the buffer sorted by clientTs and bounded. */
export function pushSnapshot(buf, snap) {
  if (!snap || !Array.isArray(snap.pos) || snap.pos.length !== 3) return;
  if (!Array.isArray(snap.rot) || snap.rot.length !== 2)          return;
  if (typeof snap.clientTs !== 'number' || !Number.isFinite(snap.clientTs)) return;
  const s = {
    pos: [snap.pos[0], snap.pos[1], snap.pos[2]],
    rot: [snap.rot[0], snap.rot[1]],
    vel: Array.isArray(snap.vel) && snap.vel.length === 3
      ? [snap.vel[0], snap.vel[1], snap.vel[2]] : [0, 0, 0],
    clientTs: snap.clientTs,
  };
  // Common case: newer than everything → push.
  const last = buf.snaps[buf.snaps.length - 1];
  if (!last || s.clientTs >= last.clientTs) {
    buf.snaps.push(s);
  } else {
    // Late arrival — insert sorted.
    let i = buf.snaps.length - 1;
    while (i >= 0 && buf.snaps[i].clientTs > s.clientTs) i--;
    buf.snaps.splice(i + 1, 0, s);
  }
  // Trim old snapshots.
  while (buf.snaps.length > BUF_MAX) buf.snaps.shift();
  buf.lastPos = s.pos;
  buf.lastRot = s.rot;
  buf.lastVel = s.vel;
}

/** Sample the interpolated transform at renderTime (client clock, ms).
 *  Returns null if no data is available yet. */
export function sample(buf, renderTime) {
  const snaps = buf.snaps;
  if (snaps.length === 0) return null;
  const target = renderTime - INTERP_DELAY_MS;

  // Below the earliest snapshot → hold at the earliest.
  if (target <= snaps[0].clientTs) {
    return { pos: snaps[0].pos.slice(), rot: snaps[0].rot.slice() };
  }
  // Above the latest → extrapolate with last known velocity, capped.
  const newest = snaps[snaps.length - 1];
  if (target >= newest.clientTs) {
    const overshoot = Math.min(target - newest.clientTs, EXTRAP_CAP_MS);
    const dt = overshoot / 1000;
    return {
      pos: [
        newest.pos[0] + newest.vel[0] * dt,
        newest.pos[1] + newest.vel[1] * dt,
        newest.pos[2] + newest.vel[2] * dt,
      ],
      rot: newest.rot.slice(),
    };
  }
  // In-buffer: find the bracketing pair and lerp.
  for (let i = 0; i < snaps.length - 1; i++) {
    const a = snaps[i], b = snaps[i + 1];
    if (target >= a.clientTs && target <= b.clientTs) {
      const span = b.clientTs - a.clientTs;
      const alpha = span > 0 ? (target - a.clientTs) / span : 0;
      return {
        pos: [
          a.pos[0] + (b.pos[0] - a.pos[0]) * alpha,
          a.pos[1] + (b.pos[1] - a.pos[1]) * alpha,
          a.pos[2] + (b.pos[2] - a.pos[2]) * alpha,
        ],
        rot: [
          lerpAngle(a.rot[0], b.rot[0], alpha),
          a.rot[1] + (b.rot[1] - a.rot[1]) * alpha,
        ],
      };
    }
  }
  // Fallback (shouldn't happen): return newest.
  return { pos: newest.pos.slice(), rot: newest.rot.slice() };
}

/** Shortest-path angle lerp — handles yaw wrapping across ±π. */
export function lerpAngle(a, b, alpha) {
  const TAU = Math.PI * 2;
  let delta = ((b - a) % TAU + TAU) % TAU;
  if (delta > Math.PI) delta -= TAU;
  return a + delta * alpha;
}

// server/bots/botSnapshotRing.js — pure bot position history ring (v0.2.385-alpha).
//
// The bot analogue of server/combat/snapshotRing.js. Player→peer combat already
// rewinds each peer to the shot timestamp before ray-testing; player→bot combat
// did not, so a bot moving sideways at ~2.2 m/s (≈0.22m per 100ms, near the
// capsule radius 0.26) ate shots the player landed on the ~100ms-old visually-
// lagged bot. This ring records every bot's position at the sim tick so the bot
// resolver can rewind to the shot ts, exactly as the peer resolver does.
//
// Design (mirrors snapshotRing.js window/clamp semantics):
//   • Pure. No timers, no I/O, no globals.
//   • Fixed-capacity ring — no growth, no per-push GC pressure.
//   • Each entry holds ALL bots at one ts: { ts, bots:[{id,x,z,footY,radius,alive}] }.
//   • sampleAt(t) interpolates each bot (matched by id) between the two flanking
//     frames. Clamps to newest when t is at/after newest, and to OLDEST when t is
//     before the oldest (so an out-of-window shot ts never crashes / returns NaN).
//   • Returns null only when the ring is empty (caller then falls back to the
//     bots' current positions — the pre-lag-comp behaviour).
// SPDX-License-Identifier: MIT

// Mirror snapshotRing's RING_CAPACITY: ≥1.5s of history at the ~20 Hz bot tick,
// comfortably covering the 300ms lag-comp clamp window.
export const BOT_RING_CAPACITY = 30;

/**
 * @typedef {{ id:number, x:number, z:number, footY:number, radius:number, alive:boolean }} BotRow
 * @typedef {{ ts:number, bots: BotRow[] }} BotSnap
 */

/** Create a new empty bot ring. */
export function createBotSnapshotRing(capacity = BOT_RING_CAPACITY) {
  return {
    capacity,
    buf: new Array(capacity),
    size: 0, // number of live entries; ≤ capacity
    head: 0, // index of the OLDEST entry when size > 0
  };
}

/** Push a snapshot; overwrites the oldest when full. */
export function pushBotSnap(ring, snap) {
  if (!ring || !snap || typeof snap.ts !== 'number' || !Array.isArray(snap.bots)) return;
  const nextIdx = (ring.head + ring.size) % ring.capacity;
  if (ring.size < ring.capacity) {
    ring.size += 1;
  } else {
    ring.head = (ring.head + 1) % ring.capacity;
  }
  ring.buf[nextIdx] = snap;
}

/** Newest snap or null. */
export function newestBotSnap(ring) {
  if (!ring || ring.size === 0) return null;
  const idx = (ring.head + ring.size - 1) % ring.capacity;
  return ring.buf[idx];
}

/** Oldest snap or null. */
export function oldestBotSnap(ring) {
  if (!ring || ring.size === 0) return null;
  return ring.buf[ring.head];
}

function copyRows(rows) {
  return rows.map((r) => ({ id: r.id, x: r.x, z: r.z, footY: r.footY, radius: r.radius, alive: r.alive }));
}

/**
 * Sample the ring at wall-time t (ms). Returns an array of per-bot rows
 * (positions interpolated between the two flanking frames), or null if the ring
 * is empty. Clamps to the newest frame when t ≥ newest.ts and to the oldest
 * frame when t ≤ oldest.ts (no extrapolation; no crash on an out-of-window ts).
 *
 * @returns {BotRow[]|null}
 */
export function sampleBotsAt(ring, t) {
  if (!ring || ring.size === 0) return null;
  const n = newestBotSnap(ring);
  if (t >= n.ts) return copyRows(n.bots);
  const o = oldestBotSnap(ring);
  if (t <= o.ts) return copyRows(o.bots); // clamp to oldest (peer path skips; we keep, per spec)

  // Find the pair (a, b) with a.ts <= t < b.ts. Scan oldest→newest.
  let prev = null;
  for (let i = 0; i < ring.size; i++) {
    const idx = (ring.head + i) % ring.capacity;
    const snap = ring.buf[idx];
    if (snap.ts === t) return copyRows(snap.bots);
    if (snap.ts > t && prev) return interpRows(prev, snap, t);
    prev = snap;
  }
  return prev ? copyRows(prev.bots) : null;
}

// Interpolate each bot's position between frame a (older) and b (newer) at t.
// Bots are matched by id; radius + alive are taken from the older bound `a`
// (the state as of the rewind lower edge). A bot present only in `a` is passed
// through unchanged (it existed at the rewind instant).
function interpRows(a, b, t) {
  const dt = b.ts - a.ts;
  const u = dt <= 0 ? 0 : (t - a.ts) / dt;
  const bById = new Map();
  for (const r of b.bots) bById.set(r.id, r);
  const out = [];
  for (const ra of a.bots) {
    const rb = bById.get(ra.id);
    if (!rb) { out.push({ id: ra.id, x: ra.x, z: ra.z, footY: ra.footY, radius: ra.radius, alive: ra.alive }); continue; }
    out.push({
      id: ra.id,
      x: ra.x + (rb.x - ra.x) * u,
      z: ra.z + (rb.z - ra.z) * u,
      footY: ra.footY + (rb.footY - ra.footY) * u,
      radius: ra.radius,
      alive: ra.alive,
    });
  }
  return out;
}

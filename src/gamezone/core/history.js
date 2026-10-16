// src/gamezone/core/history.js — tick-indexed pose history (ADR-0130).
//
// The SAME structure backs the authority's lag compensation and the client's
// snapshot interpolation. The client renders `sample(id, renderTick)`; when it
// fires it reports that renderTick; the authority answers with
// `sample(id, renderTick)` over identical rows. Same data + same function ⇒ the
// authority tests the shot against exactly the pose the player was looking at.
//
// Row: { x, y, z, yaw, st, sp }  — y is the FOOT height, st 0 alive / 1 dying /
// 2 dead, sp the spawn sequence (bumps on every respawn so a teleporting respawn
// never interpolates across the arena).
// Node-pure.

import { HISTORY_TICKS } from './constants.js';
import { lerpAngle } from './geom.js';

export function createHistory(size = HISTORY_TICKS) {
  const ticks = new Int32Array(size).fill(-1);
  const frames = new Array(size).fill(null);
  let newest = -1;

  function record(tick, rows) {
    const i = ((tick % size) + size) % size;
    ticks[i] = tick; frames[i] = rows;
    if (tick > newest) newest = tick;
  }

  function frameAt(tick) {
    const i = ((tick % size) + size) % size;
    return ticks[i] === tick ? frames[i] : null;
  }

  /**
   * Interpolated pose at fractional tick `tf`, or null when the entity is absent
   * from both bracketing frames. Never extrapolates past the newest frame.
   */
  function sample(id, tf, out = {}) {
    if (!Number.isFinite(tf)) return null;
    if (tf > newest) tf = newest;
    const t0 = Math.floor(tf), a = tf - t0;
    const f0 = frameAt(t0), f1 = a > 0 ? frameAt(t0 + 1) : null;
    const p0 = f0 ? f0.get(id) : undefined;
    const p1 = f1 ? f1.get(id) : undefined;
    if (!p0 && !p1) return null;
    let src = null;
    if (!p1) src = p0;
    else if (!p0) src = p1;
    else if (p0.sp !== p1.sp || p0.st !== p1.st) src = a < 0.5 ? p0 : p1; // no lerp across lifecycle edges
    if (src) {
      out.x = src.x; out.y = src.y; out.z = src.z; out.yaw = src.yaw; out.st = src.st; out.sp = src.sp;
      return out;
    }
    out.x = p0.x + (p1.x - p0.x) * a;
    out.y = p0.y + (p1.y - p0.y) * a;
    out.z = p0.z + (p1.z - p0.z) * a;
    out.yaw = lerpAngle(p0.yaw, p1.yaw, a);
    out.st = p0.st; out.sp = p0.sp;
    return out;
  }

  return { record, frameAt, sample, get newest() { return newest; }, size };
}

/** Round to a fixed grid so the wire and the history hold byte-identical values. */
export const q2 = (n) => Math.round(n * 100) / 100;
export const q3 = (n) => Math.round(n * 1000) / 1000;

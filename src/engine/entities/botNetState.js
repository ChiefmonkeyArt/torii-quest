// engine/entities/botNetState.js — PURE client-side interpolation for the
// server-authoritative bots (chunk 2, v0.2.377-alpha).
//
// In multiplayer the client does NOT run the local bot AI (tickBots). Instead
// the server broadcasts MSG.BOT_STATE (a compact {id,x,z,rotY,hp,alive,animHint}
// array) at ~15Hz plus immediate discrete events (shot/hit/kill). This module
// buffers those continuous snapshots and produces a smoothly INTERPOLATED render
// pose per bot, rendered slightly in the past (interpDelayMs) so there is always
// a pair of samples to lerp between.
//
// SNAP (no interpolation) on discontinuities so a corpse never slides and a
// respawn never streaks across the arena:
//   • first sample for a bot (spawn)
//   • alive flips (kill: true→false, respawn: false→true)
//   • position error between consecutive samples exceeds SNAP_DIST (teleport)
//
// PURE: no THREE, no imports. Angles lerp the short way around the circle.

const DEFAULT_INTERP_DELAY_MS = 100; // render ~1.5 server ticks in the past
const DEFAULT_SNAP_DIST = 3;         // metres; larger jump → snap, don't slide
const MAX_SAMPLES = 6;               // ring depth per bot

export function createBotNetState(opts = {}) {
  const interpDelayMs = opts.interpDelayMs ?? DEFAULT_INTERP_DELAY_MS;
  const snapDist2 = (opts.snapDist ?? DEFAULT_SNAP_DIST) ** 2;

  /** @type {Map<number, {samples:Array<{t,x,z,rotY}>, hp:number, alive:boolean, animHint:string, snap:boolean}>} */
  const bots = new Map();

  // Ingest one BOT_STATE array (or a full-snapshot array). `nowMs` is the client
  // receive clock. Detects discontinuities and marks the bot to SNAP on next read.
  function ingest(states, nowMs) {
    if (!Array.isArray(states)) return;
    for (const s of states) {
      let b = bots.get(s.id);
      if (!b) {
        b = { samples: [], hp: s.hp, alive: s.alive, animHint: s.animHint, snap: true };
        bots.set(s.id, b);
      }
      // Discontinuity checks vs the previous sample.
      const prev = b.samples[b.samples.length - 1];
      if (b.alive !== s.alive) b.snap = true;
      if (prev) {
        const dx = s.x - prev.x, dz = s.z - prev.z;
        if (dx * dx + dz * dz > snapDist2) b.snap = true;
      }
      b.hp = s.hp;
      b.alive = s.alive;
      b.animHint = s.animHint;
      b.samples.push({ t: nowMs, x: s.x, z: s.z, rotY: s.rotY });
      if (b.samples.length > MAX_SAMPLES) b.samples.shift();
    }
  }

  // Force a snap on the next read for one bot (e.g. an immediate kill/respawn
  // event arrived out of band, before the next BOT_STATE).
  function forceSnap(id) { const b = bots.get(id); if (b) b.snap = true; }

  // Produce the interpolated render pose for every known bot at `nowMs`.
  // Returns [{ id, x, z, rotY, hp, alive, animHint, snap }]. `snap` is true when
  // the caller should hard-set (not lerp) this frame; it is consumed (reset) here.
  function sample(nowMs) {
    const renderT = nowMs - interpDelayMs;
    const out = [];
    for (const [id, b] of bots) {
      // On a discontinuity, hard-jump to the newest sample (no interpolation).
      const pose = b.snap ? _newest(b) : _poseAt(b, renderT);
      out.push({
        id,
        x: pose.x, z: pose.z, rotY: pose.rotY,
        hp: b.hp, alive: b.alive, animHint: b.animHint,
        snap: b.snap,
      });
      b.snap = false;
    }
    return out;
  }

  function _newest(b) {
    const s = b.samples;
    if (s.length === 0) return { x: 0, z: 0, rotY: 0 };
    const last = s[s.length - 1];
    return { x: last.x, z: last.z, rotY: last.rotY };
  }

  function _poseAt(b, renderT) {
    const s = b.samples;
    if (s.length === 0) return { x: 0, z: 0, rotY: 0 };
    if (s.length === 1) return { x: s[0].x, z: s[0].z, rotY: s[0].rotY };
    // Find the pair (a,b) with a.t <= renderT <= b.t.
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], c = s[i];
      if (renderT >= a.t && c.t > a.t) {
        const u = Math.min(1, Math.max(0, (renderT - a.t) / (c.t - a.t)));
        return {
          x: a.x + (c.x - a.x) * u,
          z: a.z + (c.z - a.z) * u,
          rotY: _lerpAngle(a.rotY, c.rotY, u),
        };
      }
    }
    // renderT older than all samples → oldest; newer than all → newest.
    const last = s[s.length - 1];
    if (renderT >= last.t) return { x: last.x, z: last.z, rotY: last.rotY };
    return { x: s[0].x, z: s[0].z, rotY: s[0].rotY };
  }

  function remove(id) { bots.delete(id); }
  function clear() { bots.clear(); }
  function has(id) { return bots.has(id); }

  return { ingest, sample, forceSnap, remove, clear, has, _bots: bots };
}

// Shortest-arc angle lerp.
function _lerpAngle(a, b, u) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

// Map the pure sim's animHint summary back to the raw flags BotModel.updateAnim
// expects: (dist, isShooting, isDeath, isHit).
export function animHintToFlags(animHint) {
  return {
    isShooting: animHint === 'shoot',
    isDeath: animHint === 'die',
    isHit: animHint === 'hit',
  };
}

// In MP the client is render-only: it must NEVER apply local bot damage (the
// server is the sole authority). Single-player keeps the local damage path.
export function shouldApplyLocalBotDamage(netMode) { return !netMode; }

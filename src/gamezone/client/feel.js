// src/gamezone/client/feel.js — Game Zone combat feel maths (ADR-0131).
//
// Pure, node-safe, allocation-free helpers behind the feel pass: what the
// hit marker says, which way a damage arc points, how loud/where a distant shot
// sounds, the flinch / screen-kick curves, and the latency + honesty meters that
// keep the feel measurable. No THREE, no DOM, no audio — gameZone.js, botView.js
// and hud.js turn these numbers into pixels, poses and sound.
//
// Nothing here can change an outcome: damage, HP and sats are decided by the
// shared sim (core/sim.js). Feedback is shown on the click's frame (prediction)
// and taken back if the authority rejects the shot.

import { FLINCH_BODY_RAD, FLINCH_HEAD_RAD, FLINCH_MS } from '../core/constants.js';

// ── hit markers ──────────────────────────────────────────────────────────────
/** Marker kinds, in rising order of emphasis. */
export const MARKER = Object.freeze({ BODY: 'body', HEAD: 'head', KILL: 'kill', HEADKILL: 'headkill' });
/** How long each marker stays on screen (ms). */
export const MARKER_MS = Object.freeze({ body: 160, head: 220, kill: 380, headkill: 460, sticker: 200 });
/** A rejected shot's marker is pulled within this many ms (fast fade). */
export const MARKER_VOID_MS = 70;

/** Which marker a (predicted) hit shows. */
export function markerKind(zone, lethal) {
  const head = zone === 'head';
  if (lethal) return head ? MARKER.HEADKILL : MARKER.KILL;
  return head ? MARKER.HEAD : MARKER.BODY;
}

// ── direction ────────────────────────────────────────────────────────────────
/**
 * Screen angle (radians) from the player's view to a world point: 0 = straight
 * ahead (top of the crosshair), +π/2 = to the right, ±π = behind. Matches the
 * player heading basis (forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)).
 */
export function screenAngleTo(px, pz, yaw, sx, sz) {
  const vx = sx - px, vz = sz - pz;
  if (vx * vx + vz * vz < 1e-8) return 0;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const fwd = -s * vx - c * vz;
  const right = c * vx - s * vz;
  return Math.atan2(right, fwd);
}

// ── spatial audio ────────────────────────────────────────────────────────────
export const AUDIO_NEAR = 6;    // m — full volume inside this
export const AUDIO_FAR = 90;    // m — silent beyond this
export const AUDIO_FLOOR = 0.06;
export const AUDIO_PAN_MAX = 0.8;

/**
 * Gain + stereo pan for a shot heard at distance. Writes {gain, pan} into `out`
 * (gain 0 means "do not play"). Inverse-distance roll-off with a floor so far
 * fights stay audible but clearly distant.
 */
export function shotMix(px, pz, yaw, sx, sz, out = { gain: 0, pan: 0 }) {
  const d = Math.hypot(sx - px, sz - pz);
  if (!(d <= AUDIO_FAR)) { out.gain = 0; out.pan = 0; return out; }
  const g = d <= AUDIO_NEAR ? 1 : Math.pow(AUDIO_NEAR / d, 1.2);
  out.gain = Math.max(AUDIO_FLOOR, Math.min(1, g));
  const a = screenAngleTo(px, pz, yaw, sx, sz);
  out.pan = Math.max(-AUDIO_PAN_MAX, Math.min(AUDIO_PAN_MAX, Math.sin(a) * AUDIO_PAN_MAX));
  return out;
}

// ── curves ───────────────────────────────────────────────────────────────────
const FLINCH_ATTACK = 0.18; // fraction of FLINCH_MS spent leaning in

/** Flinch envelope 0→1→0 over FLINCH_MS (fast attack, eased recovery). */
export function flinchEnvelope(elapsedMs) {
  if (!(elapsedMs >= 0) || elapsedMs >= FLINCH_MS) return 0;
  const x = elapsedMs / FLINCH_MS;
  if (x < FLINCH_ATTACK) return x / FLINCH_ATTACK;
  const r = 1 - (x - FLINCH_ATTACK) / (1 - FLINCH_ATTACK);
  return r * r;
}

/** Peak flinch lean (radians) for a hit zone. Never exceeds FLINCH_HEAD_RAD. */
export function flinchPeak(zone) { return zone === 'head' ? FLINCH_HEAD_RAD : FLINCH_BODY_RAD; }

/**
 * Lean (rotation.x, rotation.z) in the bot's LOCAL frame that tips its top
 * along the world shot direction (dx, dz) by `amount` radians. Writes into out.
 */
export function leanFromShot(dx, dz, botYaw, amount, out = { x: 0, z: 0 }) {
  const L = Math.hypot(dx, dz);
  if (L < 1e-6 || !(amount > 0)) { out.x = 0; out.z = 0; return out; }
  const s = Math.sin(botYaw), c = Math.cos(botYaw);
  // world → holder-local (inverse yaw about +Y)
  const lx = (c * dx - s * dz) / L, lz = (s * dx + c * dz) / L;
  out.x = amount * lz;   // Rx(+θ) tips +Y toward +Z
  out.z = -amount * lx;  // Rz(−θ) tips +Y toward +X
  return out;
}

export const KICK_MS = 110;
export const KICK_HEAD_RAD = 0.012;  // camera ROLL only — the aim line never moves
export const KICK_KILL_RAD = 0.008;

/** Screen-kick roll (radians) at elapsed ms; damped one-and-a-half wobble. */
export function kickRoll(elapsedMs, peak) {
  if (!(elapsedMs >= 0) || elapsedMs >= KICK_MS || !peak) return 0;
  const x = elapsedMs / KICK_MS;
  return peak * Math.sin(x * Math.PI * 3) * (1 - x) * (1 - x);
}

// ── gun recoil (arena) ───────────────────────────────────────────────────────
export const RECOIL_MS = 95;
export const RECOIL_BACK = 0.06;   // m — z-kick toward the camera
export const RECOIL_CLIMB = 0.075; // rad — muzzle climb

/**
 * Recoil pose at elapsed ms: instant kick, eased return. Writes {back, climb}.
 * `scale` sizes the same curve for other guns (NAP sticker gun: ADR-0132).
 */
export function recoilPose(elapsedMs, out = { back: 0, climb: 0 }, scale = 1) {
  if (!(elapsedMs >= 0) || elapsedMs >= RECOIL_MS) { out.back = 0; out.climb = 0; return out; }
  const r = 1 - elapsedMs / RECOIL_MS;
  const e = r * r * (3 - 2 * r); // smoothstep: holds the kick, then settles
  const k = scale > 0 ? scale : 1;
  out.back = RECOIL_BACK * e * k;
  out.climb = RECOIL_CLIMB * e * k;
  return out;
}

// ── meters ───────────────────────────────────────────────────────────────────
/**
 * Feel meter: click→first-frame latency ring (ms) and marker honesty counts.
 * Fixed Float64Array ring — no growth, no per-sample allocation.
 */
export function createFeelMeter(size = 64) {
  const ring = new Float64Array(size);
  const sorted = new Float64Array(size);
  let n = 0, head = 0, waitingSince = -1;
  const c = { markers: 0, voided: 0, kills: 0, killsConfirmed: 0, damageArcs: 0 };

  return {
    counts: c,
    /** A shot was fired (input timestamp, performance.now() clock). */
    shotAt(t) { waitingSince = Number.isFinite(t) ? t : -1; },
    /** The first frame after a shot started rendering at `t`. */
    frameAt(t) {
      if (waitingSince < 0) return;
      const ms = t - waitingSince;
      waitingSince = -1;
      if (!(ms >= 0) || ms > 5000) return;
      ring[head] = ms; head = (head + 1) % size; if (n < size) n++;
    },
    marker() { c.markers++; },
    voided() { c.voided++; },
    stats() {
      for (let i = 0; i < n; i++) sorted[i] = ring[i];
      const v = sorted.subarray(0, n);
      v.sort();
      const q = (p) => (n ? Math.round(v[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))] * 10) / 10 : null);
      return {
        samples: n,
        clickToFrameMs: { p50: q(0.5), p95: q(0.95), max: n ? Math.round(v[n - 1] * 10) / 10 : null },
        markers: c.markers, voided: c.voided,
        voidPct: c.markers ? Math.round((1000 * c.voided) / c.markers) / 10 : 0,
        kills: c.kills, killsConfirmed: c.killsConfirmed, damageArcs: c.damageArcs,
      };
    },
    reset() { n = 0; head = 0; waitingSince = -1; for (const k of Object.keys(c)) c[k] = 0; },
  };
}

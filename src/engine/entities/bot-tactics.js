// engine/entities/bot-tactics.js — pure tactics/steering LAYER over the stateful
// bot runtime in src/bots.js (M4-G1, v0.2.348).
//
// This is a BOUNDED, dependency-light layer: difficulty tiers, deterministic
// flank-slot assignment + anchors, cover-point precompute + scoring, and cheap
// obstacle-avoidance steering. It imports ONLY numeric tuning from config.js — no
// Three, no Rapier, no DOM — so every function is unit-testable in plain node and
// can later move behind the pure bot-agent.js seam without a rewrite.
//
// The stateful runtime (tick/shoot/cooldown/death/respawn) stays in src/bots.js;
// bots.js reads these helpers with pre-allocated scratch objects so the hot path
// stays allocation-free. Non-hot helpers (buildCoverPoints, pickCover) run once at
// init or on a staggered per-bot timer, never every frame for every bot.
import { BOT_SPEED, BOT_SIGHT, BOT_SHOOT_CD, BOT_SPREAD } from '../../config.js';

// ── Difficulty tiers ─────────────────────────────────────────────────────────
// Data-driven params table. Tuning is pure data — changing balance needs no logic
// rewrite. Scales are multipliers on the shared base constants so `normal` == the
// pre-M4-G1 behaviour (sightScale/speedScale/cooldownScale/aimError all 1.0):
//   sightScale    × BOT_SIGHT     — acquisition range (normal keeps the 14m contract)
//   speedScale    × BOT_SPEED     — move speed
//   reaction (s)  — LOS dwell required before the first shot after acquiring
//   aimError      × BOT_SPREAD    — bullet cone (higher = worse aim)
//   cooldownScale × BOT_SHOOT_CD  — time between shots (lower = faster fire)
//   coverBias     [0..1]          — probability of seeking cover when pressured
//   flankBias     [0..1]          — how wide the bot rings the player when flanking
//   persistence   [0..1]          — tendency to hold a chosen cover point
export const BOT_TIERS = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    sightScale: 0.8, speedScale: 0.8, reaction: 0.55,
    aimError: 1.9, cooldownScale: 1.35, coverBias: 0.2, flankBias: 0.25, persistence: 0.35,
  }),
  normal: Object.freeze({
    id: 'normal',
    sightScale: 1.0, speedScale: 1.0, reaction: 0.28,
    aimError: 1.0, cooldownScale: 1.0, coverBias: 0.5, flankBias: 0.6, persistence: 0.65,
  }),
  hard: Object.freeze({
    id: 'hard',
    sightScale: 1.15, speedScale: 1.18, reaction: 0.12,
    aimError: 0.55, cooldownScale: 0.8, coverBias: 0.85, flankBias: 0.95, persistence: 1.0,
  }),
});

// Deterministic per-bot tier tag by spawn index — a fixed rotation so a fresh
// arena always has the same noticeable mix (2 hard / 2 normal / 1 easy at
// BOT_COUNT=5) with no Math.random at assignment time.
const TIER_ROTATION = Object.freeze(['normal', 'hard', 'normal', 'easy', 'hard']);
export function tierForIndex(i) {
  const n = TIER_ROTATION.length;
  return BOT_TIERS[TIER_ROTATION[((i % n) + n) % n]];
}

// Effective acquisition range for a tier (pure). Never below the BOT_SIGHT
// contract for `normal` (sightScale 1.0) — see the safe-zone regression guard.
export function effectiveSight(tier) { return BOT_SIGHT * tier.sightScale; }
// Effective cooldown / spread for a tier (pure) — used by the shoot block.
export function effectiveCooldown(tier, baseCooldown = BOT_SHOOT_CD) { return baseCooldown * tier.cooldownScale; }
export function effectiveSpread(tier) { return BOT_SPREAD * tier.aimError; }
export function effectiveSpeed(tier, baseSpeed = BOT_SPEED) { return baseSpeed * tier.speedScale; }

// ── Flanking ─────────────────────────────────────────────────────────────────
// Four deterministic angle slots around the player. Slot is chosen by bot index
// so multiple bots approach from spread angles (pressure / left / right / rear)
// instead of forming a conga line. Angles are offsets applied to the current
// player→bot bearing, so the ring auto-orients to wherever the squad is.
export const FLANK_SLOTS = Object.freeze([
  Object.freeze({ id: 'pressure', angle: 0 }),
  Object.freeze({ id: 'left', angle: Math.PI * 0.5 }),
  Object.freeze({ id: 'right', angle: -Math.PI * 0.5 }),
  Object.freeze({ id: 'rear', angle: Math.PI }),
]);
export function flankSlotForIndex(i) {
  const n = FLANK_SLOTS.length;
  return FLANK_SLOTS[((i % n) + n) % n];
}

// Base ring radius the flank anchors sit at around the player (metres).
export const FLANK_RADIUS = 6.0;

// Compute the world-space flank anchor for a bot. `out` is a caller-owned scratch
// { x, z } (allocation-free). radiusScale lets a tier widen/narrow the ring.
export function flankAnchor(px, pz, bx, bz, slotAngle, radiusScale, out) {
  const base = Math.atan2(bz - pz, bx - px); // bearing player→bot
  const a = base + slotAngle;
  const r = FLANK_RADIUS * (0.7 + 0.6 * radiusScale); // flankBias widens the ring
  out.x = px + Math.cos(a) * r;
  out.z = pz + Math.sin(a) * r;
  return out;
}

// ── Cover ────────────────────────────────────────────────────────────────────
// Precompute cover candidate points around each box (crate/obstacle) ONCE at
// arena init: four points offset outward from the box centre on ±X / ±Z by
// (half-extent + margin). `boxes` rows are [cx, cz, hw, hd, ...] (CRATES shape).
export function buildCoverPoints(boxes, margin) {
  const pts = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = b[0], cz = b[1], hw = b[2], hd = b[3];
    const ox = hw + margin, oz = hd + margin;
    pts.push([cx + ox, cz], [cx - ox, cz], [cx, cz + oz], [cx, cz - oz]);
  }
  return pts;
}

// Pick the best cover point for a bot: the NEAREST candidate (within maxDist of
// the bot) whose line from the player is BLOCKED by static geometry. `blocked` is
// a caller-supplied predicate (px,pz,cx,cz)->bool that runs the actual LOS ray —
// candidates beyond maxDist are distance-culled BEFORE the ray so we never cast
// for far points. Returns the index into `points`, or -1 if none qualifies.
export function pickCover(bx, bz, px, pz, points, blocked, maxDist) {
  let best = -1;
  let bestDist = Infinity;
  const maxDist2 = maxDist * maxDist;
  for (let i = 0; i < points.length; i++) {
    const cx = points[i][0], cz = points[i][1];
    const dbx = cx - bx, dbz = cz - bz;
    const d2 = dbx * dbx + dbz * dbz;
    if (d2 > maxDist2) continue;          // cheap cull before the expensive ray
    if (d2 >= bestDist) continue;          // can't beat the current best
    if (!blocked(px, pz, cx, cz)) continue; // not actually cover from the player
    bestDist = d2;
    best = i;
  }
  return best;
}

// ── Obstacle avoidance (cheap analytic feelers) ──────────────────────────────
// Accumulate a steering vector that pushes the bot away from nearby boxes and
// side-steps around any box it is heading straight into (so it slides past cover
// instead of stalling head-on). No navmesh, no per-bot raycast — a bounded loop
// over the small static box list. `out` is caller-owned scratch { x, z }.
//   (bx,bz)      bot position
//   (dirx,dirz)  desired (normalised) heading
//   boxes        [cx,cz,hw,hd,...] rows (CRATES shape)
//   influence    extra radius beyond the box half-extent where repulsion begins
export function obstacleAvoid(bx, bz, dirx, dirz, boxes, influence, out) {
  out.x = 0; out.z = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = b[0], cz = b[1], hw = b[2], hd = b[3];
    const dx = bx - cx, dz = bz - cz;
    const reach = (hw > hd ? hw : hd) + influence;
    const d = Math.hypot(dx, dz);
    if (d > reach || d < 1e-6) continue;
    const w = 1 - d / reach;        // 0 at the edge of influence → 1 at the centre
    const ax = dx / d, az = dz / d; // unit vector away from the box
    out.x += ax * w; out.z += az * w;
    // Heading toward this box? add a tangential side-step so we go around it.
    const towards = dirx * -ax + dirz * -az;
    if (towards > 0) {
      const perpx = -az, perpz = ax;
      const side = (dirx * perpx + dirz * perpz) >= 0 ? 1 : -1;
      out.x += perpx * side * w; out.z += perpz * side * w;
    }
  }
  return out;
}

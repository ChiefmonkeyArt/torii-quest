// engine/gateway/portalApproach.js — PURE, node-safe APPROACH-AFFORDANCE view-model
// for the in-world GATEWAY PORTAL marker (v0.2.294). It grades the player's proximity
// to a portal into three phases — idle → approaching → ready — and emits a normalised
// closeness `t`, a glow `intensity` (the host hands this to `portalMesh.setPortalApproach`),
// and a phase-appropriate prompt label. This promotes the binary in-range/out-of-range
// marker into a gate that visibly "wakes" as the traveller nears.
//
// Constrained by construction:
//   - DISPLAY-ONLY + INERT. It computes plain numbers/strings from positions; it never
//     navigates, performs, signs, publishes, fetches, or touches a window/DOM/THREE.
//     The `ready` threshold EQUALS the trigger range, so this never arms or confirms a
//     hop — the v0.2.181 portalTrigger remains the sole proximity→confirm authority.
//   - PLANAR. Distance is measured on the ground plane (x,z) only, so jumping/crouching
//     near the gate does not change the affordance.
//   - PURE + allocation-light. A scalar sqrt + one small plain object; no Vector3.

// PORTAL_APPROACH_VERSION — bumped when the returned shape changes.
export const PORTAL_APPROACH_VERSION = 1;

// The three approach phases. `ready` mirrors the portalTrigger arm range exactly.
export const APPROACH_PHASE = Object.freeze({
  idle: 'idle',
  approaching: 'approaching',
  ready: 'ready',
});

// The approach band extends to APPROACH_BAND_FACTOR × range beyond the arm radius, so
// the gate begins to brighten while the player is still walking toward it.
export const APPROACH_BAND_FACTOR = 3;

// Glow scalar bounds the host applies to the torii-frame emissive. `min` at the band
// edge (idle), `max` once in range (ready). Kept modest so the gate reads as inert.
export const APPROACH_GLOW = Object.freeze({ min: 0.35, max: 1.05 });

// Prompt raised once the player is in range — parity with portalTrigger's PORTAL_PROMPT_TEXT.
export const APPROACH_READY_TEXT = 'Press F to travel';

function _finite(n) { return typeof n === 'number' && Number.isFinite(n); }

// _planarDist(a, b) → ground-plane (x,z) distance; scalar only, no allocation.
function _planarDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function _clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// portalApproachState(opts?) → the graded approach affordance.
//
//   opts {
//     playerPos: { x, z }  — the player's world position (y ignored)
//     portalPos: { x, z }  — the portal's world position (the trigger's portalPos)
//     range:     number    — the trigger arm radius (default 3); `ready` at/within it
//     title:     string    — display label, woven into the approaching prompt
//   }
//
// Returns:
//   { version, ok, phase, distance, t, intensity, prompt, inRange, reason? }
//
// Pure — never throws; bad input degrades to an idle, ok:false result.
export function portalApproachState(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const pp = o.playerPos;
  const qp = o.portalPos;
  const r = Number(o.range);
  const range = r > 0 && Number.isFinite(r) ? r : 3;
  const title = typeof o.title === 'string' && o.title ? o.title : 'Gateway';

  if (!pp || !qp || !_finite(pp.x) || !_finite(pp.z) || !_finite(qp.x) || !_finite(qp.z)) {
    return {
      version: PORTAL_APPROACH_VERSION,
      ok: false,
      phase: APPROACH_PHASE.idle,
      distance: Infinity,
      t: 0,
      intensity: APPROACH_GLOW.min,
      prompt: '',
      inRange: false,
      reason: 'invalid-input',
    };
  }

  const distance = _planarDist(pp, qp);
  const band = range * APPROACH_BAND_FACTOR;

  let phase;
  let t;
  let inRange = false;
  if (distance <= range) {
    phase = APPROACH_PHASE.ready;
    t = 1;
    inRange = true;
  } else if (distance <= band) {
    phase = APPROACH_PHASE.approaching;
    t = _clamp01((band - distance) / (band - range));
  } else {
    phase = APPROACH_PHASE.idle;
    t = 0;
  }

  const intensity = APPROACH_GLOW.min + (APPROACH_GLOW.max - APPROACH_GLOW.min) * t;
  const prompt = phase === APPROACH_PHASE.ready
    ? APPROACH_READY_TEXT
    : phase === APPROACH_PHASE.approaching
      ? `${title} ahead`
      : '';

  return {
    version: PORTAL_APPROACH_VERSION,
    ok: true,
    phase,
    distance,
    t,
    intensity,
    prompt,
    inRange,
  };
}

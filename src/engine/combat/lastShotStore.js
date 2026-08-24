// engine/combat/lastShotStore.js — pure diagnostic store for the most recent
// player shot + miss. No three/Rapier/DOM imports, so it is unit-testable in a
// plain node vitest run (weapons.js itself pulls in scene.js → WebGLRenderer).
//
// ADR-0046 (v0.2.667): added `combat.lastSentShot` — the ACTUAL buildShotPayload
// output that went to the server, with full muzzle/aim vectors + which ray was used:
// {ts,viewLag,usedAimRay,sentOrigin,sentDir,muzzleOrigin,muzzleDir,aimOrigin,aimDir}.
// This lets the ema prove whether the camera aim ray or the muzzle ray was sent for a
// given shot, which is the open question in the bot hit-miss investigation.
// (The old y-only `lastShot.sent` field is kept for backwards compat, but it is
// CONVENIENCE only — the camera-vs-muzzle decision reads `lastSentShot` directly.)

let _lastShot = null;  // most recent fired player shot (predicted + resolved)
let _lastMiss = null;  // most recent player shot that did NOT hit a live bot
// ADR-0046 v0.2.667: independent of _lastShot so it is NEVER stale. _lastShot is
// only created inside recordPlayerShot, which is gated on `if (aimOrigin && aimDir)`
// in arenaRuntime — so in the usedAimRay=false failure case there is NO fresh
// _lastShot to attach `sent` to. _lastSentShot is written directly from the SHOOT
// handler on EVERY arena shot, independent of that gate.
let _lastSentShot = null;

export function getLastShot() { return _lastShot; }
export function getLastMiss() { return _lastMiss; }
export function setLastShot(d) { _lastShot = d; }
export function setLastMiss(d) { _lastMiss = d; }
export function getLastSentShot() { return _lastSentShot; }
export function setLastSentShot(d) { _lastSentShot = d; }

// ADR-0046 v0.2.667: record what buildShotPayload ACTUALLY sent to the server,
// so the ema can prove whether the camera aim ray or the muzzle ray was used.
// Also stamps onto _lastShot when one exists (convenience only — NOT the source
// of truth; use getLastSentShot() for the camera-vs-muzzle decision).
export function setLastShotSent(sent) { if (_lastShot) _lastShot.sent = sent; }

export function mkTarget() { return { kind: 'none', isHead: false, botName: null, dist: Infinity }; }

export function mkDiag() {
  return {
    origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
    aim: mkTarget(),      // camera/crosshair ray at fire time
    pred: mkTarget(),     // bullet line at fire time (if nothing moved)
    outcome: mkTarget(),  // what the bullet actually resolved to
    predicted: null,       // {reason,label} aim-vs-pred, computed at fire
    reason: null, label: null, // {reason,label} aim-vs-outcome, set at resolution
    resolved: false, flightTime: 0,
    sent: null,           // ADR-0046 v0.2.667: actual buildShotPayload output sent
  };
}

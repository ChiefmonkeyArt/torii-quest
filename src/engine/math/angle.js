// engine/math/angle.js — O(1), non-finite-safe angle normalisation.
//
// v0.2.778-alpha (Bug L — hard title-screen freeze): the codebase normalised
// angles with `while (d > Math.PI) d -= 2*Math.PI` loops. Those are correct for
// finite inputs but become an INFINITE LOOP the instant `d` is ±Infinity (or a
// NaN-producing value that never satisfies the exit condition) — subtracting a
// finite 2π from ±Infinity is still ±Infinity, so the `while` never exits. A
// single such loop inside the per-frame update blocks the main thread forever:
// the page is frozen, no click/keystroke lands, and even a hard refresh cannot
// recover it (the task never yields back to the browser). The user hit exactly
// this — "frozen, nothing clickable, must close the tab" — after entering the
// arena (NPC walk + bot angle-lerp run warm behind the title screen per
// ADR-0098's warm-world keep-alive).
//
// This replaces every angle-normalisation `while` with a single-shot, branch-free
// wrap that is O(1) and mathematically CANNOT loop on any input: `%` on a finite
// operand always terminates, and non-finite input is clamped to a safe neutral
// value (0) so a poisoned GLB-animation quaternion or an upstream divide-by-zero
// can never wedge the render loop again.
export function normalizeAngle(d) {
  // Clamp non-finite (NaN / ±Infinity) to a neutral heading rather than letting
  // it poison the rotation and everything downstream. 0 is the identity yaw.
  if (!Number.isFinite(d)) return 0;
  const TAU = Math.PI * 2;
  // Single-shot wrap to [-π, π): the double-modulo handles JavaScript's negative
  // remainder so negative angles land on the correct side of the circle.
  return ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}
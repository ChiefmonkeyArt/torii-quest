// engine/weapons/reloadPose.js — pure reload viewmodel pose curve (v0.2.127).
// Imports nothing (no Three/Rapier/browser) so it is unit-testable in node and
// allocation-free: returns a single scalar "dip" the viewmodel scales its
// rest-offsets by.
//
// Feel: "click down, clack snap back" — a quick ease-out DROP to fully lowered,
// a brief HOLD at the bottom (the "clack"), then a fast SNAP-BACK that slightly
// overshoots above rest, and a short SETTLE back to rest. The whole curve runs
// over normalized reload progress p in [0,1] (p = 1 - reloadTimer/RELOAD_TIME),
// so RELOAD_TIME / audio timing is unchanged — only the visual shape changed
// from the old symmetric sin(p*pi) hump.
//
// Returned dip range: rest = 0, fully lowered = 1, slight snap-back overshoot =
// -RELOAD_OVERSHOOT (gun kicks a touch above rest before settling). The
// viewmodel applies it as REST - AMP*dip, so a negative dip raises the gun.

// Phase boundaries in normalized progress.
export const RELOAD_DROP_END   = 0.12; // quick click-down
export const RELOAD_HOLD_END   = 0.68; // hold lowered (the "clack" window)
export const RELOAD_SETTLE_END = 0.86; // fast snap-back through rest into overshoot
export const RELOAD_OVERSHOOT  = 0.12; // how far above rest the snap-back kicks

function easeOutCubic(x) {
  const u = 1 - x;
  return 1 - u * u * u;
}

// dip(p): 0 at p<=0 and p>=1 (rest), 1 while lowered, dips to -RELOAD_OVERSHOOT
// during the snap-back, then eases back to 0.
export function reloadDip(p) {
  if (p <= 0 || p >= 1) return 0;

  // 1) DROP — quick ease-out down to fully lowered.
  if (p < RELOAD_DROP_END) {
    return easeOutCubic(p / RELOAD_DROP_END);
  }

  // 2) HOLD — stay fully lowered through the body of the reload.
  if (p < RELOAD_HOLD_END) {
    return 1;
  }

  // 3) SNAP-BACK — fast rise from lowered (1) up through rest and into a small
  //    overshoot above rest (-RELOAD_OVERSHOOT).
  if (p < RELOAD_SETTLE_END) {
    const x = (p - RELOAD_HOLD_END) / (RELOAD_SETTLE_END - RELOAD_HOLD_END);
    return 1 - (1 + RELOAD_OVERSHOOT) * easeOutCubic(x);
  }

  // 4) SETTLE — ease the overshoot back down to rest (0).
  const x = (p - RELOAD_SETTLE_END) / (1 - RELOAD_SETTLE_END);
  return -RELOAD_OVERSHOOT * (1 - easeOutCubic(x));
}

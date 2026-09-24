// engine/world/portalWindowSpec.js — the pure placement math for the WORLD-SPACE
// portal WINDOW (ADR-0124). Where the old ADR-0118 iris drew a fullscreen circle in
// screen space, the window is a flat rectangle standing INSIDE the travel gate opening:
// "the Lion, the Witch and the Wardrobe" — look at the wardrobe (gate) and see through
// it into another dimension. The tests lock these dimensions so the window always fits
// within the gate's posts + crossbeam.
//
// Pure + node-safe: no THREE/Rapier/DOM. Returns plain objects.

// The travel gateway GLB (`torii-gateway-experience.glb`) is a torii scaled to height
// `WALL_H * 1.6` ≈ 4.16. Its natural bounds are width 0.937 × height 0.9995, so at that
// scale the post-to-post span is ~3.90 and the height ~4.16. The window is sized to sit
// between the pillars and below the crossbeam, leaving the wooden frame visible around it.
export const PORTAL_WINDOW_WIDTH = 3.0;   // between the two pillars (~3.9 span)
export const PORTAL_WINDOW_HEIGHT = 3.6;  // ground up to just under the crossbeam (~4.16)
export const PORTAL_WINDOW_CENTER_Y = 1.8; // window centre above the gate's ground line

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compose the world-space placement of the portal window from the gate's anchor.
 *
 * @param {{ gateX?:number, gateY?:number, gateZ?:number, yaw?:number }} [args]
 *   gateX/gateZ — the gate's ground anchor (typically TRAVEL_GATE_X / sampleNapHeight / Z).
 *   gateY — the ground level at the gate (feet on the floor).
 *   yaw — the window's Y rotation so it faces the approaching player (defaults to π:
 *         the plane's +Z normal turns to face the player coming from −Z).
 * @returns {{ position:{x,y,z}, width:number, height:number, rotationY:number }}
 */
export function portalWindowSpec({ gateX, gateY, gateZ, yaw } = {}) {
  return {
    position: {
      x: _num(gateX),
      y: _num(gateY) + PORTAL_WINDOW_CENTER_Y,
      z: _num(gateZ),
    },
    width: PORTAL_WINDOW_WIDTH,
    height: PORTAL_WINDOW_HEIGHT,
    rotationY: Number.isFinite(Number(yaw)) ? Number(yaw) : Math.PI,
  };
}
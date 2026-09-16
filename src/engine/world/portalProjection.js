// engine/world/portalProjection.js — project the GATE onto the screen (ADR-0118).
//
// The last pure step before the WebGL surface: given the viewer camera, a gate's
// world-space centre + aperture radius, and the viewport size, compute the gate's
// screen-space centre and aperture radius in ASPECT-CORRECTED UV (ACUV), plus the
// fullscreen factor the iris needs to cover the viewport. PURE 3D math (three
// Vector3/Matrix4 + a PerspectiveCamera projection), no WebGL — node-testable.
//
// ACUV convention (matches the surface's full-screen quad): one unit = screen
// HEIGHT in both axes, so `d = length(vUv - uCenter)/uAperture` is aspect-correct
// and a circle stays round. `vUv.x` is multiplied by `aspect` in the vertex shader.

import { Vector3 } from 'three';

const _c = new Vector3();
const _edge = new Vector3();
const _right = new Vector3();

/** Guard: is `v` a point actually in front of the camera (w handled by project)? */
function _inFront(ndc) {
  return Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z) && ndc.z <= 1.0;
}

/**
 * Project a gate through the camera to aspect-corrected UV.
 *
 * @param {{ camera:any, viewWidth:number, viewHeight:number,
 *           gateCenter:{x:number,y:number,z:number}, apertureRadius:number }} args
 *   `camera` is a three PerspectiveCamera with a live matrixWorldInverse +
 *   projectionMatrix (call updateMatrixWorld/updateProjectionMatrix first).
 * @returns {{ ok:boolean, centerU:{x:number,y:number}, centerV:number, aspect:number,
 *             aperture:number, fullFactor:number, onScreen:boolean }}
 *   centerU/centerV + aperture are in ACUV units (screen-height = 1). fullFactor is
 *   the iris radius (aperture units) that reaches the furthest screen corner (>=1).
 *   `ok:false` on bad input; the caller treats an off/behind-camera gate as idle.
 */
export function gateScreenProjection({ camera, viewWidth, viewHeight, gateCenter, apertureRadius } = {}) {
  const w = Number(viewWidth);
  const h = Number(viewHeight);
  const g = gateCenter;
  const r = Number(apertureRadius);
  if (!camera || !(w > 0) || !(h > 0) || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.z) || !(r >= 0)) {
    return { ok: false, centerU: 0, centerV: 0, aspect: w / h, aperture: 0, fullFactor: 1, onScreen: false };
  }
  const aspect = w / h;

  // Camera basis in world space (right/up) so the aperture edge is measured along the
  // actual screen plane, not world axes.
  _right.setFromMatrixColumn(camera.matrixWorld, 0);

  const center = _c.set(g.x, g.y, g.z).project(camera);
  const edgePt = _edge.set(
    g.x + _right.x * r,
    g.y + _right.y * r,
    g.z + _right.z * r,
  ).project(camera);

  if (!_inFront(center)) {
    return { ok: true, centerU: 0, centerV: 0, aspect, aperture: 0, fullFactor: 1, onScreen: false };
  }

  // NDC (-1..1) → pixels → ACUV (÷ screen height). x is scaled by aspect so it is in
  // screen-height units.
  const px = (ndc) => (ndc.x * 0.5 + 0.5) * w / h;   // ACUV.x = pixelX / h
  const py = (ndc) => (ndc.y * 0.5 + 0.5);           // ACUV.y = pixelY / h

  const centerU = px(center);
  const centerV = py(center);
  const edgeU = Number.isFinite(edgePt.x) ? px(edgePt) : centerU;
  const edgeV = Number.isFinite(edgePt.y) ? py(edgePt) : centerV;
  const aperture = Math.hypot(edgeU - centerU, edgeV - centerV);

  // Furthest screen corner distance (ACUV) → fullscreen iris radius in aperture units.
  const corners = [
    [0, 0], [aspect, 0], [0, 1], [aspect, 1], // ACUV corners: x in [0,aspect], y in [0,1]
  ];
  let cornerDist = 0;
  for (const [cx, cy] of corners) {
    cornerDist = Math.max(cornerDist, Math.hypot(cx - centerU, cy - centerV));
  }
  const fullFactor = aperture > 1e-5 ? Math.max(1, cornerDist / aperture) : 1;

  return {
    ok: true,
    centerU,
    centerV,
    aspect,
    aperture,
    fullFactor,
    onScreen: center.x >= -1.2 && center.x <= 1.2 && center.y >= -1.2 && center.y <= 1.2,
  };
}
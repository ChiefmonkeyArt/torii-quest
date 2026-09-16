// engine/world/portalSurfaceUniforms.js — compose the FULL per-frame uniform state for
// the iris/sky-resolve surface (ADR-0118). The "last pure step" bridge between the
// tested math (portalProjection + portalReveal + portalUniforms) and the WebGL quad:
// project the gate, derive the reveal radius + sky blend, and convert the skies to
// linear. PURE (three Vector/Camera math only, no WebGL) and node-testable, so the
// exact values the shader consumes are locked before any pixel is drawn.

import { gateScreenProjection } from './portalProjection.js';
import { revealState } from './portalReveal.js';
import { portalFrameState } from './portalUniforms.js';

/**
 * The uniform struct for one reveal frame.
 *
 * @param {{ camera:any, viewWidth:number, viewHeight:number,
 *           gateCenter:{x,y,z}, apertureRadius:number,
 *           mode?:string, t?:number, skyAHex?:string, skyBHex?:string,
 *           soft?:number, active?:boolean }} args
 * @returns {{ active:boolean, onScreen:boolean, aspect:number,
 *             centerX:number, centerY:number, aperture:number, fullFactor:number,
 *             iris:number, skyBlend:number, soft:number,
 *             skyA:{r,g,b}, skyB:{r,g,b} }}
 *   ACUV: centerX ∈ [0,aspect], centerY ∈ [0,1], aperture in screen-height units; iris is
 *   the mask radius in aperture units (1 = gate opening, ≥1 = toward fullscreen).
 *   `active:false` (or an off/behind-camera gate) tells the host to draw nothing.
 */
export function portalSurfaceUniforms({
  camera, viewWidth, viewHeight, gateCenter, apertureRadius,
  mode, t, skyAHex, skyBHex, soft, active = true,
} = {}) {
  const proj = gateScreenProjection({ camera, viewWidth, viewHeight, gateCenter, apertureRadius });
  const rs = revealState({ mode, t, fullFactor: proj.fullFactor });
  const fs = portalFrameState({
    timeline: { iris: rs.radius, skyBlend: rs.skyBlend },
    skyA: { color: skyAHex },
    skyB: { color: skyBHex },
    soft,
  });

  return {
    active: !!active && proj.ok && proj.onScreen,
    onScreen: proj.onScreen,
    aspect: proj.aspect,
    centerX: proj.centerU,
    centerY: proj.centerV,
    aperture: proj.aperture,
    fullFactor: proj.fullFactor,
    iris: fs.uIris,
    skyBlend: fs.uSkyBlend,
    soft: fs.uSoft,
    skyA: fs.uSkyA,
    skyB: fs.uSkyB,
  };
}
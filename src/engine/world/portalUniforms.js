// engine/world/portalUniforms.js — bind the iris/sky timeline to the portal shader
// uniforms (ADR-0118). The last pure step before the WebGL surface: convert a frame
// from irisReveal.mirrorTimeline + the two world.json sky descriptors into the exact
// uniform struct portalShader consumes (uIris, uSkyBlend, uSkyA/uSkyB as LINEAR vec3,
// uSoft). Node-pure and unit-testable; the renderer is a dumb sink for these values.

import { clamp01 } from './irisReveal.js';

/** sRGB → linear light (per IEC 61966-2-1). c clamped to [0,1]. */
export function srgbToLinear(c) {
  const x = clamp01(c);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

const _HEX6 = /^#?([0-9a-f]{6})$/i;

/**
 * A hex colour ('#rrggbb' or 'rrggbb') → a LINEAR {r,g,b} in [0,1], else null.
 * The shader blends in linear space; null lets the caller fall back.
 */
export function hexToLinearVec3(hex) {
  if (typeof hex !== 'string') return null;
  const m = _HEX6.exec(hex.trim());
  if (!m) return null;
  const v = m[1].toLowerCase();
  return {
    r: srgbToLinear(parseInt(v.slice(0, 2), 16) / 255),
    g: srgbToLinear(parseInt(v.slice(2, 4), 16) / 255),
    b: srgbToLinear(parseInt(v.slice(4, 6), 16) / 255),
  };
}

/**
 * A world.json sky descriptor ({ color?: hex }) → a LINEAR vec3, or null when it has
 * no parsed colour (type-only skies resolve to the caller's fallback).
 */
export function skyToLinearVec3(sky) {
  if (!sky || typeof sky !== 'object') return null;
  return hexToLinearVec3(sky.color);
}

/**
 * The full per-frame uniform state for the portal reveal shader.
 *
 * @param {{ timeline?: {iris?:number, skyBlend?:number},
 *           skyA?: {color?:string}, skyB?: {color?:string}, soft?: number }} args
 *   timeline from irisReveal.mirrorTimeline; skyA/skyB the origin/destination descriptors.
 * @returns {{ uIris:number, uSkyBlend:number, uSkyA:{r,g,b}, uSkyB:{r,g,b}, uSoft:number }}
 *   uSkyA/uSkyB fall back to black when a sky has no colour (resolve from darkness).
 */
export function portalFrameState({ timeline, skyA, skyB, soft = 0.02 } = {}) {
  const t = timeline || {};
  const black = () => ({ r: 0, g: 0, b: 0 });
  return {
    uIris: clamp01(typeof t.iris === 'number' ? t.iris : 0),
    uSkyBlend: clamp01(typeof t.skyBlend === 'number' ? t.skyBlend : 0),
    uSkyA: skyToLinearVec3(skyA) || black(),
    uSkyB: skyToLinearVec3(skyB) || black(),
    uSoft: Math.max(0, Number.isFinite(soft) ? soft : 0.02),
  };
}
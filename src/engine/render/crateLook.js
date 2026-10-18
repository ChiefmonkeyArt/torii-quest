// src/engine/render/crateLook.js — one shared look for every crate (ADR-0136).
//
// The arena crates were a flat #4a4458 slate: ~7% reflectance under a warm
// low sun, so the sides facing away from it rendered near-black. Crates now use
// a warm wood albedo plus a tiny procedural texture (planks, frame, brace)
// drawn once into a 128² canvas — no download, one material, one texture
// shared by every crate. UVs are scaled per box so a big crate reads as a
// stack of ~1.2 m crates instead of one stretched panel.

import * as THREE from 'three';

export const CRATE_COLOR = '#c9a274'; // albedo tint (sRGB); the texture adds the detail
export const CRATE_TILE_M = 1.2;

let _mat = null;

function _texture() {
  if (typeof document === 'undefined') return null;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  // planks
  const tones = ['#b48a5a', '#a87f50', '#bd9463', '#ad8456'];
  for (let i = 0; i < 4; i++) { g.fillStyle = tones[i]; g.fillRect(0, i * 32, S, 32); }
  g.fillStyle = 'rgba(70,45,22,0.55)';
  for (let i = 1; i < 4; i++) g.fillRect(0, i * 32 - 1, S, 2);
  // grain
  g.strokeStyle = 'rgba(90,60,30,0.18)'; g.lineWidth = 1;
  for (let y = 4; y < S; y += 6) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + 2, 80, y - 2, S, y + 1); g.stroke(); }
  // frame + diagonal brace
  g.fillStyle = '#7a5532';
  g.fillRect(0, 0, S, 12); g.fillRect(0, S - 12, S, 12); g.fillRect(0, 0, 12, S); g.fillRect(S - 12, 0, 12, S);
  g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4); g.fillRect(-S * 0.72, -6, S * 1.44, 12); g.restore();
  g.strokeStyle = 'rgba(40,25,10,0.6)'; g.lineWidth = 2; g.strokeRect(1, 1, S - 2, S - 2); g.strokeRect(12, 12, S - 24, S - 24);
  // nail heads
  g.fillStyle = 'rgba(40,40,40,0.8)';
  for (const [x, y] of [[6, 6], [S - 6, 6], [6, S - 6], [S - 6, S - 6]]) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The shared crate material (lazily built; the texture is skipped off-DOM). */
export function crateMaterial() {
  if (_mat) return _mat;
  const map = _texture();
  _mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : CRATE_COLOR, map, roughness: 0.85, metalness: 0 });
  _mat.name = 'crate';
  return _mat;
}

/**
 * Scale a BoxGeometry's UVs so each face shows a whole number of ~1.2 m crate
 * panels (frames line up with the edges). Face order: +x, −x, +y, −y, +z, −z.
 */
export function fitCrateUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  if (!uv || uv.count !== 24) return geo;
  const n = (m) => Math.max(1, Math.round(m / CRATE_TILE_M));
  const faces = [[n(d), n(h)], [n(d), n(h)], [n(w), n(d)], [n(w), n(d)], [n(w), n(h)], [n(w), n(h)]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * faces[f][0], uv.getY(i) * faces[f][1]);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

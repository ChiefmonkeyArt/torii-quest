// tests/sticker-skin.test.js — ADR-0135: stickers land exactly where you aim
// and stay on the drawn skin through any pose (blended joints included).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { raycastSkin, anchorPose, skinRig, STICKER_ASSIST_M } from '../src/engine/character/stickerSkin.js';

// A 1 m tall, 0.1 m radius limb with two bones; weights blend across the middle
// (like an elbow), so a single-bone pin would slide off the skin when it bends.
function makeLimb() {
  const geo = new THREE.CylinderGeometry(0.1, 0.1, 1, 24, 20, false);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const si = [], sw = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const w1 = THREE.MathUtils.clamp((y - 0.4) / 0.2, 0, 1); // 0.4..0.6 blend
    si.push(0, 1, 0, 0); sw.push(1 - w1, w1, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const root = new THREE.Bone(); const upper = new THREE.Bone();
  upper.position.y = 0.5; root.add(upper);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, upper]));
  const scene = new THREE.Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  return { mesh, root, upper, scene };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

describe('raycastSkin (exact, on the drawn skin)', () => {
  it('lands exactly where the crosshair meets the skin', () => {
    const { mesh } = makeLimb();
    const h = raycastSkin(mesh, V(0, 0.25, 2), V(0, 0, -1));
    expect(h).not.toBe(null);
    expect(h.assisted).toBe(0);
    expect(h.point.y).toBeCloseTo(0.25, 4);
    expect(h.point.z).toBeGreaterThan(0.098); // on the 0.1 m surface (faceted)
    expect(h.point.z).toBeLessThan(0.1001);
    expect(h.normal.z).toBeGreaterThan(0.9); // faces the shooter
  });

  it('a near miss lands on the nearest real skin within the assist radius', () => {
    const { mesh } = makeLimb();
    const h = raycastSkin(mesh, V(0.1 + STICKER_ASSIST_M * 0.6, 0.25, 2), V(0, 0, -1));
    expect(h).not.toBe(null);
    expect(h.assisted).toBeGreaterThan(0);
    expect(Math.hypot(h.point.x, h.point.z)).toBeGreaterThan(0.095); // on the surface
  });

  it('a clear miss never invents a point', () => {
    const { mesh } = makeLimb();
    expect(raycastSkin(mesh, V(0.25, 0.25, 2), V(0, 0, -1))).toBe(null);
    expect(raycastSkin(mesh, V(0.1 + STICKER_ASSIST_M * 0.6, 0.25, 2), V(0, 0, -1), 200, { assist: false })).toBe(null);
  });

  it('ignores meshes that cannot be skinned', () => {
    expect(raycastSkin(null, V(0, 0, 2), V(0, 0, -1))).toBe(null);
    expect(skinRig(new THREE.Mesh(new THREE.BoxGeometry()))).toBe(null);
  });
});

describe('anchorPose (the sticker rides the skin)', () => {
  it('stays on the deformed surface when a blended joint bends', () => {
    const { mesh, upper, scene } = makeLimb();
    // Aim at the elbow blend zone, front side.
    const h = raycastSkin(mesh, V(0, 0.52, 2), V(0, 0, -1));
    expect(h).not.toBe(null);
    upper.rotation.x = -0.8; // bend toward the shooter
    scene.updateMatrixWorld(true);
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    expect(anchorPose(mesh, h.anchor, p, n)).toBe(true);
    // Shoot back along the anchor's own normal: the drawn skin is right there.
    const back = raycastSkin(mesh, p.clone().addScaledVector(n, 0.5), n.clone().negate(), 200, { assist: false });
    expect(back).not.toBe(null);
    expect(back.point.distanceTo(p)).toBeLessThan(1e-3);
  });

  it('rejects a stale anchor', () => {
    const { mesh } = makeLimb();
    raycastSkin(mesh, V(0, 0.25, 2), V(0, 0, -1));
    expect(anchorPose(mesh, { tri: 1e9, u: 0, v: 0, sign: 1 }, new THREE.Vector3())).toBe(false);
  });
});

describe('sticker gun wiring (ADR-0135)', () => {
  const NPC = readFileSync(new URL('../src/stickerNpc.js', import.meta.url), 'utf8');
  it('targets characters through the exact skin test only', () => {
    expect(NPC).toMatch(/import \{ raycastSkin, anchorPose, skinRig \} from '\.\/engine\/character\/stickerSkin\.js'/);
    expect(NPC).not.toMatch(/castRay|colliderToBone|_boneGrazeFallback|computeBoundingSphere/);
  });
  it('anchors in flight and once stuck, and drops stickers of departed characters', () => {
    expect(NPC).toMatch(/if \(s\.skin && s\.anchor\) anchorPose\(s\.skin, s\.anchor, s\.to, s\.normal\)/);
    expect(NPC).toMatch(/if \(!_inScene\(a\.skin\) \|\| !anchorPose\(a\.skin, a\.anchor, _worldTarget, _worldNormal\)\) a\.life = 0/);
  });
});

// stickerStudio.js — in-world sticker placement against the player's OWN
// character. The runtime half of ADR-0088: raycasts the player's own character
// SkinnedMesh — the same surface-authoritative approach as stickerNpc.js — and
// returns a normalised hit that engine/character/stickerRaycast.js turns into a
// placement ({ zoneId, u, v, rot }) for addSticker() + the kind-35100 republish.
//
// THREE-dependent (deliberately NOT in the pure engine/character/ modules, and
// NOT re-exported by src/sdk/index.js). The placement-mode orchestration and the
// hit→placement conversion stay pure + unit-tested; this module only supplies
// the live hit.
//
// The player's own character is on layer 1 (hidden from the FPS camera, visible
// in the NAP-zone mirror). Placement is therefore driven from the mirror view or
// a future third-person self-view: the host passes a ray origin/direction aimed
// at the character, and this resolves the skin point.

import * as THREE from 'three';
import { getPlayerModelRoot } from './playerModel.js';

// Reusable scratch objects (constraint [4]: no new Vector3/Matrix4 in hot paths).
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _uv = new THREE.Vector2();
const MAX_SKIN_BONES = 256;
const _faceBoneTotals = new Float32Array(MAX_SKIN_BONES);
const _faceBoneUsed = new Uint16Array(12);

function _getAttributeComponent(attribute, index, component) {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

// Derive the bones driving the skin at a hit face (highest-weighted per vertex,
// accumulated across the face's three verts) — mirrors stickerNpc.js so a
// sticker sticks to the bone that actually deforms that patch of skin.
function _surfaceHitBones(skinnedMesh, face) {
  if (!face || !skinnedMesh || !skinnedMesh.skeleton || !skinnedMesh.geometry) return [];
  const geometry = skinnedMesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) return [];
  const skeleton = skinnedMesh.skeleton;

  let usedCount = 0;
  for (let vertex = 0; vertex < 3; vertex++) {
    const vertexIndex = vertex === 0 ? face.a : (vertex === 1 ? face.b : face.c);
    for (let component = 0; component < 4; component++) {
      const boneIndex = _getAttributeComponent(skinIndex, vertexIndex, component);
      const weight = _getAttributeComponent(skinWeight, vertexIndex, component);
      if (weight <= 0 || boneIndex < 0 || boneIndex >= skeleton.bones.length || boneIndex >= MAX_SKIN_BONES) continue;
      if (_faceBoneTotals[boneIndex] === 0) _faceBoneUsed[usedCount++] = boneIndex;
      _faceBoneTotals[boneIndex] += weight;
    }
  }
  const names = [];
  for (let i = 0; i < usedCount; i++) {
    const boneIndex = _faceBoneUsed[i];
    names.push(skeleton.bones[boneIndex] ? (skeleton.bones[boneIndex].name || '') : '');
    _faceBoneTotals[boneIndex] = 0;
  }
  return names.filter(Boolean);
}

function _findSkinnedMesh(root) {
  if (!root) return null;
  let found = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !found) found = o; });
  return found;
}

// raycastOwnCharacterMesh(origin, dir) → { boneNames, uv, normal, point } | null.
// `origin`/`dir` are THREE.Vector3-like ({ x, y, z } is enough). Recomputes the
// SkinnedMesh bounding sphere before intersecting (the bind-pose cache gotcha),
// applies the skeleton so the hit lands on the animated pose, and extracts the
// skin bones + geometry UV at the hit so stickerRaycast.placementFromRaycastHit()
// can resolve zone + u/v/rot.
export function raycastOwnCharacterMesh(origin, dir) {
  const root = getPlayerModelRoot();
  const skinnedMesh = _findSkinnedMesh(root);
  if (!skinnedMesh || !origin || !dir) return null;

  skinnedMesh.updateMatrixWorld(true);
  if (skinnedMesh.skeleton) skinnedMesh.skeleton.update();
  skinnedMesh.computeBoundingSphere();

  _rayOrigin.set(origin.x || 0, origin.y || 0, origin.z || 0);
  _rayDir.set(dir.x || 0, dir.y || 0, dir.z || 0).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200;

  const hits = _raycaster.intersectObject(skinnedMesh, false);
  if (hits.length === 0) return null;
  const hit = hits[0];

  if (hit.face) {
    _normal.copy(hit.face.normal).transformDirection(skinnedMesh.matrixWorld);
  } else {
    _normal.set(0, 0, 1);
  }

  let uv = null;
  if (hit.uv) {
    _uv.copy(hit.uv);
    uv = { u: _uv.x, v: _uv.y };
  }

  const boneNames = hit.face ? _surfaceHitBones(skinnedMesh, hit.face) : [];
  if (boneNames.length === 0) return null;

  return {
    boneNames,
    uv,
    normal: { x: _normal.x, y: _normal.y, z: _normal.z },
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
  };
}

// hasOwnCharacterMesh() → boolean — convenience so the host can gate placement
// mode on the character actually being loaded.
export function hasOwnCharacterMesh() {
  return !!_findSkinnedMesh(getPlayerModelRoot());
}
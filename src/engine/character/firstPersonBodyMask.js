// The FP gun is a camera-space viewmodel, not attached to this body's hands.
// Keep torso/legs, but never draw a second pair of empty, freely swinging arms
// beside it. This is a load-time index filter, not a per-frame skinning pass.
// Mirror/peer geometry is never mutated. See ADR-0127.
import { BufferAttribute } from 'three';

const ARM_ROOT = /(?:left|right)(?:shoulder|upperarm|arm)$/;
const ARM_PART = /(?:left|right)(?:forearm|lowerarm|hand|wrist)/;
const canonical = name => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

export function firstPersonArmJoints(bones) {
  const indices = new Set();
  for (let i = 0; i < bones.length; i++) {
    for (let bone = bones[i]; bone?.isBone; bone = bone.parent) {
      const name = canonical(bone.name);
      if (ARM_ROOT.test(name) || ARM_PART.test(name)) {
        indices.add(i);
        break;
      }
    }
  }
  return indices;
}

export function maskFirstPersonArms(mesh) {
  const source = mesh?.geometry;
  const skinIndex = source?.getAttribute('skinIndex');
  const skinWeight = source?.getAttribute('skinWeight');
  if (!mesh?.isSkinnedMesh || !skinIndex || !skinWeight) return 0;
  const arms = firstPersonArmJoints(mesh.skeleton.bones);
  if (!arms.size) return 0;

  const hidden = new Uint8Array(skinIndex.count);
  for (let v = 0; v < hidden.length; v++) {
    let armWeight = 0;
    let totalWeight = 0;
    for (let c = 0; c < skinIndex.itemSize; c++) {
      const weight = skinWeight.getComponent(v, c);
      totalWeight += weight;
      if (arms.has(skinIndex.getComponent(v, c))) armWeight += weight;
    }
    hidden[v] = totalWeight > 0 && armWeight >= totalWeight * 0.5 ? 1 : 0;
  }

  const index = source.getIndex();
  const count = index ? index.count : source.getAttribute('position').count;
  const at = i => index ? index.getX(i) : i;
  const kept = [];
  const groups = [];
  // Preserve material groups, including the ungrouped single-material case.
  const ranges = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
  let removed = 0;
  for (const group of ranges) {
    const start = kept.length;
    for (let i = group.start; i + 2 < Math.min(count, group.start + group.count); i += 3) {
      const a = at(i), b = at(i + 1), c = at(i + 2);
      if (hidden[a] || hidden[b] || hidden[c]) { removed++; continue; }
      kept.push(a, b, c);
    }
    groups.push({ start, count: kept.length - start, materialIndex: group.materialIndex });
  }
  if (!removed) return 0;
  // Own the index and geometry before editing: never damage a cached template
  // or the same character's full-body mirror/peer instance.
  const geometry = source.clone();
  geometry.setIndex(new BufferAttribute(
    skinIndex.count > 65535 ? new Uint32Array(kept) : new Uint16Array(kept), 1,
  ));
  geometry.clearGroups();
  if (source.groups.length) {
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  mesh.geometry = geometry;
  return removed;
}

// Actual displacement, not raw WASD, owns locomotion. A blocked player or a
// gate/menu which pauses physics must idle even if a movement key remains held.
// Teleports and invalid/zero deltas are not footsteps.
export function firstPersonLocomotion(distance, dt, sprinting) {
  if (!Number.isFinite(distance) || !Number.isFinite(dt) || dt <= 0 ||
      distance >= 3 || distance / dt < 0.05) return 'idle';
  return sprinting ? 'run' : 'walk';
}

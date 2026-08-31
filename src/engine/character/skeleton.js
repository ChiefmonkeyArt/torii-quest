// engine/character/skeleton.js — the canonical Torii humanoid skeleton contract.
// Pure, node-safe (no THREE/Rapier/DOM). This is the foundation of the auto-rig
// engine: it defines the skeleton by SEMANTIC ROLES (not exact bone names) so
// arbitrary third-party bone conventions (Mixamo, Biped, future) can be mapped
// onto Torii's animation library.
//
// The canonical skeleton is role-based on purpose. The whole point of the
// Character Forge auto-rigger is to turn "AI made a humanoid mesh" into "it
// walks in Torii" — and that means mapping whatever bone names a generator
// emitted onto the roles the animation library drives. See
// nap-torii-avatar-v0.md + the Character Forge entry in torii-quest-strategy.md.

// Ordered role list (root-first). `required` marks roles the animation library
// needs to drive a playable character; optional roles degrade gracefully when
// absent (a character still walks without toe bones).
export const SKELETON_ROLES = Object.freeze([
  { role: 'Hips', required: true },
  { role: 'Spine', required: true },
  { role: 'Spine1', required: false },
  { role: 'Spine2', required: false },
  { role: 'Neck', required: true },
  { role: 'Head', required: true },
  { role: 'LeftShoulder', required: false },
  { role: 'RightShoulder', required: false },
  { role: 'LeftUpperArm', required: true },
  { role: 'RightUpperArm', required: true },
  { role: 'LeftLowerArm', required: true },
  { role: 'RightLowerArm', required: true },
  { role: 'LeftHand', required: true },
  { role: 'RightHand', required: true },
  { role: 'LeftUpperLeg', required: true },
  { role: 'RightUpperLeg', required: true },
  { role: 'LeftLowerLeg', required: true },
  { role: 'RightLowerLeg', required: true },
  { role: 'LeftFoot', required: true },
  { role: 'RightFoot', required: true },
  { role: 'LeftToe', required: false },
  { role: 'RightToe', required: false },
]);

// The roles the animation library must have to drive a playable character.
export const REQUIRED_ROLES = Object.freeze(
  SKELETON_ROLES.filter((r) => r.required).map((r) => r.role),
);

// Mixamo bone names → canonical role. This is the convention Torii's existing
// humanoids (chiefmonkey6.glb, nostrich-master.glb) already use.
export const MIXAMO_BONE_MAP = Object.freeze({
  mixamorigHips: 'Hips',
  mixamorigSpine: 'Spine',
  mixamorigSpine1: 'Spine1',
  mixamorigSpine2: 'Spine2',
  mixamorigNeck: 'Neck',
  mixamorigHead: 'Head',
  mixamorigLeftShoulder: 'LeftShoulder',
  mixamorigRightShoulder: 'RightShoulder',
  mixamorigLeftArm: 'LeftUpperArm',
  mixamorigRightArm: 'RightUpperArm',
  mixamorigLeftForeArm: 'LeftLowerArm',
  mixamorigRightForeArm: 'RightLowerArm',
  mixamorigLeftHand: 'LeftHand',
  mixamorigRightHand: 'RightHand',
  mixamorigLeftUpLeg: 'LeftUpperLeg',
  mixamorigRightUpLeg: 'RightUpperLeg',
  mixamorigLeftLeg: 'LeftLowerLeg',
  mixamorigRightLeg: 'RightLowerLeg',
  mixamorigLeftFoot: 'LeftFoot',
  mixamorigRightFoot: 'RightFoot',
  mixamorigLeftToeBase: 'LeftToe',
  mixamorigRightToeBase: 'RightToe',
});

// Legacy Biped (3ds Max) bone names → canonical role. The "legacy GLBs use an
// explicit mapping shim" path — kept so old/exported assets still auto-map.
export const BIPED_BONE_MAP = Object.freeze({
  Bip01: 'Hips',
  'Bip01 Pelvis': 'Hips',
  'Bip01 Spine': 'Spine',
  'Bip01 Spine1': 'Spine1',
  'Bip01 Spine2': 'Spine2',
  'Bip01 Neck': 'Neck',
  'Bip01 Head': 'Head',
  'Bip01 L Clavicle': 'LeftShoulder',
  'Bip01 R Clavicle': 'RightShoulder',
  'Bip01 L UpperArm': 'LeftUpperArm',
  'Bip01 R UpperArm': 'RightUpperArm',
  'Bip01 L Forearm': 'LeftLowerArm',
  'Bip01 R Forearm': 'RightLowerArm',
  'Bip01 L Hand': 'LeftHand',
  'Bip01 R Hand': 'RightHand',
  'Bip01 L Thigh': 'LeftUpperLeg',
  'Bip01 R Thigh': 'RightUpperLeg',
  'Bip01 L Calf': 'LeftLowerLeg',
  'Bip01 R Calf': 'RightLowerLeg',
  'Bip01 L Foot': 'LeftFoot',
  'Bip01 R Foot': 'RightFoot',
  'Bip01 L Toe0': 'LeftToe',
  'Bip01 R Toe0': 'RightToe',
});

// All known bone-name maps, in detection priority order.
export const BONE_MAPS = Object.freeze([
  { id: 'mixamo', map: MIXAMO_BONE_MAP },
  { id: 'biped', map: BIPED_BONE_MAP },
]);

// ── Scale / axis normalization constants ────────────────────────────────────
// Mixamo exports carry a uniform character-root scale of ~1/175 (see weapons.js
// v0.2.570 note). The auto-rigger normalizes to this so a character lands at
// a sane world height regardless of the source's unit scale.
export const CHARACTER_ROOT_SCALE = 1 / 175;

// Default eye height (m) used to feet-plant avatars (matches MP_EYE_OFFSET in
// arenaRuntime.js).
export const EYE_OFFSET = 1.7;

// detectConvention(boneNames) → 'mixamo' | 'biped' | 'unknown'.
// Classifies a bone list by which known convention the majority of names match.
export function detectConvention(boneNames) {
  const names = Array.isArray(boneNames) ? boneNames.map((n) => String(n)) : [];
  if (names.length === 0) return 'unknown';
  let mixamoHits = 0;
  let bipedHits = 0;
  for (const n of names) {
    if (n.startsWith('mixamorig')) mixamoHits += 1;
    else if (n.startsWith('Bip01') || n.startsWith('bip01')) bipedHits += 1;
  }
  if (mixamoHits > bipedHits && mixamoHits > 0) return 'mixamo';
  if (bipedHits > mixamoHits && bipedHits > 0) return 'biped';
  return 'unknown';
}

// mapBonesToRoles(boneNames) → { convention, mapped, missing, requiredMissing, extra }.
// Maps a bone-name list onto canonical roles using the detected convention.
// `mapped` is { role: boneName }; `missing` is every role with no mapping;
// `requiredMissing` is the subset the animation library cannot do without;
// `extra` is bone names that matched no role (ignored by the auto-rigger).
export function mapBonesToRoles(boneNames) {
  const names = Array.isArray(boneNames) ? boneNames.map((n) => String(n)) : [];
  const convention = detectConvention(names);
  const map = (BONE_MAPS.find((m) => m.id === convention) || {}).map || {};
  const mapped = {};
  const seen = new Set();
  for (const n of names) {
    const role = map[n];
    if (role && !seen.has(role)) {
      mapped[role] = n;
      seen.add(role);
    }
  }
  const mappedRoles = Object.keys(mapped);
  const missing = SKELETON_ROLES
    .filter((r) => !mappedRoles.includes(r.role))
    .map((r) => r.role);
  const requiredMissing = missing.filter((r) => REQUIRED_ROLES.includes(r));
  const extra = names.filter((n) => !map[n]);
  return { convention, mapped, missing, requiredMissing, extra };
}

// detectAxisUp(bounds) → 'yup' | 'zup' | 'unknown'.
// Given a geometry bounding box { minY, maxY, minZ, maxZ }, classify the
// coordinate system (mirrors the isZUp heuristic in arenaRuntime.js).
export function detectAxisUp(bounds) {
  const b = (bounds && typeof bounds === 'object') ? bounds : {};
  const hY = (Number(b.maxY) || 0) - (Number(b.minY) || 0);
  const hZ = (Number(b.maxZ) || 0) - (Number(b.minZ) || 0);
  if (hY <= 0 && hZ <= 0) return 'unknown';
  if (hZ > hY * 1.2) return 'zup';
  return 'yup';
}

// engine/character/skeleton.js — the canonical Torii humanoid skeleton contract.
// Pure, node-safe (no THREE/Rapier/DOM). This is the foundation of the auto-rig
// engine: it defines the skeleton by SEMANTIC ROLES (not exact bone names) so
// arbitrary third-party bone conventions (Mixamo, Biped, Tripo, Meshy, Unreal,
// future) can be mapped onto Torii's animation library.
//
// The canonical skeleton is role-based on purpose. The whole point of the
// Character Forge auto-rigger is to turn "AI made a humanoid mesh" into "it
// walks in Torii" — and that means mapping whatever bone names a generator
// emitted onto the roles the animation library drives. See
// nap-torii-avatar-v0.md + the Character Forge entry in torii-quest-strategy.md.
//
// Two resolution layers:
//   1. Explicit convention tables (MIXAMO / BIPED / TRIPO / GENERIC_HUMANOID) —
//      exact, deterministic mappings for the known generator conventions. These
//      are the source of truth for the four vendors we already accept.
//   2. `classifyBone()` — a general keyword/side heuristic that maps an
//      ARBITRARY humanoid bone name onto a role WITHOUT a per-vendor table, so
//      a brand-new generator's `.glb` still resolves "no matter where it came
//      from" (see ADR-0107). It is conservative: it returns null unless a
//      confident match exists, so noise/helper nodes never map.

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

// Tripo bone names → canonical role. Tripo (the image/text-to-3D generator)
// auto-rigs humanoids with its own `Hip` / `L_Thigh` / `L_Upperarm` underscore
// convention. The legs hang off `Pelvis` (left as an extra here) while the
// spine chain is `Waist` → `Spine01` → `Spine02`.
export const TRIPO_BONE_MAP = Object.freeze({
  Hip: 'Hips',
  Waist: 'Spine',
  Spine01: 'Spine1',
  Spine02: 'Spine2',
  Neck: 'Neck',
  Head: 'Head',
  L_Clavicle: 'LeftShoulder',
  R_Clavicle: 'RightShoulder',
  L_Upperarm: 'LeftUpperArm',
  R_Upperarm: 'RightUpperArm',
  L_Forearm: 'LeftLowerArm',
  R_Forearm: 'RightLowerArm',
  L_Hand: 'LeftHand',
  R_Hand: 'RightHand',
  L_Thigh: 'LeftUpperLeg',
  R_Thigh: 'RightUpperLeg',
  L_Calf: 'LeftLowerLeg',
  R_Calf: 'RightLowerLeg',
  L_Foot: 'LeftFoot',
  R_Foot: 'RightFoot',
  L_ToeBase: 'LeftToe',
  R_ToeBase: 'RightToe',
});

// Generic humanoid names → canonical role. This is the prefix-stripped Mixamo
// style (`Hips`, `Spine`, `LeftArm`, `LeftForeArm`, `LeftUpLeg`, `LeftLeg`, …)
// that Meshy's auto-rigged output and the Unreal Mannequin both use — the most
// common "plain" humanoid convention. `neck` (lowercase) is included because
// Meshy emits it that way.
export const GENERIC_HUMANOID_BONE_MAP = Object.freeze({
  Hips: 'Hips',
  Spine: 'Spine',
  Spine01: 'Spine1',
  Spine02: 'Spine2',
  Neck: 'Neck',
  neck: 'Neck',
  Head: 'Head',
  LeftShoulder: 'LeftShoulder',
  RightShoulder: 'RightShoulder',
  LeftArm: 'LeftUpperArm',
  RightArm: 'RightUpperArm',
  LeftForeArm: 'LeftLowerArm',
  RightForeArm: 'RightLowerArm',
  LeftHand: 'LeftHand',
  RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpperLeg',
  RightUpLeg: 'RightUpperLeg',
  LeftLeg: 'LeftLowerLeg',
  RightLeg: 'RightLowerLeg',
  LeftFoot: 'LeftFoot',
  RightFoot: 'RightFoot',
  LeftToeBase: 'LeftToe',
  RightToeBase: 'RightToe',
});

// All known bone-name maps, in detection priority order.
export const BONE_MAPS = Object.freeze([
  { id: 'mixamo', map: MIXAMO_BONE_MAP },
  { id: 'biped', map: BIPED_BONE_MAP },
  { id: 'tripo', map: TRIPO_BONE_MAP },
  { id: 'generic', map: GENERIC_HUMANOID_BONE_MAP },
]);

// ── Scale / axis normalization constants ────────────────────────────────────
// Mixamo exports carry a uniform character-root scale of ~1/175 (see weapons.js
// v0.2.570 note). The auto-rigger normalizes to this so a character lands at
// a sane world height regardless of the source's unit scale.
export const CHARACTER_ROOT_SCALE = 1 / 175;

// Default eye height (m) used to feet-plant avatars (matches MP_EYE_OFFSET in
// arenaRuntime.js).
export const EYE_OFFSET = 1.7;

// normalizeBoneName(name) → the lookup key for the bone-map. Mixamo exports
// through Blender/glTF use `mixamorig:Hips` (with a colon separator);
// Adobe's FBX-to-Blender pipeline sometimes strips the colon to `mixamorigHips`.
// The bone-map keys are the no-colon form, so we normalize the incoming name
// to that form before lookup. Also handles the same colon-prefix pattern for
// arbitrary armatures (`Armature:mixamorig:Hips` → `mixamorigHips`).
// Pure, allocation-light.
export function normalizeBoneName(name) {
  const s = String(name || '');
  // Fast path: no colon at all — already normalized.
  if (!s.includes(':')) return s;
  // Any occurrence of the Mixamo prefix (possibly nested under an armature
  // prefix like "Armature:mixamorig:Hips") maps to the no-colon Mixamo form.
  const mx = s.indexOf('mixamorig:');
  if (mx >= 0) {
    const afterPrefix = s.slice(mx + 'mixamorig:'.length);
    return `mixamorig${afterPrefix.replace(/:/g, '')}`;
  }
  // Non-Mixamo colon form (e.g. a Biped rig exported through a namespace).
  // Strip the namespace prefix (up to and including the last colon) and any
  // stray colons in the tail. Preserves internal spaces ("Bip01 Spine").
  const lastColon = s.lastIndexOf(':');
  return s.slice(lastColon + 1).replace(/:/g, '');
}

// detectConvention(boneNames) → 'mixamo' | 'biped' | 'tripo' | 'generic' | 'unknown'.
// Classifies a bone list by scoring how many names each known convention table
// resolves (via normalizeBoneName). Highest score wins; a zero score is
// 'unknown'. Scoring is more robust than the old prefix sniff — a Tripo or
// prefix-stripped Meshy rig is now recognised by its actual bone names rather
// than rejected.
export function detectConvention(boneNames) {
  const names = Array.isArray(boneNames) ? boneNames.map((n) => String(n)) : [];
  if (names.length === 0) return 'unknown';
  let best = 'unknown';
  let bestScore = 0;
  for (const entry of BONE_MAPS) {
    let score = 0;
    for (const n of names) {
      if (entry.map[normalizeBoneName(n)]) score += 1;
    }
    if (score > bestScore) {
      best = entry.id;
      bestScore = score;
    }
  }
  return best;
}

// _canon(name) → a compact, comparable lower-case string for `classifyBone`:
// normalize colon/armature forms, drop every non-alphanumeric, lower-case, then
// strip a known namespace/armature prefix (mixamorig, bip, armature, character,
// …). "LeftForeArm", "L_Forearm", "left_forearm" and "Bip01 L Forearm" all
// collapse onto comparable forms. Never throws.
function _canon(name) {
  let s = normalizeBoneName(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  s = s.replace(/^(mixamorig|mixamo|bip01|bip|armature|character1|character|char1)/, '');
  return s;
}

// _segmentRole(body, sided) → the center-role suffix for a side-stripped bone
// name (e.g. "calf" → "LowerLeg"), or null. `sided` gates the LIMB roles so a
// bare "arm"/"leg" with no left/right marker is never guessed a side. Ordered
// so "forearm"/"lowerarm" win over "arm", "upleg"/"thigh" over "leg", and
// "toebase" is handled before "foot".
function _segmentRole(body, sided) {
  if (!body) return null;
  // Spine with optional trailing digit (Spine1/Spine2 are optional roles).
  if (body === 'spine') return 'Spine';
  if (body === 'spine1') return 'Spine1';
  if (body === 'spine2') return 'Spine2';
  // Center (no-side) roles.
  if (body === 'pelvis' || body === 'hips' || body === 'hip') return 'Hips';
  if (body === 'neck') return 'Neck';
  if (body === 'head') return 'Head';
  // Side-gated limb roles.
  if (!sided) return null;
  if (body === 'shoulder' || body === 'clavicle') return 'Shoulder';
  if (body === 'upperarm' || body === 'arm') return 'UpperArm';
  if (body === 'forearm' || body === 'lowerarm' || body === 'elbow') return 'LowerArm';
  if (body === 'hand') return 'Hand';
  if (body === 'thigh' || body === 'upleg' || body === 'upperleg') return 'UpperLeg';
  if (body === 'calf' || body === 'shin' || body === 'leg' || body === 'lowerleg') return 'LowerLeg';
  if (body === 'foot') return 'Foot';
  if (body === 'toe' || body === 'toebase') return 'Toe';
  return null;
}

// classifyBone(name) → a canonical role string, or null. GENERAL heuristic: maps
// an arbitrary humanoid bone name onto a role without a per-vendor table so a
// brand-new generator's `.glb` still resolves. Handles word prefixes
// ("LeftArm"), short prefixes ("L_Thigh"/"l_thigh"), and Unreal-style suffixes
// ("thigh_l"). Conservative — returns null unless a confident match exists, so
// helper nodes ("head_end", "tripo_node_…", "char1", "root") stay unmapped.
export function classifyBone(name) {
  const canon = _canon(name);
  if (!canon) return null;

  let side = null;
  let body = canon;

  // Side detection. Explicit words first, then a leading single letter, then a
  // trailing single letter (Unreal Mannequin "thigh_l"/"calf_r").
  if (canon.startsWith('left')) { side = 'Left'; body = canon.slice(4); }
  else if (canon.startsWith('right')) { side = 'Right'; body = canon.slice(5); }
  else if (canon[0] === 'l') { side = 'Left'; body = canon.slice(1); }
  else if (canon[0] === 'r') { side = 'Right'; body = canon.slice(1); }
  else if (canon.length > 2 && canon.endsWith('l')) { side = 'Left'; body = canon.slice(0, -1); }
  else if (canon.length > 2 && canon.endsWith('r')) { side = 'Right'; body = canon.slice(0, -1); }

  const base = _segmentRole(body, side !== null);
  if (!base) return null;
  return side ? `${side}${base}` : base;
}

// mapBonesToRoles(boneNames) → { convention, mapped, missing, requiredMissing, extra }.
// Maps a bone-name list onto canonical roles. Resolution is per-bone and
// exhaustive: first try every known convention table (in priority order), then
// fall back to the `classifyBone` heuristic, so a mixed or brand-new convention
// still resolves. `mapped` is { role: boneName } (the ORIGINAL name, colon and
// case preserved, so callers can address the real scene node); `missing` is
// every role with no mapping; `requiredMissing` is the subset the animation
// library cannot do without; `extra` is bone names that resolved to no role.
export function mapBonesToRoles(boneNames) {
  const names = Array.isArray(boneNames) ? boneNames.map((n) => String(n)) : [];
  const convention = detectConvention(names);
  const mapped = {};
  const seen = new Set();
  const extra = [];
  for (const n of names) {
    const norm = normalizeBoneName(n);
    let role = null;
    for (const entry of BONE_MAPS) {
      const r = entry.map[norm];
      if (r) { role = r; break; }
    }
    if (!role) role = classifyBone(n);
    if (!role) { extra.push(n); continue; }
    if (!seen.has(role)) {
      mapped[role] = n;
      seen.add(role);
    }
    // else: duplicate role — drop this bone silently (as before).
  }
  const mappedRoles = Object.keys(mapped);
  const missing = SKELETON_ROLES
    .filter((r) => !mappedRoles.includes(r.role))
    .map((r) => r.role);
  const requiredMissing = missing.filter((r) => REQUIRED_ROLES.includes(r));
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
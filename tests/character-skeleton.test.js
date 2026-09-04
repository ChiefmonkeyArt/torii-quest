// tests/character-skeleton.test.js — locks the canonical Torii skeleton
// contract (src/engine/character/skeleton.js): the role list, convention
// detection, bone→role mapping, and axis detection. Pure module → fully
// node-testable, no scene/Rapier needed.
import { describe, it, expect } from 'vitest';
import {
  SKELETON_ROLES, REQUIRED_ROLES, MIXAMO_BONE_MAP, BIPED_BONE_MAP,
  TRIPO_BONE_MAP, GENERIC_HUMANOID_BONE_MAP,
  detectConvention, mapBonesToRoles, detectAxisUp, CHARACTER_ROOT_SCALE,
  normalizeBoneName, classifyBone,
} from '../src/engine/character/skeleton.js';

// Real Mixamo GLB exports — what a Blender / Mixamo-to-Blender / RPM avatar
// actually contains. Same bone identities as FULL_MIXAMO but with the colon
// separator preserved by the glTF exporter. v0.2.745 fix: these must map.
const FULL_MIXAMO_COLON = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
  'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:RightShoulder',
  'mixamorig:LeftArm', 'mixamorig:RightArm',
  'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
  'mixamorig:LeftHand', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg',
  'mixamorig:LeftLeg', 'mixamorig:RightLeg',
  'mixamorig:LeftFoot', 'mixamorig:RightFoot',
  'mixamorig:LeftToeBase', 'mixamorig:RightToeBase',
];

const FULL_MIXAMO = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigRightShoulder',
  'mixamorigLeftArm', 'mixamorigRightArm',
  'mixamorigLeftForeArm', 'mixamorigRightForeArm',
  'mixamorigLeftHand', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigRightUpLeg',
  'mixamorigLeftLeg', 'mixamorigRightLeg',
  'mixamorigLeftFoot', 'mixamorigRightFoot',
  'mixamorigLeftToeBase', 'mixamorigRightToeBase',
];

describe('skeleton contract', () => {
  it('declares a root-first role list with required flags', () => {
    expect(SKELETON_ROLES[0].role).toBe('Hips');
    expect(SKELETON_ROLES.some((r) => r.role === 'Head')).toBe(true);
    expect(SKELETON_ROLES.some((r) => r.role === 'RightHand')).toBe(true);
  });

  it('REQUIRED_ROLES is the required subset of SKELETON_ROLES', () => {
    const required = SKELETON_ROLES.filter((r) => r.required).map((r) => r.role);
    expect(REQUIRED_ROLES).toEqual(required);
    expect(REQUIRED_ROLES).toContain('Hips');
    expect(REQUIRED_ROLES).toContain('Head');
    expect(REQUIRED_ROLES).not.toContain('Spine1'); // optional
    expect(REQUIRED_ROLES).not.toContain('LeftToe'); // optional
  });

  it('maps Mixamo and Biped names onto the same roles', () => {
    expect(MIXAMO_BONE_MAP.mixamorigHips).toBe('Hips');
    expect(MIXAMO_BONE_MAP.mixamorigRightForeArm).toBe('RightLowerArm');
    expect(BIPED_BONE_MAP['Bip01 Head']).toBe('Head');
    expect(BIPED_BONE_MAP['Bip01 L Calf']).toBe('LeftLowerLeg');
  });

  it('exposes the Mixamo character-root scale constant', () => {
    expect(CHARACTER_ROOT_SCALE).toBeCloseTo(1 / 175, 10);
  });
});

describe('detectConvention', () => {
  it('detects mixamo', () => {
    expect(detectConvention(FULL_MIXAMO)).toBe('mixamo');
  });
  it('detects biped', () => {
    expect(detectConvention(['Bip01', 'Bip01 Spine', 'Bip01 Head'])).toBe('biped');
  });
  it('returns unknown for unrecognised names', () => {
    expect(detectConvention(['root', 'chest', 'skull'])).toBe('unknown');
  });
  it('returns unknown for an empty list', () => {
    expect(detectConvention([])).toBe('unknown');
  });
});

describe('mapBonesToRoles', () => {
  it('maps a full Mixamo skeleton with no missing required roles', () => {
    const r = mapBonesToRoles(FULL_MIXAMO);
    expect(r.convention).toBe('mixamo');
    expect(r.mapped.Hips).toBe('mixamorigHips');
    expect(r.mapped.RightHand).toBe('mixamorigRightHand');
    expect(r.requiredMissing).toEqual([]);
  });

  it('reports missing required roles for a partial skeleton', () => {
    const r = mapBonesToRoles(['mixamorigHips', 'mixamorigSpine', 'mixamorigHead']);
    expect(r.requiredMissing).toContain('Neck');
    expect(r.requiredMissing).toContain('LeftHand');
  });

  it('returns empty mapping for an unknown convention', () => {
    const r = mapBonesToRoles(['root', 'chest']);
    expect(r.convention).toBe('unknown');
    expect(Object.keys(r.mapped).length).toBe(0);
    expect(r.extra.length).toBe(2);
  });
});

describe('normalizeBoneName (v0.2.745 fix)', () => {
  it('strips the mixamorig: colon separator (Blender/glTF form)', () => {
    expect(normalizeBoneName('mixamorig:Hips')).toBe('mixamorigHips');
    expect(normalizeBoneName('mixamorig:RightForeArm')).toBe('mixamorigRightForeArm');
  });
  it('leaves the no-colon form untouched (Adobe FBX form)', () => {
    expect(normalizeBoneName('mixamorigHips')).toBe('mixamorigHips');
    expect(normalizeBoneName('mixamorigRightForeArm')).toBe('mixamorigRightForeArm');
  });
  it('handles nested armature prefixes', () => {
    expect(normalizeBoneName('Armature:mixamorig:Hips')).toBe('mixamorigHips');
  });
  it('is a no-op for names without any colon', () => {
    expect(normalizeBoneName('Bip01 Spine')).toBe('Bip01 Spine');
    expect(normalizeBoneName('root')).toBe('root');
  });
  it('is safe for null / non-string input', () => {
    expect(normalizeBoneName(null)).toBe('');
    expect(normalizeBoneName(undefined)).toBe('');
    expect(normalizeBoneName(42)).toBe('42');
  });
});

describe('detectConvention with colon-form names (v0.2.745 fix)', () => {
  it('detects mixamo from the Blender/glTF colon form', () => {
    expect(detectConvention(FULL_MIXAMO_COLON)).toBe('mixamo');
  });
  it('detects mixamo from a nested armature prefix', () => {
    expect(detectConvention(['Armature:mixamorig:Hips', 'Armature:mixamorig:Head'])).toBe('mixamo');
  });
});

describe('mapBonesToRoles with colon-form names (v0.2.745 fix)', () => {
  it('maps a full colon-form Mixamo skeleton with no missing required roles', () => {
    const r = mapBonesToRoles(FULL_MIXAMO_COLON);
    expect(r.convention).toBe('mixamo');
    expect(r.requiredMissing).toEqual([]);
    // The original bone name (with colon) is what's stored in `mapped`, so the
    // caller can still address the actual node in the GLTF scene.
    expect(r.mapped.Hips).toBe('mixamorig:Hips');
    expect(r.mapped.RightHand).toBe('mixamorig:RightHand');
    expect(r.mapped.LeftUpperLeg).toBe('mixamorig:LeftUpLeg');
  });
  it('reports zero extras when every colon-form bone maps', () => {
    const r = mapBonesToRoles(FULL_MIXAMO_COLON);
    expect(r.extra).toEqual([]);
  });
});

describe('detectAxisUp', () => {
  it('classifies y-up and z-up and unknown', () => {
    expect(detectAxisUp({ minY: 0, maxY: 1.7, minZ: 0, maxZ: 0.3 })).toBe('yup');
    expect(detectAxisUp({ minY: 0, maxY: 0.3, minZ: 0, maxZ: 1.7 })).toBe('zup');
    expect(detectAxisUp({})).toBe('unknown');
  });
});

// ── v0.2.759: general convention tables + classifyBone heuristic ───────────
// Tripo (image/text-to-3D) and generic/prefix-stripped-Mixamo (Meshy, Unreal)
// rigs must resolve onto the same canonical roles as Mixamo/Biped. Bone lists
// below are the ACTUAL node names from the two guest-avatar GLBs (Tripo head
// and the Meshy re-export head4).

const TRIPO_BONES = [
  'Root', 'Hip', 'Pelvis', 'L_Thigh', 'L_Calf', 'L_Foot', 'L_ToeBase',
  'L_ThighTwist01', 'L_CalfTwist01', 'R_Thigh', 'R_Calf', 'R_Foot', 'R_ToeBase',
  'Waist', 'Spine01', 'Spine02', 'Neck', 'Head',
  'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand',
  'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand',
  'tripo_node_8922efb7',
];

const GENERIC_BONES = [
  'LeftToeBase', 'LeftFoot', 'LeftLeg', 'LeftUpLeg',
  'RightToeBase', 'RightFoot', 'RightLeg', 'RightUpLeg',
  'LeftHand', 'LeftForeArm', 'LeftArm', 'LeftShoulder',
  'RightHand', 'RightForeArm', 'RightArm', 'RightShoulder',
  'head_end', 'headfront', 'Head', 'neck', 'Spine', 'Spine01', 'Spine02', 'Hips',
  'char1', 'Armature',
];

describe('convention tables (Tripo + generic/Meshy)', () => {
  it('maps Tripo underscore names onto roles', () => {
    expect(TRIPO_BONE_MAP.Hip).toBe('Hips');
    expect(TRIPO_BONE_MAP.Waist).toBe('Spine');
    expect(TRIPO_BONE_MAP.L_Thigh).toBe('LeftUpperLeg');
    expect(TRIPO_BONE_MAP.L_Calf).toBe('LeftLowerLeg');
    expect(TRIPO_BONE_MAP.L_Forearm).toBe('LeftLowerArm');
    expect(TRIPO_BONE_MAP.L_Clavicle).toBe('LeftShoulder');
  });

  it('maps generic/prefix-stripped (Meshy) names onto roles', () => {
    expect(GENERIC_HUMANOID_BONE_MAP.Hips).toBe('Hips');
    expect(GENERIC_HUMANOID_BONE_MAP.Spine).toBe('Spine');
    expect(GENERIC_HUMANOID_BONE_MAP.neck).toBe('Neck'); // Meshy emits lowercase
    expect(GENERIC_HUMANOID_BONE_MAP.LeftUpLeg).toBe('LeftUpperLeg');
    expect(GENERIC_HUMANOID_BONE_MAP.LeftLeg).toBe('LeftLowerLeg');
    expect(GENERIC_HUMANOID_BONE_MAP.LeftForeArm).toBe('LeftLowerArm');
  });
});

describe('classifyBone heuristic', () => {
  it('resolves every convention into the one canonical role', () => {
    // hip/pelvis
    expect(classifyBone('mixamorigHips')).toBe('Hips');
    expect(classifyBone('mixamorig:Hips')).toBe('Hips');
    expect(classifyBone('Bip01 Pelvis')).toBe('Hips');
    expect(classifyBone('Hips')).toBe('Hips');
    expect(classifyBone('Hip')).toBe('Hips');
    expect(classifyBone('Pelvis')).toBe('Hips');
    // upper arm
    expect(classifyBone('LeftArm')).toBe('LeftUpperArm');
    expect(classifyBone('L_Upperarm')).toBe('LeftUpperArm');
    expect(classifyBone('Bip01 R UpperArm')).toBe('RightUpperArm');
    expect(classifyBone('mixamorigLeftArm')).toBe('LeftUpperArm');
    // lower arm
    expect(classifyBone('LeftForeArm')).toBe('LeftLowerArm');
    expect(classifyBone('L_Forearm')).toBe('LeftLowerArm');
    // legs
    expect(classifyBone('LeftUpLeg')).toBe('LeftUpperLeg');
    expect(classifyBone('LeftLeg')).toBe('LeftLowerLeg');
    expect(classifyBone('L_Thigh')).toBe('LeftUpperLeg');
    expect(classifyBone('L_Calf')).toBe('LeftLowerLeg');
    expect(classifyBone('Bip01 R Calf')).toBe('RightLowerLeg');
    // Unreal Mannequin suffix form
    expect(classifyBone('Thigh_L')).toBe('LeftUpperLeg');
    expect(classifyBone('calf_r')).toBe('RightLowerLeg');
    // center bones
    expect(classifyBone('neck')).toBe('Neck');
    expect(classifyBone('Head')).toBe('Head');
    expect(classifyBone('Spine')).toBe('Spine');
    expect(classifyBone('Spine1')).toBe('Spine1');
  });

  it('returns null for noise/helper nodes (conservative)', () => {
    expect(classifyBone('root')).toBe(null);
    expect(classifyBone('RootNode')).toBe(null);
    expect(classifyBone('chest')).toBe(null);
    expect(classifyBone('skull')).toBe(null);
    expect(classifyBone('char1')).toBe(null);
    expect(classifyBone('Armature')).toBe(null);
    expect(classifyBone('head_end')).toBe(null);
    expect(classifyBone('tripo_node_8922efb7')).toBe(null);
    expect(classifyBone('mixamorigLeftTwistBone')).toBe(null);
    expect(classifyBone('')).toBe(null);
    expect(classifyBone(null)).toBe(null);
    expect(classifyBone(undefined)).toBe(null);
  });
});

describe('detectConvention (Tripo + generic)', () => {
  it('detects tripo', () => {
    expect(detectConvention(TRIPO_BONES)).toBe('tripo');
  });
  it('detects generic (Meshy head4)', () => {
    expect(detectConvention(GENERIC_BONES)).toBe('generic');
  });
});

describe('mapBonesToRoles (Tripo + generic)', () => {
  it('maps a Tripo rig with no missing required roles', () => {
    const r = mapBonesToRoles(TRIPO_BONES);
    expect(r.requiredMissing).toEqual([]);
    expect(r.mapped.Hips).toBe('Hip');
    expect(r.mapped.Spine).toBe('Waist');
    expect(r.mapped.LeftUpperLeg).toBe('L_Thigh');
    expect(r.mapped.LeftLowerArm).toBe('L_Forearm');
    expect(r.mapped.LeftShoulder).toBe('L_Clavicle');
    expect(r.mapped.LeftToe).toBe('L_ToeBase');
  });

  it('maps a generic (Meshy) rig with no missing required roles', () => {
    const r = mapBonesToRoles(GENERIC_BONES);
    expect(r.requiredMissing).toEqual([]);
    expect(r.mapped.Hips).toBe('Hips');
    expect(r.mapped.Spine).toBe('Spine');
    expect(r.mapped.Neck).toBe('neck');
    expect(r.mapped.LeftUpperLeg).toBe('LeftUpLeg');
    expect(r.mapped.LeftLowerLeg).toBe('LeftLeg');
    expect(r.mapped.LeftUpperArm).toBe('LeftArm');
    expect(r.mapped.LeftLowerArm).toBe('LeftForeArm');
    expect(r.mapped.LeftToe).toBe('LeftToeBase');
  });

  it('flags Tripo noise (root/twists/node) as extra', () => {
    const r = mapBonesToRoles(TRIPO_BONES);
    expect(r.extra).toContain('Root');
    expect(r.extra).toContain('L_ThighTwist01');
    expect(r.extra).toContain('tripo_node_8922efb7');
  });

  it('flags Meshy noise (helper nodes) as extra', () => {
    const r = mapBonesToRoles(GENERIC_BONES);
    expect(r.extra).toContain('head_end');
    expect(r.extra).toContain('headfront');
    expect(r.extra).toContain('char1');
    expect(r.extra).toContain('Armature');
  });
});

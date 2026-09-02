// tests/character-skeleton.test.js — locks the canonical Torii skeleton
// contract (src/engine/character/skeleton.js): the role list, convention
// detection, bone→role mapping, and axis detection. Pure module → fully
// node-testable, no scene/Rapier needed.
import { describe, it, expect } from 'vitest';
import {
  SKELETON_ROLES, REQUIRED_ROLES, MIXAMO_BONE_MAP, BIPED_BONE_MAP,
  detectConvention, mapBonesToRoles, detectAxisUp, CHARACTER_ROOT_SCALE,
  normalizeBoneName,
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

// tests/bone-rename.test.js — locks the Mixamo bone-name normalisation shim
// (engine/assets/boneRename.js). Pure: fake scene/animation objects, no Three.
import { describe, it, expect } from 'vitest';
import {
  MIXAMO_BONE_RENAME, mixamoBoneName, renameBonesToMixamo,
} from '../src/engine/assets/boneRename.js';

// Minimal fake Object3D-like root that traverses a fixed list of nodes.
function fakeScene(nodes) {
  return { traverse(cb) { for (const n of nodes) cb(n); } };
}
function fakeBone(name) {
  return { isBone: true, name };
}
function fakeTrack(name) {
  return { name };
}

describe('MIXAMO_BONE_RENAME', () => {
  it('maps the four Meshy spine/head names to Mixamo', () => {
    expect(MIXAMO_BONE_RENAME).toEqual({
      Spine01: 'Spine1',
      Spine02: 'Spine2',
      neck: 'Neck',
      head_end: 'HeadTop_End',
    });
  });
  it('is frozen', () => {
    expect(Object.isFrozen(MIXAMO_BONE_RENAME)).toBe(true);
  });
});

describe('mixamoBoneName', () => {
  it('renames known bones', () => {
    expect(mixamoBoneName('Spine01')).toBe('Spine1');
    expect(mixamoBoneName('neck')).toBe('Neck');
    expect(mixamoBoneName('head_end')).toBe('HeadTop_End');
  });
  it('is identity for unknown or already-canonical names', () => {
    expect(mixamoBoneName('Hips')).toBe('Hips');
    expect(mixamoBoneName('Spine1')).toBe('Spine1');
    expect(mixamoBoneName('LeftUpLeg')).toBe('LeftUpLeg');
    expect(mixamoBoneName('headfront')).toBe('headfront'); // no Mixamo equivalent
  });
});

describe('renameBonesToMixamo', () => {
  it('renames bone nodes in the scene', () => {
    const scene = fakeScene([
      fakeBone('Hips'), fakeBone('Spine01'), fakeBone('neck'),
      fakeBone('head_end'), fakeBone('LeftUpLeg'),
    ]);
    const renamed = renameBonesToMixamo(scene);
    expect(renamed).toBe(3); // Spine01, neck, head_end
    expect(scene.traverse).toBeDefined();
  });

  it('renames animation track names to match the bones', () => {
    const scene = fakeScene([fakeBone('Spine01'), fakeBone('neck')]);
    const gltf = {
      scene,
      animations: [
        { tracks: [fakeTrack('Spine01.quaternion'), fakeTrack('Hips.position'), fakeTrack('neck.rotation')] },
      ],
    };
    const renamed = renameBonesToMixamo(gltf);
    // 2 scene bones + 2 tracks (Spine01.quaternion, neck.rotation)
    expect(renamed).toBe(4);
    expect(gltf.animations[0].tracks[0].name).toBe('Spine1.quaternion');
    expect(gltf.animations[0].tracks[1].name).toBe('Hips.position'); // unchanged
    expect(gltf.animations[0].tracks[2].name).toBe('Neck.rotation');
  });

  it('is idempotent on already-canonical assets', () => {
    const scene = fakeScene([fakeBone('Spine1'), fakeBone('Neck'), fakeBone('HeadTop_End')]);
    const renamed = renameBonesToMixamo(scene);
    expect(renamed).toBe(0);
  });

  it('handles a bare scene with no animations', () => {
    const scene = fakeScene([fakeBone('Spine02')]);
    expect(renameBonesToMixamo(scene)).toBe(1);
  });

  it('tolerates a null/empty input', () => {
    expect(renameBonesToMixamo(null)).toBe(0);
    expect(renameBonesToMixamo({})).toBe(0);
  });
});

// tests/animation-retarget.test.js — runtime bone-name retargeting unit tests.
// Exercises the pure (THREE-free) animationRetarget module: the same remap the
// Character Forge uses at runtime to redrive the animation library onto an
// arbitrary uploaded humanoid skeleton (Mixamo → Tripo here).

import { describe, it, expect } from 'vitest';
import {
  trackBoneOf,
  buildBoneRebind,
  remapTrackName,
  retargetClip,
  collectTrackBoneNames,
} from '../src/engine/character/animationRetarget.js';

const mixamoBones = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
  'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftToeBase',
  'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot', 'mixamorigRightToeBase',
];

const tripoBones = [
  'Hip', 'Waist', 'Spine01', 'Spine02', 'Neck', 'Head',
  'L_Clavicle', 'L_Upperarm', 'L_Forearm', 'L_Hand',
  'R_Clavicle', 'R_Upperarm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Calf', 'L_Foot', 'L_ToeBase',
  'R_Thigh', 'R_Calf', 'R_Foot', 'R_ToeBase',
];

const mockClip = (tracks) => ({
  name: 'Idle_02',
  tracks: tracks.map((t) => ({ name: t, values: [0], times: [0] })),
  clone() {
    return { name: this.name, tracks: this.tracks.map((t) => ({ ...t })) };
  },
});

describe('trackBoneOf', () => {
  it('strips a trailing property suffix', () => {
    expect(trackBoneOf('mixamorigHips.position')).toBe('mixamorigHips');
    expect(trackBoneOf('mixamorigHips.quaternion')).toBe('mixamorigHips');
    expect(trackBoneOf('mixamorigLeftFoot.scale')).toBe('mixamorigLeftFoot');
  });
  it('returns a bare bone name unchanged', () => {
    expect(trackBoneOf('Hip')).toBe('Hip');
  });
  it('handles non-strings', () => {
    expect(trackBoneOf(null)).toBe('');
    expect(trackBoneOf(123)).toBe('');
  });
});

describe('buildBoneRebind', () => {
  it('maps Mixamo library bones onto Tripo bones via shared roles', () => {
    const rebind = buildBoneRebind(mixamoBones, tripoBones);
    expect(rebind.get('mixamorigHips')).toBe('Hip');
    expect(rebind.get('mixamorigLeftUpLeg')).toBe('L_Thigh');
    expect(rebind.get('mixamorigLeftLeg')).toBe('L_Calf');
    expect(rebind.get('mixamorigLeftFoot')).toBe('L_Foot');
    expect(rebind.get('mixamorigLeftArm')).toBe('L_Upperarm');
    expect(rebind.get('mixamorigLeftForeArm')).toBe('L_Forearm');
    expect(rebind.get('mixamorigLeftHand')).toBe('L_Hand');
    expect(rebind.get('mixamorigLeftShoulder')).toBe('L_Clavicle');
    expect(rebind.get('mixamorigHead')).toBe('Head');
    // all 22 shared roles intersect
    expect(rebind.size).toBe(22);
  });

  it('is symmetric in role resolution regardless of which side is library', () => {
    const rebind = buildBoneRebind(tripoBones, mixamoBones);
    expect(rebind.get('Hip')).toBe('mixamorigHips');
    expect(rebind.get('L_Thigh')).toBe('mixamorigLeftUpLeg');
  });

  it('returns empty for an unriggable target', () => {
    expect(buildBoneRebind(mixamoBones, []).size).toBe(0);
    expect(buildBoneRebind(mixamoBones, ['totally_unknown_bone']).size).toBe(0);
  });

  it('drops only the roles absent on the target (optional toes degrade)', () => {
    const noToes = tripoBones.filter((b) => !b.endsWith('ToeBase'));
    const rebind = buildBoneRebind(mixamoBones, noToes);
    expect(rebind.has('mixamorigLeftToeBase')).toBe(false);
    expect(rebind.get('mixamorigHips')).toBe('Hip'); // required roles still map
  });
});

describe('remapTrackName', () => {
  const rebind = buildBoneRebind(mixamoBones, tripoBones);
  it('rewrites the bone, keeps the property', () => {
    expect(remapTrackName('mixamorigHips.position', rebind)).toBe('Hip.position');
    expect(remapTrackName('mixamorigLeftUpLeg.quaternion', rebind)).toBe('L_Thigh.quaternion');
    expect(remapTrackName('mixamorigLeftFoot.scale', rebind)).toBe('L_Foot.scale');
  });
  it('returns null for an unmapped bone', () => {
    expect(remapTrackName('mixamorigLeftShoulder.position', new Map())).toBe(null);
    expect(remapTrackName('someUnknownBone.position', rebind)).toBe(null);
  });
});

describe('retargetClip', () => {
  const rebind = buildBoneRebind(mixamoBones, tripoBones);

  it('clones the clip and remaps every track bone name', () => {
    const clip = mockClip([
      'mixamorigHips.position',
      'mixamorigHips.quaternion',
      'mixamorigLeftUpLeg.quaternion',
      'mixamorigHead.position',
    ]);
    const out = retargetClip(clip, rebind);
    expect(out.tracks.map((t) => t.name)).toEqual([
      'Hip.position',
      'Hip.quaternion',
      'L_Thigh.quaternion',
      'Head.position',
    ]);
    // original clip is untouched (clone semantics)
    expect(clip.tracks[0].name).toBe('mixamorigHips.position');
  });

  it('drops tracks whose bone has no target mapping', () => {
    const clip2 = mockClip([
      'mixamorigHips.position',
      'totallyUnknownBone.position',
    ]);
    const out = retargetClip(clip2, rebind);
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0].name).toBe('Hip.position');
  });

  it('returns null for non-cloneable input', () => {
    expect(retargetClip(null, rebind)).toBe(null);
    expect(retargetClip({ tracks: [] }, rebind)).toBe(null);
  });
});

describe('collectTrackBoneNames', () => {
  it('collects distinct bones from a clip array', () => {
    const clips = [
      mockClip(['mixamorigHips.position', 'mixamorigSpine.quaternion']),
      mockClip(['mixamorigHips.quaternion', 'mixamorigLeftArm.position']),
    ];
    const bones = collectTrackBoneNames(clips);
    expect(bones).toEqual(['mixamorigHips', 'mixamorigSpine', 'mixamorigLeftArm']);
  });

  it('collects from a Map of name→clip', () => {
    const map = new Map([
      ['Idle_02', mockClip(['mixamorigHips.position'])],
      ['Walk', mockClip(['mixamorigLeftUpLeg.quaternion'])],
    ]);
    expect(collectTrackBoneNames(map)).toEqual(['mixamorigHips', 'mixamorigLeftUpLeg']);
  });

  it('returns empty for empty/undefined input', () => {
    expect(collectTrackBoneNames([])).toEqual([]);
    expect(collectTrackBoneNames(null)).toEqual([]);
  });
});
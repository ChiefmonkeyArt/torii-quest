// tests/stand-shoot-blend.test.js — locks the procedural "stand and shoot" blend
// (src/engine/character/standShootBlend.js). The library has only Run_Forward_Firing
// (a run+fire clip), so a stationary character firing used to replay that and its
// legs ran in place. The blend layers the firing clip's UPPER body (spine/arms/head)
// over the idle clip's LOWER body (hips/legs/feet), bakes a Stand_Shoot clip, and
// keeps the Hips rooted (idle position, no run stride).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { synthStandShoot, STAND_SHOOT_NAME } from '../src/engine/character/standShootBlend.js';

const IDENT = [0, 0, 0, 1];
const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).toArray();

function clip(name, tracks) {
  return new THREE.AnimationClip(name, 1.0, tracks);
}

describe('standShootBlend', () => {
  it('synthesizes a Stand_Shoot clip that mixes upper(fire) over lower(idle)', () => {
    const fire = clip('Run_Forward_Firing', [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0], [...IDENT]),   // lower — should NOT win
      new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0], [...rotX90]), // upper — wins
      new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', [0], [...rotX90]), // upper — wins
    ]);
    const idle = clip('Idle_02', [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0], [...rotX90]),  // lower — wins
      new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0], [...IDENT]),  // upper — ignored
    ]);

    const out = synthStandShoot(new Map([['Run_Forward_Firing', fire], ['Idle_02', idle]]), { fps: 2 });
    expect(out).not.toBeNull();
    expect(out.name).toBe(STAND_SHOOT_NAME);

    const hips = out.tracks.find((t) => t.name === 'Hips.quaternion');
    const spine = out.tracks.find((t) => t.name === 'Spine.quaternion');
    const arm = out.tracks.find((t) => t.name === 'LeftArm.quaternion');

    // Hips is LOWER → idle's rotX90 (not fire's identity).
    expect(new THREE.Quaternion(hips.values[0], hips.values[1], hips.values[2], hips.values[3])
      .angleTo(new THREE.Quaternion(...rotX90))).toBeLessThan(0.01);
    // Spine + LeftArm are UPPER → fire's rotX90.
    expect(new THREE.Quaternion(spine.values[0], spine.values[1], spine.values[2], spine.values[3])
      .angleTo(new THREE.Quaternion(...rotX90))).toBeLessThan(0.01);
    expect(new THREE.Quaternion(arm.values[0], arm.values[1], arm.values[2], arm.values[3])
      .angleTo(new THREE.Quaternion(...rotX90))).toBeLessThan(0.01);
  });

  it('keeps the Hips rooted (idle position carried, no run stride)', () => {
    const fire = clip('Run_Forward_Firing', [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0], [...IDENT]),
      new THREE.VectorKeyframeTrack('Hips.position', [0], [10, 0, 0]), // run stride forward
    ]);
    const idle = clip('Idle_02', [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0], [...IDENT]),
      new THREE.VectorKeyframeTrack('Hips.position', [0], [0.5, 0, 0]), // planted
    ]);
    const out = synthStandShoot(new Map([['Run_Forward_Firing', fire], ['Idle_02', idle]]), { fps: 2 });
    const pos = out.tracks.find((t) => t.name === 'Hips.position');
    expect(pos).toBeTruthy();
    expect(pos.values[0]).toBeCloseTo(0.5, 3); // idle's planted X, not fire's 10
  });

  it('returns null when either source clip is absent', () => {
    expect(synthStandShoot(new Map([['Idle_02', clip('Idle_02', [])]]))).toBeNull();
    expect(synthStandShoot(null)).toBeNull();
  });
});
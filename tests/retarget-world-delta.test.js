// tests/retarget-world-delta.test.js — locks the runtime world-delta animation
// retargeter (src/engine/character/retargetWorldDelta.js). This is the fix for
// the "custom character lying on its back in the mirror" bug and its follow-ups
// ("head tilted back" / "firing arms not showing"): the shared animation-library
// is authored Z-up (body axis -Z) while an uploaded mesh is Y-up (body axis +Y).
// A name-only remap applied the library's Z-up hips rotation verbatim and tipped
// the character supine; world-delta cancellation stands it up, and the per-bone
// shortest-arc bind alignment (A_bone) removes the residual twist that left the
// head pitched back and the firing-pose arms washed out.
//
// The buildBoneAlignment + retargetClipWorldDelta output is validated against the
// offline bake (tools/glb_retarget.py) on the real animation-library.glb →
// chiefmonkey7.glb pair: all 24 bones match to dot≈1 (Idle_02 and
// Run_Forward_Firing). These unit tests lock the same behaviour on a minimal rig.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildRigBind,
  buildBoneAlignment,
  retargetClipWorldDelta,
} from '../src/engine/character/retargetWorldDelta.js';

function rotX(deg) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg));
}
const IDENT = new THREE.Quaternion();

function masterRig() {
  // Z-up master (library-like): Hips rest is -90deg about X; the body (Hips →
  // Spine → …) runs along -Z (head at -Z). Spine's local offset is +Y so that,
  // through the Hips -90deg, it lands at world -Z — matching the real library
  // where FRAME (RotX+90) maps that -Z body axis to the target's +Y.
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  hips.add(spine);
  hips.quaternion.copy(rotX(-90));
  hips.position.set(0, 0, 0);
  spine.quaternion.copy(IDENT);
  spine.position.set(0, 0.4, 0);
  return [hips, spine];
}

function targetRig() {
  // Y-up target (uploaded mesh): Hips identity; head along +Y.
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  hips.add(spine);
  hips.quaternion.copy(IDENT);
  hips.position.set(0, 0, 0);
  spine.quaternion.copy(IDENT);
  spine.position.set(0, 0.4, 0);
  return [hips, spine];
}

// A 3-bone chain with a mid-chain bone (Spine) whose child (Head) direction is
// pitched +45deg in the master but straight in the target — the A_bone must bake
// a corrective alignment onto Spine, while the leaf Head stays identity.
function masterRigHeadTwist() {
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  const head = new THREE.Bone(); head.name = 'Head';
  spine.add(head);
  hips.add(spine);
  hips.quaternion.copy(rotX(-90));
  hips.position.set(0, 0, 0);
  spine.quaternion.copy(IDENT);
  spine.position.set(0, 0.4, 0);
  head.quaternion.copy(rotX(45));
  head.position.set(0, 0, -0.4);
  return [hips, spine, head];
}

function targetRigHeadStraight() {
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  const head = new THREE.Bone(); head.name = 'Head';
  spine.add(head);
  hips.add(spine);
  hips.quaternion.copy(IDENT);
  hips.position.set(0, 0, 0);
  spine.quaternion.copy(IDENT);
  spine.position.set(0, 0.4, 0);
  head.quaternion.copy(IDENT);
  head.position.set(0, 0.4, 0);
  return [hips, spine, head];
}

function bindIdleClip() {
  // A clip that reproduces the master's BIND pose (zero motion) — the
  // retargeted output must therefore reproduce the TARGET's bind pose.
  const h = rotX(-90).toArray();
  return new THREE.AnimationClip('Idle', 1.0, [
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...h, ...h]),
    new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

// Frame-consistent 3-bone chain with an OFF-AXIS Hips (so a non-root bone's
// WORLD rotation differs from its LOCAL). targetRigTilt is exactly the
// RotX(+90) frame-map of masterRigTilt: target Hips = RotX(+90)*RotX(-70)
// = RotX(+20). This is the case that exposed the parent-LOCAL bug below the
// hips (chiefmonkey's Hips rest is ~+19deg, not identity).
function masterRigTilt() {
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  const head = new THREE.Bone(); head.name = 'Head';
  spine.add(head); hips.add(spine);
  hips.quaternion.copy(rotX(-70));
  spine.quaternion.copy(IDENT); spine.position.set(0, 0.4, 0);
  head.quaternion.copy(IDENT); head.position.set(0, 0, -0.4);
  return [hips, spine, head];
}

function targetRigTilt() {
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  const head = new THREE.Bone(); head.name = 'Head';
  spine.add(head); hips.add(spine);
  hips.quaternion.copy(rotX(20));
  spine.quaternion.copy(IDENT); spine.position.set(0, 0.4, 0);
  head.quaternion.copy(IDENT); head.position.set(0, 0, -0.4);
  return [hips, spine, head];
}

function bindClipTilt() {
  const h = rotX(-70).toArray();
  return new THREE.AnimationClip('Bind', 1.0, [
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...h, ...h]),
    new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}


const REBIND = new Map([['Hips', 'Hips'], ['Spine', 'Spine'], ['Head', 'Head']]);

describe('buildRigBind', () => {
  it('computes parent-first order and world transforms', () => {
    const bind = buildRigBind(targetRig());
    expect(bind.names).toEqual(['Hips', 'Spine']);
    expect(bind.parentOf.get('Hips')).toBe(null);
    expect(bind.parentOf.get('Spine')).toBe('Hips');
    expect(bind.worldQ.get('Hips').angleTo(IDENT)).toBeLessThan(0.001);
    // spine world position: hips(0,0,0) + rotate((0,0.4,0), identity) = (0,0.4,0)
    expect(bind.worldP.get('Spine').y).toBeCloseTo(0.4, 5);
    // childOf records the first child per bone (used by the A_bone alignment)
    expect(bind.childOf.get('Hips')).toBe('Spine');
  });
});

describe('buildBoneAlignment', () => {
  it('returns identity when the target is the frame-map of the master (no residual twist)', () => {
    const A = buildBoneAlignment(buildRigBind(masterRig()), buildRigBind(targetRig()), REBIND);
    // Hips→Spine is -Z in the master (frame-maps to +Y) and +Y in the target:
    // aligned, so no corrective rotation.
    expect(A.get('Hips').angleTo(IDENT)).toBeLessThan(0.001);
  });

  it('bakes a corrective alignment onto a mid-chain bone whose child is pitched, but leaves the leaf identity', () => {
    const A = buildBoneAlignment(buildRigBind(masterRigHeadTwist()), buildRigBind(targetRigHeadStraight()), REBIND);
    // Spine's child (Head) direction is twisted in the master, so Spine needs a
    // real corrective rotation (-90deg about X) to stand the head back up.
    expect(A.get('Spine').angleTo(rotX(-90))).toBeLessThan(0.001);
    // Leaf bones (no child) keep identity.
    expect(A.get('Head').angleTo(IDENT)).toBeLessThan(0.001);
  });
});

describe('retargetClipWorldDelta', () => {
  it('stands a Z-up master bind clip up onto a Y-up target (hips -> identity)', () => {
    const out = retargetClipWorldDelta(bindIdleClip(), buildRigBind(masterRig()), buildRigBind(targetRig()), REBIND, { fps: 2 });
    expect(out).not.toBe(null);
    const hips = out.tracks.find((t) => t.name === 'Hips.quaternion');
    expect(hips).toBeTruthy();
    const q0 = new THREE.Quaternion(hips.values[0], hips.values[1], hips.values[2], hips.values[3]);
    // The old name-remap would leave this at ~90deg (the master's -90 X); the
    // world-delta path must cancel it to ~identity.
    expect(q0.angleTo(IDENT)).toBeLessThan(0.01);
  });

  it('emits finite, normalised quaternion tracks for every mapped bone', () => {
    const out = retargetClipWorldDelta(bindIdleClip(), buildRigBind(masterRig()), buildRigBind(targetRig()), REBIND, { fps: 3 });
    for (const t of out.tracks) {
      for (let i = 0; i < t.values.length; i += 4) {
        const q = new THREE.Quaternion(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
        expect(Number.isFinite(q.x)).toBe(true);
        expect(Number.isFinite(q.y)).toBe(true);
        expect(Number.isFinite(q.z)).toBe(true);
        expect(Number.isFinite(q.w)).toBe(true);
        expect(q.length()).toBeCloseTo(1, 3);
      }
    }
  });

  it('uses the parent baked WORLD (not local) when computing a deep-bone local', () => {
    const tgtBind = buildRigBind(targetRigTilt());
    const out = retargetClipWorldDelta(bindClipTilt(), buildRigBind(masterRigTilt()), tgtBind, REBIND, { fps: 2 });
    expect(out).not.toBe(null);
    // A bind clip must reproduce the TARGET bind locals for every bone. Head is
    // the witness: with the off-axis Hips (+20deg), the old parent-LOCAL bug left
    // it at rotX(20deg) instead of identity.
    for (const n of ['Hips', 'Spine', 'Head']) {
      const tr = out.tracks.find((t) => t.name === n + '.quaternion');
      expect(tr).toBeTruthy();
      const q = new THREE.Quaternion(tr.values[0], tr.values[1], tr.values[2], tr.values[3]);
      expect(q.angleTo(tgtBind.localQ.get(n))).toBeLessThan(0.01);
    }
  });

  it('interpolates across an opposite-hemisphere keyframe pair without throwing', () => {
    // Hips keyframes [0,0,0,1] and [0,0,0,-1] are the SAME rotation in opposite
    // quaternion hemispheres (dot<0). Sampling mid-way forces the slerp branch,
    // which used to call the nonexistent Quaternion.multiplyScalar and throw.
    const clip = new THREE.AnimationClip('Cross', 1.0, [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, -1]),
      new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const out = retargetClipWorldDelta(clip, buildRigBind(masterRig()), buildRigBind(targetRig()), REBIND, { fps: 3 });
    expect(out).not.toBe(null);
    const hips = out.tracks.find((t) => t.name === 'Hips.quaternion');
    expect(hips.values.length).toBeGreaterThan(4); // >1 sampled frame → slerp ran
    for (let i = 0; i < hips.values.length; i += 4) {
      const q = new THREE.Quaternion(hips.values[i], hips.values[i + 1], hips.values[i + 2], hips.values[i + 3]);
      expect(Number.isFinite(q.x)).toBe(true);
      expect(q.length()).toBeCloseTo(1, 3);
    }
  });

  it('returns null for a non-cloneable clip or empty rebind', () => {
    expect(retargetClipWorldDelta(null, null, null, REBIND)).toBe(null);
    expect(retargetClipWorldDelta(bindIdleClip(), buildRigBind(masterRig()), buildRigBind(targetRig()), new Map())).toBe(null);
  });
});
// tests/retarget-world-delta.test.js — locks the runtime world-delta animation
// retargeter (src/engine/character/retargetWorldDelta.js). This is the fix for
// the "custom character lying on its back in the mirror" bug: the shared
// animation-library is authored Z-up (its Hips rest is ~-90deg about X) while an
// uploaded mesh is Y-up, so the old NAME-ONLY remap applied the library's Z-up
// hips rotation verbatim and tipped the character supine.
//
// These tests prove the world-delta retarget CANCELS the master's Z-up rest and
// re-applies the target's Y-up rest, so a "bind" clip (no motion) leaves the
// target standing (identity hips), not tilted.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRigBind, retargetClipWorldDelta } from '../src/engine/character/retargetWorldDelta.js';

function rotX(deg) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg));
}
const IDENT = new THREE.Quaternion();

function masterRig() {
  // Z-up master (library-like): Hips rest is -90deg about X; head along -Z.
  const hips = new THREE.Bone(); hips.name = 'Hips';
  const spine = new THREE.Bone(); spine.name = 'Spine';
  hips.add(spine);
  hips.quaternion.copy(rotX(-90));
  hips.position.set(0, 0, 0);
  spine.quaternion.copy(IDENT);
  spine.position.set(0, 0, -0.4);
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

function bindIdleClip() {
  // A clip that reproduces the master's BIND pose (zero motion) — the
  // retargeted output must therefore reproduce the TARGET's bind pose.
  const h = rotX(-90).toArray();
  return new THREE.AnimationClip('Idle', 1.0, [
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...h, ...h]),
    new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

const REBIND = new Map([['Hips', 'Hips'], ['Spine', 'Spine']]);

describe('buildRigBind', () => {
  it('computes parent-first order and world transforms', () => {
    const bind = buildRigBind(targetRig());
    expect(bind.names).toEqual(['Hips', 'Spine']);
    expect(bind.parentOf.get('Hips')).toBe(null);
    expect(bind.parentOf.get('Spine')).toBe('Hips');
    expect(bind.worldQ.get('Hips').angleTo(IDENT)).toBeLessThan(0.001);
    // spine world position: hips(0,0,0) + rotate((0,0.4,0), identity) = (0,0.4,0)
    expect(bind.worldP.get('Spine').y).toBeCloseTo(0.4, 5);
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

  it('returns null for a non-cloneable clip or empty rebind', () => {
    expect(retargetClipWorldDelta(null, null, null, REBIND)).toBe(null);
    expect(retargetClipWorldDelta(bindIdleClip(), buildRigBind(masterRig()), buildRigBind(targetRig()), new Map())).toBe(null);
  });
});
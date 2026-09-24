import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { firstPersonArmJoints, maskFirstPersonArms, firstPersonLocomotion } from '../src/engine/character/firstPersonBodyMask.js';

function fixture(indexed = true) {
  const bones = ['Hips', 'mixamorig:RightShoulder', 'RightArm', 'RightHand', 'finger01', 'LeftFoot'].map(name => {
    const bone = new THREE.Bone(); bone.name = name; return bone;
  });
  bones[0].add(bones[1], bones[5]);
  bones[1].add(bones[2]); bones[2].add(bones[3]); bones[3].add(bones[4]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    3,0,0,0, 4,0,0,0, 2,0,0,0,
    0,0,0,0, 5,0,0,0, 0,0,0,0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1,0,0,0, 1,0,0,0, 1,0,0,0,
    1,0,0,0, 1,0,0,0, 1,0,0,0,
  ], 4));
  if (indexed) geometry.setIndex([0,1,2,3,4,5]);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

describe('FP weapon/body rendering ownership', () => {
  it.each([true, false])('removes empty arms but preserves torso/feet (indexed=%s)', indexed => {
    const mesh = fixture(indexed);
    const original = mesh.geometry;
    expect(maskFirstPersonArms(mesh)).toBe(1);
    expect([...mesh.geometry.index.array]).toEqual([3,4,5]);
    expect(mesh.geometry).not.toBe(original);
    expect(original.index?.count ?? original.attributes.position.count).toBe(6);
    expect(maskFirstPersonArms(mesh)).toBe(0);
  });
  it('includes fingers descended from a recognised arm, not legs', () => {
    expect([...firstPersonArmJoints(fixture().skeleton.bones)]).toEqual([1,2,3,4]);
  });
  it('recognises Mixamo prefixes and separator naming', () => {
    const bones = ['mixamorigLeftArm','right_upper_arm','Left_ForeArm','right_hand','RightUpLeg'].map(name => {
      const b = new THREE.Bone(); b.name = name; return b;
    });
    expect([...firstPersonArmJoints(bones)]).toEqual([0,1,2,3]);
  });
  it('preserves material-group indices after filtering', () => {
    const mesh = fixture();
    mesh.geometry.addGroup(0,3,0); mesh.geometry.addGroup(3,3,1);
    maskFirstPersonArms(mesh);
    expect(mesh.geometry.groups).toEqual([
      {start:0,count:0,materialIndex:0}, {start:0,count:3,materialIndex:1},
    ]);
  });
  it('sums split arm influences instead of checking only the strongest joint', () => {
    const mesh = fixture();
    mesh.geometry.attributes.skinIndex.setXYZW(3,0,1,2,0);
    mesh.geometry.attributes.skinWeight.setXYZW(3,0.4,0.3,0.3,0);
    expect(maskFirstPersonArms(mesh)).toBe(2);
    expect(mesh.geometry.index.count).toBe(0);
  });
  it('leaves static meshes and unrecognised rigs unchanged', () => {
    expect(maskFirstPersonArms(new THREE.Mesh())).toBe(0);
    const mesh = fixture();
    mesh.skeleton.bones.forEach(b => { b.name = 'unknown'; });
    const original = mesh.geometry;
    expect(maskFirstPersonArms(mesh)).toBe(0);
    expect(mesh.geometry).toBe(original);
  });
});

describe('stationary gate locomotion', () => {
  it('idles without displacement even with sprint held', () => {
    expect(firstPersonLocomotion(0, 1/60, true)).toBe('idle');
  });
  it('walks/runs only with real displacement', () => {
    expect(firstPersonLocomotion(0.04, 1/60, false)).toBe('walk');
    expect(firstPersonLocomotion(0.1, 1/60, true)).toBe('run');
  });
  it.each([[0.1,0],[NaN,1],[1,NaN],[3,1/60],[100,1/60],[0.0001,1/60]])(
    'does not treat invalid deltas, teleport or numerical jitter as walking (%s,%s)', (distance, dt) => {
      expect(firstPersonLocomotion(distance, dt, true)).toBe('idle');
    },
  );
});

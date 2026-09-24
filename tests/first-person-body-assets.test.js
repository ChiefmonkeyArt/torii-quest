import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';
import * as THREE from 'three';
import { maskFirstPersonArms, firstPersonArmJoints } from '../src/engine/character/firstPersonBodyMask.js';

let io;
beforeAll(async () => {
  io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule({}),
  });
});

describe('real shipped FP meshes', () => {
  it.each(['chiefmonkey', 'guest', 'nostrich'])('%s has no drawable arm-dominant triangles after preparation', async character => {
    const doc = await io.readBinary(await readFile(new URL(`../public/${character}-headless.glb`, import.meta.url)));
    const skin = doc.getRoot().listSkins()[0];
    const joints = skin.listJoints();
    const byNode = new Map(joints.map(n => {
      const bone = new THREE.Bone(); bone.name = n.getName(); return [n, bone];
    }));
    for (const [node, bone] of byNode) {
      for (const child of node.listChildren()) if (byNode.has(child)) bone.add(byNode.get(child));
    }
    const bones = joints.map(n => byNode.get(n));
    const arms = firstPersonArmJoints(bones);
    expect(arms.size).toBeGreaterThanOrEqual(8);
    for (const primitive of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
      const geometry = new THREE.BufferGeometry();
      for (const [semantic, name] of [['POSITION','position'],['JOINTS_0','skinIndex'],['WEIGHTS_0','skinWeight']]) {
        const attr = primitive.getAttribute(semantic);
        geometry.setAttribute(name, new THREE.BufferAttribute(attr.getArray(), attr.getElementSize(), attr.getNormalized()));
      }
      geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray(), 1));
      const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
      mesh.bind(new THREE.Skeleton(bones));
      const before = geometry.index.count;
      expect(maskFirstPersonArms(mesh)).toBeGreaterThan(0);
      expect(mesh.geometry.index.count).toBeGreaterThan(before * 0.25);
      expect(geometry.index.count).toBe(before);
      const weights = mesh.geometry.attributes.skinWeight;
      const indices = mesh.geometry.attributes.skinIndex;
      const visibleJoints = new Set();
      for (const vertex of new Set(mesh.geometry.index.array)) {
        let arm = 0, total = 0;
        for (let c = 0; c < indices.itemSize; c++) {
          const w = weights.getComponent(vertex,c), joint = indices.getComponent(vertex,c);
          total += w;
          if (arms.has(joint)) arm += w;
          if (w > 0.5) visibleJoints.add(bones[joint].name);
        }
        expect(arm).toBeLessThan(total * 0.5);
      }
      expect(visibleJoints.has('LeftFoot')).toBe(true);
      expect(visibleJoints.has('RightFoot')).toBe(true);
      expect([...visibleJoints].some(n => n.startsWith('Spine'))).toBe(true);
    }
  });
});

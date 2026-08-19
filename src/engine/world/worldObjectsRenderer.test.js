// src/engine/world/worldObjectsRenderer.test.js — locks the Phase 0e
// data-driven object renderer (buildWorldObjects). Vitest in node: THREE works
// headlessly for Scene/Geometry/Mesh construction, and the GLTFLoader is
// injected as a fake `loadGltf` so no real GLB fetch happens. Asserts: primitive
// meshes are added to the scene, GLB loads are awaited via `ready`, a failed
// GLB leaves a placeholder + never throws, tick is no-op-safe, object cap
// respected at render. Mirrors the existing worldRenderer.test.js THREE-stub
// pattern (real `three` in node, no WebGL needed).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from './worldSchema.js';
import { buildWorldObjects } from './worldObjectsRenderer.js';

// A fake loadGltf that resolves a stub Group (the shape GLTFLoader.loadAsync
// returns: { scene: THREE.Group }). Tests pass this so no real GLB is fetched.
function fakeLoadGltfOk() {
  return (url) => Promise.resolve({ scene: new THREE.Group() });
}

// A fake loadGltf that always rejects (simulates a failed GLB load).
function fakeLoadGltfReject() {
  return (url) => Promise.reject(new Error(`load failed: ${url}`));
}

// A fake assetUrl that just prefixes a base (mirrors the real helper's shape
// without depending on import.meta.env).
const fakeAssetUrl = (p) => `/base/${String(p).replace(/^\/+/, '')}`;

describe('buildWorldObjects — primitives', () => {
  it('adds primitive meshes (box/cylinder/plane) to the scene', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [
        { type: 'box', position: [0, 0, 0] },
        { type: 'cylinder', position: [1, 0, 1] },
        { type: 'plane', position: [2, 0, 2] },
      ],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const meshes = scene.children.filter((c) => c.isMesh);
    expect(meshes.length).toBe(3);
    // No GLB objects → ready is null.
    expect(rt.ready).toBeNull();
    expect(typeof rt.tick).toBe('function');
  });

  it('applies position/rotation/scale/color to primitive meshes', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [1, 2, 3], rotation: [0, 1.5, 0], scale: 2, color: '#ff0000' }],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const mesh = scene.children.find((c) => c.isMesh);
    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
    expect(mesh.rotation.y).toBe(1.5);
    expect(mesh.scale.x).toBe(2);
    expect(mesh.scale.y).toBe(2);
    expect(mesh.scale.z).toBe(2);
  });

  it('applies a [x,y,z] scale array to primitive meshes', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [0, 0, 0], scale: [2, 3, 4] }],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const mesh = scene.children.find((c) => c.isMesh);
    expect(mesh.scale.x).toBe(2);
    expect(mesh.scale.y).toBe(3);
    expect(mesh.scale.z).toBe(4);
  });
});

describe('buildWorldObjects — GLB loads', () => {
  it('returns a ready promise for gltf objects and awaits it', async () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'gltf', model: 'gate.glb', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk(), assetUrl: fakeAssetUrl });
    expect(rt.ready).toBeInstanceOf(Promise);
    // A placeholder is added immediately (scene not empty while loading).
    expect(scene.children.length).toBeGreaterThanOrEqual(1);
    // Await ready — resolves (allSettled, never rejects).
    const settled = await rt.ready;
    expect(Array.isArray(settled)).toBe(true);
    expect(settled.length).toBe(1);
    expect(settled[0].status).toBe('fulfilled');
  });

  it('resolves a torii-gate object (named alias, no model required)', async () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'torii-gate', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    let loadedUrl = '';
    const loadGltf = (url) => { loadedUrl = url; return Promise.resolve({ scene: new THREE.Group() }); };
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf, assetUrl: fakeAssetUrl });
    expect(rt.ready).toBeInstanceOf(Promise);
    await rt.ready;
    // The named alias resolves to torii-gate.glb through assetUrl.
    expect(loadedUrl).toBe('/base/torii-gate.glb');
  });

  it('leaves a placeholder + never throws on a failed GLB load', async () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'gltf', model: 'gate.glb', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfReject(), assetUrl: fakeAssetUrl });
    // A placeholder is added immediately.
    const beforeCount = scene.children.length;
    expect(beforeCount).toBeGreaterThanOrEqual(1);
    // ready never rejects (allSettled).
    const settled = await rt.ready;
    expect(settled[0].status).toBe('rejected');
    // The placeholder remains after the failed load (scene not empty).
    expect(scene.children.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves the model path through the injected assetUrl', async () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'gltf', model: 'models/scene.gltf', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    let loadedUrl = '';
    const loadGltf = (url) => { loadedUrl = url; return Promise.resolve({ scene: new THREE.Group() }); };
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf, assetUrl: fakeAssetUrl });
    await rt.ready;
    expect(loadedUrl).toBe('/base/models/scene.gltf');
  });
});

describe('buildWorldObjects — tick + guards', () => {
  it('tick is no-op-safe (no throw with/without dt, no spin without flag)', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    expect(() => rt.tick(0.016)).not.toThrow();
    expect(() => rt.tick()).not.toThrow();
    expect(() => rt.tick(null)).not.toThrow();
  });

  it('returns a no-op tick + null ready for a null/empty world', () => {
    const scene = new THREE.Scene();
    const r1 = buildWorldObjects(null, { scene, THREE });
    expect(typeof r1.tick).toBe('function');
    expect(r1.ready).toBeNull();
    expect(() => r1.tick(0.016)).not.toThrow();
    // Empty objects array.
    const r2 = buildWorldObjects({ objects: [] }, { scene, THREE });
    expect(r2.ready).toBeNull();
    expect(() => r2.tick(0.016)).not.toThrow();
  });

  it('respects the object cap at render (64 validated objects all render)', () => {
    const objs = Array.from({ length: 64 }, () => ({ type: 'box', position: [0, 0, 0] }));
    const v = validateWorld({ version: 1, id: 'x', name: 'X', objects: objs });
    expect(v.ok).toBe(true);
    expect(v.world.objects).toHaveLength(64);
    const scene = new THREE.Scene();
    buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const meshes = scene.children.filter((c) => c.isMesh);
    expect(meshes.length).toBe(64);
  });

  it('spins objects flagged spin (rotation.y advances on tick)', () => {
    // The schema doesn't validate `spin` (it's a renderer-only hint), so we
    // build the world objects array directly with a spin flag to test the tick.
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      objects: [{ type: 'box', position: [0, 0, 0] }],
    });
    expect(v.ok).toBe(true);
    // Inject the spin flag post-validation (renderer reads obj.spin).
    v.world.objects[0].spin = true;
    const scene = new THREE.Scene();
    const rt = buildWorldObjects(v.world, { scene, THREE, loadGltf: fakeLoadGltfOk() });
    const mesh = scene.children.find((c) => c.isMesh);
    const before = mesh.rotation.y;
    rt.tick(0.1);
    expect(mesh.rotation.y).toBeGreaterThan(before);
  });
});

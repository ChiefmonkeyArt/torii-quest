import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMuzzleFlashPool } from '../../src/engine/render/muzzleFlash.js';

describe('muzzle flash light pool', () => {
  it('creates the fixed pool with every light initially inactive', () => {
    const scene = new THREE.Scene();
    createMuzzleFlashPool(scene, { size: 6 });

    expect(scene.children).toHaveLength(6);
    for (const light of scene.children) {
      expect(light).toBeInstanceOf(THREE.PointLight);
      expect(light.visible).toBe(false);
      expect(light.castShadow).toBe(false);
    }
  });

  it('activates a muzzle light with the configured position and color', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { size: 1 });

    expect(pool.trigger('muzzle', { x: 1, y: 2, z: 3 })).toBe(true);
    const light = scene.children[0];
    expect(light.visible).toBe(true);
    expect(light.position.toArray()).toEqual([1, 2, 3]);
    expect(light.color.getHex()).toBe(0xffaa44);
    expect(light.intensity).toBe(3);
    expect(light.distance).toBe(8);
  });

  it('decays intensity and hides the light at the end of its lifetime', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { size: 1 });
    const light = scene.children[0];
    pool.trigger('impact', { x: 0, y: 0, z: 0 });

    pool.tick(0.06);
    expect(light.intensity).toBeCloseTo(1);
    expect(light.visible).toBe(true);

    pool.tick(0.06);
    expect(light.intensity).toBe(0);
    expect(light.visible).toBe(false);
  });

  it('reuses an expired light instead of creating another one', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { size: 1 });
    const light = scene.children[0];
    pool.trigger('muzzle', { x: 0, y: 0, z: 0 });
    pool.tick(0.08);

    expect(pool.trigger('botHit', { x: 4, y: 5, z: 6 })).toBe(true);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(light);
    expect(light.position.toArray()).toEqual([4, 5, 6]);
    expect(light.color.getHex()).toBe(0xff4422);
  });

  it('skips flashes on the LOW quality tier', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, {
      size: 1,
      getQualityTier: () => 'LOW',
    });

    expect(pool.trigger('muzzle', { x: 1, y: 2, z: 3 })).toBe(false);
    expect(scene.children[0].visible).toBe(false);
  });

  it('caps simultaneously active lights at the tier budget', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, {
      getQualityTier: () => 'NORMAL',
    });

    for (let i = 0; i < 4; i++) {
      expect(pool.trigger('muzzle', { x: i, y: 2, z: 3 })).toBe(true);
    }
    expect(pool.trigger('muzzle', { x: 5, y: 2, z: 3 })).toBe(false);
    expect(scene.children.filter((light) => light.visible)).toHaveLength(4);
  });
});

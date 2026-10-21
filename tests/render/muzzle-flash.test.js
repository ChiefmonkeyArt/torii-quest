import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMuzzleFlashPool, FLASH_LIGHTS } from '../../src/engine/render/muzzleFlash.js';
import { TIERS } from '../../src/engine/render/qualityTier.js';

// ADR-0141: three.js bakes the VISIBLE light count into every lit shader, so a
// light toggled on/off recompiles every lit material (the first-fight freeze).
// The pool's lights are therefore always visible; idle = intensity 0.
const visibleCount = (scene) => scene.children.filter((l) => l.visible).length;

describe('muzzle flash light pool (constant light count)', () => {
  it('creates the fixed pool: every light visible, dark, no shadows', () => {
    const scene = new THREE.Scene();
    createMuzzleFlashPool(scene, { size: 6 });
    expect(scene.children).toHaveLength(6);
    for (const light of scene.children) {
      expect(light).toBeInstanceOf(THREE.PointLight);
      expect(light.visible).toBe(true);
      expect(light.intensity).toBe(0);
      expect(light.castShadow).toBe(false);
    }
  });

  it('defaults to the same FLASH_LIGHTS on every tier; tiers only cap how many are lit', () => {
    const scene = new THREE.Scene();
    createMuzzleFlashPool(scene, { getQualityTier: () => 'LOW' });
    expect(scene.children).toHaveLength(FLASH_LIGHTS);
    for (const t of Object.values(TIERS)) expect(t.muzzleLights).toBeLessThanOrEqual(FLASH_LIGHTS);
  });

  it('activates a muzzle light with the configured position and color', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { size: 1 });
    expect(pool.trigger('muzzle', { x: 1, y: 2, z: 3 })).toBe(true);
    const light = scene.children[0];
    expect(light.position.toArray()).toEqual([1, 2, 3]);
    expect(light.color.getHex()).toBe(0xffaa44);
    expect(light.intensity).toBe(3);
    expect(light.distance).toBe(8);
    expect(pool.activeCount()).toBe(1);
  });

  it('decays, then goes dark WITHOUT changing visibility', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { size: 1 });
    const light = scene.children[0];
    pool.trigger('impact', { x: 0, y: 0, z: 0 });
    pool.tick(0.06);
    expect(light.intensity).toBeCloseTo(1);
    pool.tick(0.06);
    expect(light.intensity).toBe(0);
    expect(light.visible).toBe(true);
    expect(pool.activeCount()).toBe(0);
  });

  it('the visible light count never changes through a whole fight or a tier change', () => {
    const scene = new THREE.Scene();
    let tier = 'HIGH';
    const pool = createMuzzleFlashPool(scene, { getQualityTier: () => tier });
    const n = visibleCount(scene);
    for (let i = 0; i < 50; i++) {
      pool.trigger(i % 2 ? 'muzzle' : 'botHit', { x: i, y: 1, z: 0 });
      pool.tick(0.03);
      if (i === 20) tier = 'NORMAL';
      if (i === 35) tier = 'LOW';
      expect(visibleCount(scene)).toBe(n);
    }
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
    const pool = createMuzzleFlashPool(scene, { size: 1, getQualityTier: () => 'LOW' });
    expect(pool.trigger('muzzle', { x: 1, y: 2, z: 3 })).toBe(false);
    expect(scene.children[0].intensity).toBe(0);
  });

  it('caps simultaneously lit lights at the tier budget', () => {
    const scene = new THREE.Scene();
    const pool = createMuzzleFlashPool(scene, { getQualityTier: () => 'NORMAL' });
    for (let i = 0; i < TIERS.NORMAL.muzzleLights; i++) expect(pool.trigger('muzzle', { x: i, y: 2, z: 3 })).toBe(true);
    expect(pool.trigger('muzzle', { x: 5, y: 2, z: 3 })).toBe(false);
    expect(pool.activeCount()).toBe(TIERS.NORMAL.muzzleLights);
  });
});

// src/engine/world/worldRenderer.test.js — smoke test for buildMinimalWorld.
// THREE works headlessly in node (no WebGL needed for Scene/Geometry/Mesh
// construction), so this is a light integration smoke: feed the gateway-blank
// manifest shape through validateWorld → buildMinimalWorld and assert it returns
// a { tick } without throwing, with the expected platform/spawn exposed.
// Full visual correctness is covered by `npx vite build` (compile) + manual play.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from './worldSchema.js';
import { buildMinimalWorld } from './worldRenderer.js';

// The shipped gateway-blank manifest (mirrors worlds/gateway-blank/world.json).
const GATEWAY_BLANK = {
  version: 1,
  id: 'gateway-blank',
  name: 'Torii Gateway — Blank',
  sky: { type: 'space', color: '#05050f', stars: true },
  platform: { type: 'cloud', size: 40, color: '#c4b5fd' },
  gateway: { position: [0, 0, -8], target: [0, 0, 0], relays: [] },
  spawn: { position: [0, 0, 0], yaw: 0 },
  lights: [
    { kind: 'ambient', color: '#3b3b5c', intensity: 0.6 },
    { kind: 'directional', color: '#ffffff', intensity: 0.9, position: [8, 12, 6] },
  ],
};

describe('buildMinimalWorld — smoke', () => {
  it('returns a { tick, platformY, spawn } without throwing for a valid world', () => {
    const v = validateWorld(GATEWAY_BLANK);
    expect(v.ok).toBe(true);
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    const rt = buildMinimalWorld(v.world, { scene, sun, THREE });
    expect(typeof rt.tick).toBe('function');
    expect(typeof rt.platformY).toBe('number');
    expect(rt.spawn).toBeTruthy();
    expect(rt.spawn.x).toBe(0);
    expect(rt.spawn.z).toBe(0);
    expect(rt.spawn.yaw).toBe(0);
    // tick is safe to call with a dt and with no arg.
    expect(() => rt.tick(0.016)).not.toThrow();
    expect(() => rt.tick()).not.toThrow();
  });

  it('adds the starfield + platform + gateway to the scene', () => {
    const v = validateWorld(GATEWAY_BLANK);
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    buildMinimalWorld(v.world, { scene, sun, THREE });
    // scene.children should include at least the Points (stars), the platform
    // Mesh, the rim Mesh, the gateway Mesh, ambient + directional lights.
    const types = scene.children.map(c => c.constructor.name);
    expect(types).toContain('Points');
    expect(types).toContain('Mesh');
    expect(types).toContain('AmbientLight');
    // scene.background should be a Color (the space sky).
    expect(scene.background).toBeInstanceOf(THREE.Color);
  });

  it('returns a no-op tick for a null world', () => {
    const scene = new THREE.Scene();
    const rt = buildMinimalWorld(null, { scene, sun: null, THREE });
    expect(typeof rt.tick).toBe('function');
    expect(rt.platformY).toBe(0);
    expect(rt.spawn).toBeNull();
    expect(() => rt.tick(0.016)).not.toThrow();
  });
});

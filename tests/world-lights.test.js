// tests/world-lights.test.js — locks the Phase 0k.7 data-driven scene lights.
// world.lights (top-level array, validated by worldSchema) already supported
// ambient/directional/point; this PR adds `hemisphere` (sky/ground fill) +
// preserves `distance` (legacy point lights use 10/12/22, not the hardcoded 30)
// + `groundColor`. buildMinimalWorld builds the THREE lights from world.lights.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { buildMinimalWorld } from '../src/engine/world/worldRenderer.js';
import { sampleNapHeight } from '../src/terrain/heightmap.js';
import { TRAVEL_GATE_X, TRAVEL_GATE_Z } from '../src/config.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));

describe('worldSchema — lights', () => {
  it('preserves hemisphere (groundColor) + point (distance) lights', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X',
      lights: [
        { kind: 'hemisphere', color: '#1ad6c4', groundColor: '#b9a06b', intensity: 0.5 },
        { kind: 'point', color: '#8b5cf6', intensity: 3, distance: 10, position: [-25, 5.1, 3] },
      ],
    });
    expect(v.ok).toBe(true);
    const [hemi, pt] = v.world.lights;
    expect(hemi.kind).toBe('hemisphere');
    expect(hemi.groundColor).toBe('#b9a06b');
    expect(pt.kind).toBe('point');
    expect(pt.distance).toBe(10);
    expect(pt.position).toEqual([-25, 5.1, 3]);
  });

  it('drops an unknown light kind but keeps other valid fields (ok stays true)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', lights: [{ kind: 'flood', intensity: 1 }] });
    expect(v.ok).toBe(true);
    // 'flood' is not a valid kind → kind dropped; intensity survives (permissive
    // per-item style mirrors objects[]). The renderer's kind-switch is a no-op
    // for a kindless light, so it's harmless.
    expect(v.world.lights).toHaveLength(1);
    expect(v.world.lights[0].kind).toBeUndefined();
    expect(v.world.lights[0].intensity).toBe(1);
  });

  it('rejects a non-positive distance (dropped)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', lights: [
      { kind: 'point', color: '#fff', intensity: 1, distance: -5, position: [0, 0, 0] },
    ] });
    expect(v.ok).toBe(true);
    // distance dropped, but the light itself (kind/color/intensity/position) is kept.
    expect(v.world.lights[0].distance).toBeUndefined();
  });
});

describe('buildMinimalWorld — lights', () => {
  it('builds a PointLight with the baked distance (not the hardcoded 30)', () => {
    const scene = new THREE.Scene();
    buildMinimalWorld(
      { version: 1, id: 'x', name: 'X', lights: [{ kind: 'point', color: '#8b5cf6', intensity: 3, distance: 10, position: [-25, 5.1, 3] }] },
      { scene, THREE },
    );
    const pt = scene.children.find((c) => c.isPointLight);
    expect(pt).toBeTruthy();
    expect(pt.distance).toBe(10);
    expect(pt.intensity).toBe(3);
    expect(pt.position.x).toBe(-25);
  });

  it('builds a HemisphereLight with sky + ground colors', () => {
    const scene = new THREE.Scene();
    buildMinimalWorld(
      { version: 1, id: 'x', name: 'X', lights: [{ kind: 'hemisphere', color: '#1ad6c4', groundColor: '#b9a06b', intensity: 0.5 }] },
      { scene, THREE },
    );
    const hemi = scene.children.find((c) => c.isHemisphereLight);
    expect(hemi).toBeTruthy();
    expect(hemi.intensity).toBe(0.5);
    expect(hemi.color.getHex()).toBe(0x1ad6c4);
    expect(hemi.groundColor.getHex()).toBe(0xb9a06b);
  });
});

describe('chiefmonkey-template ships the legacy lights', () => {
  it('has exactly the 4 legacy lights (hemisphere + 3 points)', () => {
    expect(world.lights).toHaveLength(4);
    const kinds = world.lights.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'point')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'hemisphere')).toHaveLength(1);
  });

  it('torii accent: purple, intensity 3, distance 10, at the torii gate', () => {
    const t = world.lights.find((l) => l.color === '#8b5cf6');
    expect(t).toBeTruthy();
    expect(t.intensity).toBe(3);
    expect(t.distance).toBe(10);
    expect(t.position[0]).toBe(-25); // BRIDGE_X - 1
    expect(t.position[2]).toBe(3);   // BRIDGE_Z
  });

  it('travel-gateway light Y is baked from sampleNapHeight + 4 (no runtime sampling)', () => {
    const trav = world.lights.find((l) => l.color === '#1ad6c4' && l.kind === 'point');
    expect(trav).toBeTruthy();
    const expectedY = 4 + sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z);
    expect(trav.position[1]).toBeCloseTo(expectedY, 4);
    expect(trav.distance).toBe(12);
  });

  it('NAP accent: teal #6ad9d0, intensity 2, distance 22', () => {
    const nap = world.lights.find((l) => l.color === '#6ad9d0');
    expect(nap).toBeTruthy();
    expect(nap.intensity).toBe(2);
    expect(nap.distance).toBe(22);
  });
});

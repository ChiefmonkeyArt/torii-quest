// arrival-camera.test.js — locks the destination-world PREVIEW pose (Bug B, the
// directory "peek"): the mirror camera must sit at the traveller's ARRIVAL point,
// lifted to eye height above the terrain, facing into the world with its back to
// the torii gate — not a distant 3/4 bird's-eye, and not the through-portal
// window mapping. This is the pose the user described: "a person who has just
// stepped out the other side and is looking around."
import { describe, it, expect } from 'vitest';
import { resolveArrivalCamera } from '../../src/engine/world/arrivalCamera.js';

// A manifest with a gate and an inline-terrain zone whose surface is at a known
// height near the gate, so the eye-height lift is deterministic.
const WORLD = {
  id: 'bekka-world',
  name: 'Bekka World',
  spawn: { position: [-14, 3.1, -14], yaw: -2.356 },
  gateway: { position: [20, 0, 0] },
  objects: [
    { type: 'torii-gate', position: [20, 0, 0], rotation: [0, 0, 0] },
  ],
  terrain: {
    zones: [
      {
        rows: 3, cols: 3,
        scale: [10, 10, 10],
        offset: [20, 5, 0],   // centred on the gate X; ground surface ~5
        heights: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], // h=0.5 → worldY 5+5=10
      },
    ],
  },
};

describe('resolveArrivalCamera', () => {
  it('sits at the arrival point (just inside the gate), not the owner spawn', () => {
    const cam = resolveArrivalCamera(WORLD);
    // Arrival is the gate inset ~2.6 into the world; spawn is at (-14,-14).
    expect(Math.hypot(cam.position.x - 20, cam.position.z - 0)).toBeCloseTo(2.6, 1);
    expect(Math.abs(cam.position.x - (-14))).toBeGreaterThan(20);
  });

  it('sets the eye height to the terrain surface plus PORTAL_EYE_HEIGHT', () => {
    // The zone puts the ground at worldY 10 (h=0.5 × scaleY 10 + offsetY 5) at the
    // arrival point; the camera eye must sit PORTAL_EYE_HEIGHT (1.6) above it.
    const cam = resolveArrivalCamera(WORLD);
    expect(cam.position.y).toBeCloseTo(10 + 1.6, 1);
  });

  it('faces into the world (away from the gate toward the interior)', () => {
    const cam = resolveArrivalCamera(WORLD);
    // Gate at (20,0), spawn at (-14,-14): interior is -x/-z, so forward leans
    // negative in both X and Z (matching resolveArrival's convention).
    expect(cam.forward.x).toBeLessThan(0);
    expect(cam.forward.z).toBeLessThan(0);
    // forward is a unit vector in the XZ plane.
    expect(Math.hypot(cam.forward.x, cam.forward.z)).toBeCloseTo(1, 5);
  });

  it('stays at eye height over flat ground (ground floor = eye height) when no terrain', () => {
    const { terrain, ...noTerrain } = WORLD;
    const cam = resolveArrivalCamera(noTerrain);
    // No terrain → ground is null → eye height = 0 + PORTAL_EYE_HEIGHT.
    expect(cam.position.y).toBeCloseTo(1.6, 1);
  });
});
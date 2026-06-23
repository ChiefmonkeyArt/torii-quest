// aim.test.js — locks the v0.2.126 barrel-to-crosshair aiming math.
// Pure (no Three/Rapier), so it runs node-fast.
import { describe, it, expect } from 'vitest';
import { crosshairPoint, aimDirection, CONVERGE_DIST } from '../src/engine/combat/aim.js';

const v = () => ({ x: 0, y: 0, z: 0 });
const norm = (o) => Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);

describe('crosshairPoint', () => {
  it('walks the camera ray to the target distance', () => {
    const out = crosshairPoint(0, 1.7, 0, 0, 0, -1, 10, v());
    expect(out).toEqual({ x: 0, y: 1.7, z: -10 });
  });

  it('scales a diagonal unit dir correctly', () => {
    const d = 1 / Math.sqrt(2);
    const out = crosshairPoint(0, 0, 0, d, 0, -d, Math.sqrt(2), v());
    expect(out.x).toBeCloseTo(1, 12);
    expect(out.z).toBeCloseTo(-1, 12);
  });

  it('uses CONVERGE_DIST as a sane open-sky fallback', () => {
    expect(CONVERGE_DIST).toBeGreaterThanOrEqual(40);
    const out = crosshairPoint(0, 1.7, 0, 0, 0, -1, CONVERGE_DIST, v());
    expect(out.z).toBeCloseTo(-CONVERGE_DIST, 12);
  });
});

describe('aimDirection', () => {
  it('returns a unit vector', () => {
    const out = aimDirection(0, 0, 0, 3, 4, 0, 0, 0, -1, v());
    expect(norm(out)).toBeCloseTo(1, 12);
    expect(out.x).toBeCloseTo(0.6, 12);
    expect(out.y).toBeCloseTo(0.8, 12);
  });

  it('points from the barrel up toward a higher target (head)', () => {
    // Barrel sits below + right of the camera; the head point is up and ahead.
    // The firing dir must tilt UP (positive y) relative to a flat forward shot.
    const out = aimDirection(0.12, 1.6, -0.3, 0, 1.85, -12, 0, 0, -1, v());
    expect(out.y).toBeGreaterThan(0);
    expect(out.z).toBeLessThan(0);
  });

  it('falls back to the camera forward when barrel == target (degenerate)', () => {
    const fb = { x: 0, y: 0, z: -1 };
    const out = aimDirection(1, 2, 3, 1, 2, 3, fb.x, fb.y, fb.z, v());
    expect(out).toEqual(fb);
  });

  it('approaches the camera forward as the target distance grows', () => {
    // Same barrel offset; a near target tilts the dir more than a far one.
    const near = aimDirection(0.12, 1.6, -0.3, 0, 1.85, -3, 0, 0, -1, v());
    const far  = aimDirection(0.12, 1.6, -0.3, 0, 1.85, -60, 0, 0, -1, v());
    // Far shot is closer to pure forward (-z) → larger |z| component, smaller tilt.
    expect(Math.abs(far.z)).toBeGreaterThan(Math.abs(near.z));
    expect(Math.abs(far.y)).toBeLessThan(Math.abs(near.y));
  });
});

describe('barrel→crosshair projectile genuinely passes through the aimed point', () => {
  // The core guarantee of the v0.2.126 fix: the bullet, launched from the barrel
  // along aimDirection(...), reaches the EXACT point the crosshair was on. This
  // is what makes a previewed headshot land as a headshot (no parallax).
  it('a head point on the camera ray is hit by the barrel-fired bullet', () => {
    const cam = { x: 0, y: 1.7, z: 0 };
    const fwd = { x: 0, y: 0, z: -1 };
    const dist = 12;
    // Crosshair target = head point on the camera ray.
    const target = crosshairPoint(cam.x, cam.y, cam.z, fwd.x, fwd.y, fwd.z, dist, v());
    const barrel = { x: 0.12, y: 1.6, z: -0.3 }; // below/right of camera
    const dir = aimDirection(
      barrel.x, barrel.y, barrel.z, target.x, target.y, target.z,
      fwd.x, fwd.y, fwd.z, v(),
    );
    // Travel along the bullet ray exactly |target - barrel| metres.
    const t = Math.hypot(target.x - barrel.x, target.y - barrel.y, target.z - barrel.z);
    const hit = {
      x: barrel.x + dir.x * t,
      y: barrel.y + dir.y * t,
      z: barrel.z + dir.z * t,
    };
    expect(hit.x).toBeCloseTo(target.x, 9);
    expect(hit.y).toBeCloseTo(target.y, 9);
    expect(hit.z).toBeCloseTo(target.z, 9);
  });
});

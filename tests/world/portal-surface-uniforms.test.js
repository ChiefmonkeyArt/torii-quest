// portal-surface-uniforms.test.js — the gate→uniform bridge is correct and the fullscreen
// iris expands past the gate on cross (ADR-0118). Pure three math, no WebGL.
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { portalSurfaceUniforms } from '../../src/engine/world/portalSurfaceUniforms.js';
import { REVEAL_MODE } from '../../src/engine/world/portalReveal.js';

const near = (a, b, e = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(e);

function cam(pos, lookAt, aspect, fov = 75) {
  const c = new PerspectiveCamera(fov, aspect, 0.1, 1000);
  c.position.set(pos.x, pos.y, pos.z);
  c.lookAt(lookAt.x, lookAt.y, lookAt.z);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const GATE = { x: 0, y: 1.6, z: 0 };
const APERTURE = 1.6;

describe('portalSurfaceUniforms', () => {
  it('is inactive when the gate is off-screen or input is bad', () => {
    const c = cam({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 1.6, z: 20 }, 16 / 9);
    const u = portalSurfaceUniforms({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: { x: 0, y: 1.6, z: -10 }, apertureRadius: APERTURE, // behind
    });
    expect(u.active).toBe(false);
    expect(portalSurfaceUniforms({}).active).toBe(false);
  });

  it('centres the aperture and pins the iris at the gate on approach', () => {
    const aspect = 16 / 9;
    const c = cam({ x: 0, y: 1.6, z: 10 }, GATE, aspect);
    const u = portalSurfaceUniforms({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: GATE, apertureRadius: APERTURE,
      mode: REVEAL_MODE.APPROACH, t: 0.5, skyAHex: '#000000', skyBHex: '#7fdfff',
    });
    expect(u.active).toBe(true);
    expect(u.centerX).toBeCloseTo(aspect / 2, 1);
    expect(u.centerY).toBeCloseTo(0.5, 1);
    expect(u.iris).toBe(1); // aperture window only
    expect(u.skyBlend).toBe(0); // origin sky outside
    expect(u.aperture).toBeGreaterThan(0);
    expect(u.skyB.b).toBeGreaterThan(u.skyB.r); // destination sky resolved linear
  });

  it('expands the iris past the gate to fullscreen as the cross completes', () => {
    const aspect = 16 / 9;
    const c = cam({ x: 0, y: 1.6, z: 6 }, GATE, aspect);
    const u0 = portalSurfaceUniforms({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: GATE, apertureRadius: APERTURE, mode: REVEAL_MODE.CROSS, t: 0,
    });
    const u1 = portalSurfaceUniforms({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: GATE, apertureRadius: APERTURE, mode: REVEAL_MODE.CROSS, t: 1,
    });
    expect(u0.iris).toBeCloseTo(1, 5);          // starts at the gate opening
    expect(u1.iris).toBeGreaterThan(1);          // expands past the aperture
    expect(u1.iris).toBeCloseTo(u1.fullFactor, 5); // reaches the furthest corner
    expect(u0.fullFactor).toBeCloseTo(u1.fullFactor, 5); // corner distance is constant at both ends
  });

  it('passes the aperture-unit radius through unclamped (fullscreen > 1)', () => {
    const c = cam({ x: 0, y: 1.6, z: 4 }, GATE, 1);
    const u = portalSurfaceUniforms({
      camera: c, viewWidth: 800, viewHeight: 800,
      gateCenter: GATE, apertureRadius: APERTURE, mode: REVEAL_MODE.SETTLED,
    });
    expect(u.iris).toBeGreaterThan(1);   // settled = fullscreen
    expect(u.skyBlend).toBe(1);          // destination sky fully resolved
  });
});
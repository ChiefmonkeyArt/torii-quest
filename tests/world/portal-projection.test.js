// portal-projection.test.js — the gate→screen projection is aspect-correct and the
// fullscreen factor reaches the furthest corner (ADR-0118). Pure three math, no WebGL.
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { gateScreenProjection } from '../../src/engine/world/portalProjection.js';

function cam(pos, lookAt, aspect, fov = 75) {
  const c = new PerspectiveCamera(fov, aspect, 0.1, 1000);
  c.position.set(pos.x, pos.y, pos.z);
  c.lookAt(lookAt.x, lookAt.y, lookAt.z);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

describe('gateScreenProjection', () => {
  it('bad input fails closed', () => {
    const p = gateScreenProjection({});
    expect(p.ok).toBe(false);
    expect(p.fullFactor).toBe(1);
  });

  it('centres a gate the camera looks straight at', () => {
    const aspect = 16 / 9;
    const c = cam({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 1.6, z: 0 }, aspect);
    const p = gateScreenProjection({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: { x: 0, y: 1.6, z: 0 }, apertureRadius: 1.6,
    });
    expect(p.ok).toBe(true);
    expect(p.onScreen).toBe(true);
    // centre maps to aspect/2 in ACUV.x and 0.5 in ACUV.y (± small tolerance)
    expect(p.centerU).toBeCloseTo(aspect / 2, 1);
    expect(p.centerV).toBeCloseTo(0.5, 1);
    expect(p.aperture).toBeGreaterThan(0);
    // fullscreen radius >= 1 (the aperture fits the viewport)
    expect(p.fullFactor).toBeGreaterThanOrEqual(1);
  });

  it('moves off-centre and grows as the gate fills the view', () => {
    const aspect = 1;
    const c = cam({ x: -4, y: 1.6, z: 4 }, { x: 0, y: 1.6, z: 0 }, aspect);
    const p = gateScreenProjection({
      camera: c, viewWidth: 800, viewHeight: 800,
      gateCenter: { x: 0, y: 1.6, z: 0 }, apertureRadius: 1.6,
    });
    expect(p.ok).toBe(true);
    expect(p.onScreen).toBe(true);
    expect(p.centerU).toBeLessThan(aspect / 2); // gate is to the camera's right
    expect(p.aperture).toBeGreaterThan(0);
    expect(p.fullFactor).toBeGreaterThanOrEqual(1);
  });

  it('reports off-screen for a gate behind the camera', () => {
    const c = cam({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 1.6, z: 20 }, 16 / 9);
    const p = gateScreenProjection({
      camera: c, viewWidth: 1920, viewHeight: 1080,
      gateCenter: { x: 0, y: 1.6, z: -10 }, apertureRadius: 1.6, // behind
    });
    expect(p.ok).toBe(true);
    expect(p.onScreen).toBe(false);
  });
});
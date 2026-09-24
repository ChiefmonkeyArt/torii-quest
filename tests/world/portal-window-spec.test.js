// portal-window-spec.test.js — locks the world-space portal WINDOW placement (ADR-0124).
// The window replaces the ADR-0118 fullscreen iris: a flat rectangle that stands inside
// the travel gate opening (between the pillars, below the crossbeam) so the destination
// world reads as "the wardrobe opening onto Narnia" — not a circle expanding over the
// player's face. Pure math, no THREE.
import { describe, it, expect } from 'vitest';
import {
  portalWindowSpec, PORTAL_WINDOW_WIDTH, PORTAL_WINDOW_HEIGHT, PORTAL_WINDOW_CENTER_Y,
} from '../../src/engine/world/portalWindowSpec.js';

describe('portalWindowSpec', () => {
  it('defaults the facing yaw to π (front toward the player approaching from −Z)', () => {
    const s = portalWindowSpec({ gateX: 0, gateY: 0, gateZ: 32 });
    expect(s.rotationY).toBe(Math.PI);
  });

  it('places the window at the gate anchor, lifted to the window centre height', () => {
    const s = portalWindowSpec({ gateX: 0, gateY: 5, gateZ: 32 });
    expect(s.position).toEqual({ x: 0, y: 5 + PORTAL_WINDOW_CENTER_Y, z: 32 });
  });

  it('sizes the window to fit inside the gate (defined constants)', () => {
    const s = portalWindowSpec({ gateX: 0, gateY: 0, gateZ: 32 });
    expect(s.width).toBe(PORTAL_WINDOW_WIDTH);
    expect(s.height).toBe(PORTAL_WINDOW_HEIGHT);
    // The travel gate is ~3.90 wide and ~4.16 tall; the window must fit within both.
    expect(s.width).toBeLessThan(3.9);
    expect(s.height).toBeLessThan(4.16);
  });

  it('coerces non-numeric anchors to 0 instead of NaN', () => {
    const s = portalWindowSpec({ gateX: undefined, gateY: 'foo', gateZ: undefined });
    expect(s.position).toEqual({ x: 0, y: PORTAL_WINDOW_CENTER_Y, z: 0 });
  });

  it('accepts an explicit yaw', () => {
    expect(portalWindowSpec({ gateX: 0, gateY: 0, gateZ: 0, yaw: 0 }).rotationY).toBe(0);
  });
});
// portal-reveal.test.js — locks the HYBRID reveal arc (ADR-0118 Decision 6):
// live aperture on approach → fullscreen iris expansion + sky resolve on cross → settled.
import { describe, it, expect } from 'vitest';
import {
  REVEAL_MODE, apertureToFullscreenFactor, irisRadius, skyBlendFor, revealState,
} from '../../src/engine/world/portalReveal.js';

const near = (a, b, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('apertureToFullscreenFactor', () => {
  it('is the corner-to-aperture ratio and guards degenerate input', () => {
    near(apertureToFullscreenFactor(0.5, 1.0), 2);
    near(apertureToFullscreenFactor(1, 1), 1);          // aperture already corner-sized
    expect(apertureToFullscreenFactor(0, 1)).toBeGreaterThanOrEqual(1); // degenerate guard
    near(apertureToFullscreenFactor(1, 0.5), 1);        // corner nearer than aperture → clamp
  });
});

describe('irisRadius across the arc', () => {
  it('approach pins the radius at the aperture (1) regardless of progress', () => {
    near(irisRadius({ mode: REVEAL_MODE.APPROACH, t: 0, fullFactor: 3 }), 1);
    near(irisRadius({ mode: REVEAL_MODE.APPROACH, t: 1, fullFactor: 3 }), 1);
  });

  it('cross eases the radius from the aperture to fullscreen', () => {
    near(irisRadius({ mode: REVEAL_MODE.CROSS, t: 0, fullFactor: 3 }), 1);
    near(irisRadius({ mode: REVEAL_MODE.CROSS, t: 1, fullFactor: 3 }), 3);
    const mid = irisRadius({ mode: REVEAL_MODE.CROSS, t: 0.5, fullFactor: 3 });
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(3);
  });

  it('settled pins the radius at fullscreen', () => {
    near(irisRadius({ mode: REVEAL_MODE.SETTLED, fullFactor: 3 }), 3);
  });
});

describe('skyBlendFor', () => {
  it('keeps the origin sky on approach, resolves on cross, stays resolved when settled', () => {
    near(skyBlendFor(REVEAL_MODE.APPROACH, 0.8), 0);
    near(skyBlendFor(REVEAL_MODE.CROSS, 0), 0);
    near(skyBlendFor(REVEAL_MODE.CROSS, 1), 1);
    near(skyBlendFor(REVEAL_MODE.SETTLED, 0), 1);
  });
});

describe('the full hybrid arc', () => {
  it('look-through, then step-through: aperture window, then expand + resolve', () => {
    // Approach — live aperture window; origin sky still outside.
    const approach = revealState({ mode: REVEAL_MODE.APPROACH, t: 1, fullFactor: 4 });
    near(approach.radius, 1);
    near(approach.skyBlend, 0);

    // Cross — radius expands past the frame while the destination sky resolves in.
    const crossMid = revealState({ mode: REVEAL_MODE.CROSS, t: 0.5, fullFactor: 4 });
    expect(crossMid.radius).toBeGreaterThan(1);
    expect(crossMid.radius).toBeLessThan(4);
    expect(crossMid.skyBlend).toBeGreaterThan(0);
    expect(crossMid.skyBlend).toBeLessThan(1);

    // Settled — world B fills the screen, destination sky fully resolved.
    const settled = revealState({ mode: REVEAL_MODE.SETTLED, fullFactor: 4 });
    near(settled.radius, 4);
    near(settled.skyBlend, 1);

    // The radius is monotonic across approach → cross → settled.
    const r0 = irisRadius({ mode: REVEAL_MODE.APPROACH });
    const r1 = irisRadius({ mode: REVEAL_MODE.CROSS, t: 1, fullFactor: 4 });
    const r2 = irisRadius({ mode: REVEAL_MODE.SETTLED, fullFactor: 4 });
    expect(r0).toBeLessThanOrEqual(r1);
    expect(r1).toBe(r2);
  });
});
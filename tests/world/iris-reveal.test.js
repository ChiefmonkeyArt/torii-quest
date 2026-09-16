// iris-reveal.test.js — locks the iris + sky-resolve timeline math (ADR-0118): easing
// monotonicity, aperture closed/open endpoints, the sky's delay-into-iris, hex colour
// lerp, sky descriptor interpolation, and the full mirrorTimeline envelope.
import { describe, it, expect } from 'vitest';
import {
  clamp01, easeInOutCubic, irisCoverage, skyResolve, lerpHexColor, lerpSky, mirrorTimeline,
} from '../../src/engine/world/irisReveal.js';
import { IRIS_MASK_GLSL, SKY_RESOLVE_GLSL, PORTAL_REVEAL_GLSL } from '../../src/engine/world/portalShader.js';

const near = (a, b, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('iris easing + coverage', () => {
  it('clamps and maps the easing endpoints', () => {
    near(easeInOutCubic(0), 0);
    near(easeInOutCubic(1), 1);
    near(easeInOutCubic(0.5), 0.5); // symmetric midpoint
    near(easeInOutCubic(-2), 0);
    near(easeInOutCubic(3), 1);
  });

  it('is strictly monotonic non-decreasing', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = irisCoverage(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('iris is closed at t=0 and open at t=1', () => {
    near(irisCoverage(0), 0);
    near(irisCoverage(1), 1);
  });

  it('skyResolve delays then resolves into the iris', () => {
    near(skyResolve(0, { delay: 0.15, duration: 0.85 }), 0);
    near(skyResolve(0.15, { delay: 0.15, duration: 0.85 }), 0); // still closed at the delay edge
    near(skyResolve(1, { delay: 0.15, duration: 0.85 }), 1);
    // sky lags the iris: halfway through the whole, sky is part-resolved only
    expect(skyResolve(0.5, { delay: 0.15, duration: 0.85 })).toBeGreaterThan(0);
    expect(skyResolve(0.5, { delay: 0.15, duration: 0.85 })).toBeLessThan(irisCoverage(0.5) + 1e-9);
  });
});

describe('sky interpolation', () => {
  it('lerps a hex colour and clamps', () => {
    expect(lerpHexColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHexColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpHexColor('#000000', '#ff0000', 0.5)).toBe('#800000');
  });

  it('falls back to the destination when a colour is unparseable', () => {
    expect(lerpHexColor('not-a-colour', '#7fdfff', 0.5)).toBe('#7fdfff');
  });

  it('interpolates a sky descriptor (colour lerps, stars switch at midpoint, type flips)', () => {
    const a = { type: 'clear', color: '#000000', stars: false };
    const b = { type: 'dusk', color: '#ffffff', stars: true };
    expect(lerpSky(a, b, 0).type).toBe('clear');
    expect(lerpSky(a, b, 0).color).toBe('#000000');
    expect(lerpSky(a, b, 0).stars).toBe(false);
    expect(lerpSky(a, b, 1).type).toBe('dusk');
    expect(lerpSky(a, b, 1).color).toBe('#ffffff');
    expect(lerpSky(a, b, 1).stars).toBe(true);
    expect(lerpSky(a, b, 0.5).stars).toBe(true); // crossed the midpoint
    expect(lerpSky(a, b, 0.5).color).toBe('#808080');
  });
});

describe('mirrorTimeline envelope', () => {
  it('returns the full envelope with the sky resolving into the opening iris', () => {
    const start = mirrorTimeline({ elapsedMs: 0, totalMs: 1000 });
    near(start.iris, 0);
    near(start.skyBlend, 0);
    expect(start.done).toBe(false);

    const mid = mirrorTimeline({ elapsedMs: 500, totalMs: 1000 });
    expect(mid.iris).toBeGreaterThan(0);
    expect(mid.skyBlend).toBeLessThanOrEqual(mid.iris + 1e-9); // sky never leads the iris

    const end = mirrorTimeline({ elapsedMs: 1000, totalMs: 1000 });
    near(end.iris, 1);
    near(end.skyBlend, 1);
    expect(end.done).toBe(true);
    expect(mirrorTimeline({ elapsedMs: 5000, totalMs: 1000 }).done).toBe(true);
  });
});

describe('portal shader surface', () => {
  it('ships the iris mask, sky resolve, and combined reveal GLSL', () => {
    expect(IRIS_MASK_GLSL).toContain('irisMask');
    expect(IRIS_MASK_GLSL).toContain('uIris');
    expect(SKY_RESOLVE_GLSL).toContain('mix(uSkyA, uSkyB');
    expect(SKY_RESOLVE_GLSL).toContain('uSkyBlend');
    expect(PORTAL_REVEAL_GLSL).toContain('texture2D(uPortalTex');
    expect(PORTAL_REVEAL_GLSL).toContain('gl_FragColor');
  });
});
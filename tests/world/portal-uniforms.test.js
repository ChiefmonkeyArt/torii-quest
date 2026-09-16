// portal-uniforms.test.js — locks the timeline → shader uniform binding (ADR-0118):
// sRGB→linear transfer, hex→linear vec3, sky descriptor→vec3, and the per-frame state.
import { describe, it, expect } from 'vitest';
import { srgbToLinear, hexToLinearVec3, skyToLinearVec3, portalFrameState } from '../../src/engine/world/portalUniforms.js';

const near = (a, b, e = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(e);

describe('sRGB → linear', () => {
  it('maps the transfer-function endpoints and a known midpoint', () => {
    near(srgbToLinear(0), 0);
    near(srgbToLinear(1), 1);
    near(srgbToLinear(0.5), 0.214, 1e-3); // the IEC midpoint
  });
  it('clamps out-of-range input', () => {
    near(srgbToLinear(-1), 0);
    near(srgbToLinear(2), 1);
  });
});

describe('hex → linear vec3', () => {
  it('parses #rrggbb and rrggbb to linear components', () => {
    const w = hexToLinearVec3('#ffffff');
    near(w.r, 1); near(w.g, 1); near(w.b, 1);
    const b = hexToLinearVec3('000000');
    near(b.r, 0); near(b.g, 0); near(b.b, 0);
  });
  it('returns null for malformed input', () => {
    expect(hexToLinearVec3('#7fdff')).toBeNull();     // too short
    expect(hexToLinearVec3('nope')).toBeNull();
    expect(hexToLinearVec3(null)).toBeNull();
  });
  it('converts the live sky colour to a sane linear vec3', () => {
    const v = hexToLinearVec3('#7fdfff');
    expect(v.r).toBeGreaterThan(0);
    expect(v.b).toBeGreaterThan(v.r); // it is a light blue
    expect(v.b).toBeLessThanOrEqual(1);
  });
});

describe('sky descriptor → vec3', () => {
  it('maps a coloured sky and returns null for a colourless one', () => {
    const v = skyToLinearVec3({ type: 'clear', color: '#ffffff' });
    near(v.r, 1); near(v.g, 1); near(v.b, 1);
    expect(skyToLinearVec3({ type: 'space', stars: true })).toBeNull();
    expect(skyToLinearVec3(null)).toBeNull();
  });
});

describe('portalFrameState', () => {
  it('binds timeline + sky descriptors to the shader uniform struct', () => {
    const s = portalFrameState({
      timeline: { iris: 0.5, skyBlend: 0.75 },
      skyA: { color: '#000000' },
      skyB: { color: '#ffffff' },
      soft: 0.03,
    });
    near(s.uIris, 0.5);
    near(s.uSkyBlend, 0.75);
    near(s.uSoft, 0.03);
    near(s.uSkyA.r, 0); near(s.uSkyA.g, 0); near(s.uSkyA.b, 0);   // black origin
    near(s.uSkyB.r, 1); near(s.uSkyB.g, 1); near(s.uSkyB.b, 1);   // white destination
  });

  it('passes the aperture-unit radius through unclamped (>1 expands to fullscreen)', () => {
    // ADR-0118 Decision 6: uIris is in APERTURE units — 1 = the gate opening, >1 = the iris
    // expanding toward fullscreen (fullFactor). It must NOT be clamped to [0,1] (that was the
    // v0.2.853 bug: the iris froze at the gate). A negative value is still floored to 0.
    const s = portalFrameState({ timeline: { iris: 2, skyBlend: -1 } });
    near(s.uIris, 2);
    near(s.uSkyBlend, 0);
    near(portalFrameState({ timeline: { iris: -3 } }).uIris, 0);
    near(s.uSkyA.r, 0); near(s.uSkyA.b, 0);
    near(s.uSkyB.g, 0);
    near(s.uSoft, 0.02); // default soft
  });

  it('round-trips through mirrorTimeline into a uniform struct', async () => {
    const { mirrorTimeline } = await import('../../src/engine/world/irisReveal.js');
    const tl = mirrorTimeline({ elapsedMs: 1000, totalMs: 1000 });
    const s = portalFrameState({ timeline: tl, skyA: { color: '#000000' }, skyB: { color: '#7fdfff' } });
    near(s.uIris, 1);
    near(s.uSkyBlend, 1);
    expect(s.uSkyB.b).toBeGreaterThan(s.uSkyB.r); // resolved sky is the blue destination
  });
});
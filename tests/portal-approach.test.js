// tests/portal-approach.test.js — locks the v0.2.294 PURE approach-affordance
// view-model (portalApproach.js): the idle → approaching → ready phase grading, the
// normalised closeness `t`, the glow `intensity`, the phase-appropriate prompt, planar
// (y-ignoring) distance, the ready==arm-range parity with the trigger, and graceful
// degradation on bad input. Also asserts SDK exposure at the experimental tier.
import { describe, it, expect } from 'vitest';
import {
  PORTAL_APPROACH_VERSION, APPROACH_PHASE, APPROACH_BAND_FACTOR, APPROACH_GLOW,
  APPROACH_READY_TEXT, portalApproachState,
} from '../src/engine/gateway/portalApproach.js';
import * as SDK from '../src/sdk/index.js';

const PORTAL = { x: 20, y: 0, z: 0 };
const RANGE = 3;

function at(x, z, extra = {}) {
  return portalApproachState({ playerPos: { x, z }, portalPos: PORTAL, range: RANGE, ...extra });
}

describe('module shape', () => {
  it('pins version, phases, band factor, glow bounds, ready text', () => {
    expect(PORTAL_APPROACH_VERSION).toBe(1);
    expect(APPROACH_PHASE).toEqual({ idle: 'idle', approaching: 'approaching', ready: 'ready' });
    expect(APPROACH_BAND_FACTOR).toBe(3);
    expect(APPROACH_GLOW.min).toBeLessThan(APPROACH_GLOW.max);
    expect(APPROACH_READY_TEXT).toBe('Press F to travel');
  });
});

describe('phase grading', () => {
  it('READY at/within the arm range (parity with portalTrigger) → max glow + travel prompt', () => {
    const onEdge = at(20 + RANGE, 0); // exactly range away
    expect(onEdge.phase).toBe('ready');
    expect(onEdge.inRange).toBe(true);
    expect(onEdge.t).toBe(1);
    expect(onEdge.intensity).toBeCloseTo(APPROACH_GLOW.max, 6);
    expect(onEdge.prompt).toBe('Press F to travel');

    const inside = at(20, 0); // on top of the portal
    expect(inside.phase).toBe('ready');
    expect(inside.inRange).toBe(true);
  });

  it('APPROACHING inside the band but beyond range → graded glow + "<title> ahead"', () => {
    const a = at(20 + RANGE * 2, 0, { title: 'Bazaar' }); // mid-band
    expect(a.phase).toBe('approaching');
    expect(a.inRange).toBe(false);
    expect(a.t).toBeGreaterThan(0);
    expect(a.t).toBeLessThan(1);
    expect(a.intensity).toBeGreaterThan(APPROACH_GLOW.min);
    expect(a.intensity).toBeLessThan(APPROACH_GLOW.max);
    expect(a.prompt).toBe('Bazaar ahead');
  });

  it('IDLE beyond the band → zero closeness, min glow, no prompt', () => {
    const band = RANGE * APPROACH_BAND_FACTOR;
    const i = at(20 + band + 1, 0);
    expect(i.phase).toBe('idle');
    expect(i.t).toBe(0);
    expect(i.intensity).toBeCloseTo(APPROACH_GLOW.min, 6);
    expect(i.prompt).toBe('');
  });

  it('closeness t increases monotonically as the player nears the gate', () => {
    const far = at(20 + RANGE * 2.5, 0).t;
    const mid = at(20 + RANGE * 1.8, 0).t;
    const near = at(20 + RANGE * 1.1, 0).t;
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid);
  });
});

describe('planar distance', () => {
  it('ignores the y axis — jumping at the gate stays READY', () => {
    const high = portalApproachState({ playerPos: { x: 20, y: 50, z: 0 }, portalPos: PORTAL, range: RANGE });
    expect(high.phase).toBe('ready');
    expect(high.distance).toBe(0);
  });

  it('measures true x/z distance', () => {
    const r = portalApproachState({ playerPos: { x: 23, z: 4 }, portalPos: PORTAL, range: RANGE });
    expect(r.distance).toBeCloseTo(5, 6); // 3-4-5
  });
});

describe('degraded input', () => {
  it('bad/missing positions degrade to ok:false idle (never throws)', () => {
    for (const bad of [undefined, null, {}, { playerPos: { x: 1, z: 2 } }, 'x', []]) {
      const r = portalApproachState(bad);
      expect(r.ok).toBe(false);
      expect(r.phase).toBe('idle');
      expect(r.intensity).toBe(APPROACH_GLOW.min);
      expect(r.prompt).toBe('');
    }
    expect(() => portalApproachState({ playerPos: { x: NaN, z: 0 }, portalPos: PORTAL, range: RANGE })).not.toThrow();
    expect(portalApproachState({ playerPos: { x: NaN, z: 0 }, portalPos: PORTAL }).ok).toBe(false);
  });

  it('defaults a bad range to 3', () => {
    const r = portalApproachState({ playerPos: { x: 22.9, z: 0 }, portalPos: PORTAL, range: -1 });
    expect(r.phase).toBe('ready'); // 2.9 < default 3
  });
});

describe('SDK exposure', () => {
  it('re-exports portalApproach at the experimental tier', () => {
    expect(typeof SDK.portalApproach.portalApproachState).toBe('function');
    expect(SDK.SDK_SURFACE.portalApproach).toEqual({
      tier: SDK.STABILITY.EXPERIMENTAL,
      module: '../engine/gateway/portalApproach.js',
    });
  });
});

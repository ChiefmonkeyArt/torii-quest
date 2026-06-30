// tests/player-boundary.test.js — locks down the pure player-boundary helpers
// (engine/entities/player.js): the v0.2.123 movement heading basis and the
// v0.2.112 look-down POV math. Pure scalar/data: no Three/Rapier/browser.
import { describe, it, expect } from 'vitest';
import {
  forwardX, forwardZ, rightX, rightZ,
  lookDownEyeY, lookDownEyeZ,
  EYE, BODY_FROM_EYE, SPAWN_YAW, SPAWN_X, SPAWN_Z,
  SPAWN_MAG, pickRespawnCorner,
} from '../src/engine/entities/player.js';

describe('heading basis — forward', () => {
  it('faces -Z at yaw 0 (Three.js convention)', () => {
    expect(forwardX(0)).toBeCloseTo(0, 12);
    expect(forwardZ(0)).toBeCloseTo(-1, 12);
  });
  it('matches the prior inline -sin/-cos formula at arbitrary yaw', () => {
    const y = 0.937;
    expect(forwardX(y)).toBeCloseTo(-Math.sin(y), 12);
    expect(forwardZ(y)).toBeCloseTo(-Math.cos(y), 12);
  });
  it('points NE (+X,+Z) at the SW spawn yaw', () => {
    // SPAWN_YAW = -3π/4 should aim from the SW corner toward centre.
    expect(forwardX(SPAWN_YAW)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(forwardZ(SPAWN_YAW)).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('heading basis — right', () => {
  it('faces +X at yaw 0', () => {
    expect(rightX(0)).toBeCloseTo(1, 12);
    expect(rightZ(0)).toBeCloseTo(0, 12);
  });
  it('matches the prior inline cos/-sin formula at arbitrary yaw', () => {
    const y = -1.42;
    expect(rightX(y)).toBeCloseTo(Math.cos(y), 12);
    expect(rightZ(y)).toBeCloseTo(-Math.sin(y), 12);
  });
});

describe('heading basis — invariants', () => {
  for (const y of [0, 0.5, SPAWN_YAW, 2.1, -1.42, Math.PI]) {
    it(`forward and right are orthonormal at yaw ${y.toFixed(3)}`, () => {
      const fLen = Math.hypot(forwardX(y), forwardZ(y));
      const rLen = Math.hypot(rightX(y), rightZ(y));
      const dot  = forwardX(y) * rightX(y) + forwardZ(y) * rightZ(y);
      expect(fLen).toBeCloseTo(1, 12);
      expect(rLen).toBeCloseTo(1, 12);
      expect(dot).toBeCloseTo(0, 12);
    });
  }
});

describe('look-down POV math', () => {
  it('rests level: no drop and no forward lean at pitch 0', () => {
    expect(lookDownEyeY(0)).toBeCloseTo(-0.06, 12); // CAM_BASE_Y
    expect(lookDownEyeZ(0)).toBeCloseTo(0, 12);
  });
  it('drops the eye fully when looking straight down', () => {
    // pitch = -PI/2 → lookDown=1 → sin(PI/2)=1 → CAM_BASE_Y - CAM_DOWN_DROP.
    expect(lookDownEyeY(-Math.PI / 2)).toBeCloseTo(-0.06 - 0.12, 12);
    // forward arc returns to ~0 at the extremes (sin(PI)=0).
    expect(lookDownEyeZ(-Math.PI / 2)).toBeCloseTo(0, 12);
  });
  it('peaks the forward lean mid-look-down', () => {
    // lookDown=0.5 → sin(PI/2)=1 → -CAM_FWD_ARC (max forward = most negative z).
    expect(lookDownEyeZ(-Math.PI / 4)).toBeCloseTo(-0.10, 12);
  });
  it('clamps positive pitch (looking up) to the resting pose', () => {
    expect(lookDownEyeY(0.5)).toBeCloseTo(-0.06, 12);
    expect(lookDownEyeZ(0.5)).toBeCloseTo(0, 12);
  });
});

describe('geometry constants', () => {
  it('keeps eye height and body-from-eye offset stable', () => {
    expect(EYE).toBeCloseTo(1.7, 12);
    expect(BODY_FROM_EYE).toBeCloseTo(-0.8, 12); // 0.9 - 1.7
  });
});

// Respawn-corner picker (v0.2.291) — pure spawn-ownership decision lifted out of the
// THREE-coupled arenaRuntime PLAYER_KILLED handler. Locks the behaviour-preserving
// contract: pick the corner FURTHEST from the live bots, SW-canonical on ties / no
// bots, facing the arena centre.
describe('pickRespawnCorner — local-player respawn decision', () => {
  it('the four corners sit at ±SPAWN_MAG, matching the spawn magnitude', () => {
    expect(SPAWN_MAG).toBe(14);
    expect(Math.abs(SPAWN_X)).toBe(SPAWN_MAG);
    expect(Math.abs(SPAWN_Z)).toBe(SPAWN_MAG);
  });

  it('returns the canonical SW spawn when there are no live bots', () => {
    const c = pickRespawnCorner([]);
    expect(c.x).toBe(-SPAWN_MAG);
    expect(c.z).toBe(-SPAWN_MAG);
    // Faces the arena centre — identical to SPAWN_YAW for the SW corner.
    expect(c.yaw).toBeCloseTo(SPAWN_YAW, 12);
    expect(c.yaw).toBeCloseTo(Math.atan2(-SPAWN_MAG, -SPAWN_MAG), 12);
  });

  it('defaults to SW even when called with no arguments', () => {
    const c = pickRespawnCorner();
    expect(c).toEqual({ x: -SPAWN_MAG, z: -SPAWN_MAG, yaw: Math.atan2(-SPAWN_MAG, -SPAWN_MAG) });
  });

  it('picks the corner furthest from a single clustered bot', () => {
    // A bot sitting on the SW corner → respawn at the opposite (NE) corner.
    const c = pickRespawnCorner([{ x: -SPAWN_MAG, z: -SPAWN_MAG }]);
    expect(c.x).toBe(SPAWN_MAG);
    expect(c.z).toBe(SPAWN_MAG);
    expect(c.yaw).toBeCloseTo(Math.atan2(SPAWN_MAG, SPAWN_MAG), 12);
  });

  it('maximises the MIN distance across several bots (not the sum)', () => {
    // Bots clustered near SW + SE corners; the NW/NE side is safer. The corner
    // with the largest nearest-bot distance wins. Here a bot at SW and one at SE
    // leave both north corners equally far → SW-vs-... tie resolves to lowest index
    // among the *north* pair, i.e. NE (index 2) appears before NW (index 3).
    const c = pickRespawnCorner([{ x: -SPAWN_MAG, z: -SPAWN_MAG }, { x: SPAWN_MAG, z: -SPAWN_MAG }]);
    // Both north corners (NE idx2, NW idx3) have equal min-dist; idx2 (NE) wins.
    expect(c.x).toBe(SPAWN_MAG);
    expect(c.z).toBe(SPAWN_MAG);
  });

  it('treats a missing bot position as the origin (0,0) and never throws', () => {
    expect(() => pickRespawnCorner([undefined, null, {}])).not.toThrow();
    const c = pickRespawnCorner([{}]); // origin → all corners equidistant → SW (idx0)
    expect(c.x).toBe(-SPAWN_MAG);
    expect(c.z).toBe(-SPAWN_MAG);
  });

  it('every returned corner faces the arena centre (yaw = atan2(x,z))', () => {
    for (const bot of [{ x: 14, z: 14 }, { x: -14, z: 14 }, { x: 14, z: -14 }]) {
      const c = pickRespawnCorner([bot]);
      expect(c.yaw).toBeCloseTo(Math.atan2(c.x, c.z), 12);
    }
  });
});

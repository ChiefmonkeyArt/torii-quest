// tests/bot-tactics.test.js — locks down the pure bot tactics/steering layer
// (engine/entities/bot-tactics.js) added in M4-G1: difficulty tiers, flank-slot
// assignment + anchors, cover-point precompute/scoring, and obstacle-avoidance
// steering. Pure logic: no Three/Rapier/browser needed.
import { describe, it, expect } from 'vitest';
import {
  BOT_TIERS, tierForIndex,
  effectiveSight, effectiveCooldown, effectiveSpread, effectiveSpeed,
  FLANK_SLOTS, flankSlotForIndex, FLANK_RADIUS, flankAnchor,
  buildCoverPoints, pickCover, obstacleAvoid,
} from '../src/engine/entities/bot-tactics.js';
import { BOT_SPEED, BOT_SIGHT, BOT_SHOOT_CD, BOT_SPREAD } from '../src/config.js';

describe('difficulty tiers', () => {
  it('exposes easy/normal/hard with all tuning keys', () => {
    for (const id of ['easy', 'normal', 'hard']) {
      const t = BOT_TIERS[id];
      expect(t.id).toBe(id);
      for (const k of ['sightScale', 'speedScale', 'reaction', 'aimError',
                       'cooldownScale', 'coverBias', 'flankBias', 'persistence']) {
        expect(typeof t[k]).toBe('number');
      }
    }
  });

  it('keeps the `normal` tier at the pre-M4-G1 contract (all 1.0 scales)', () => {
    const n = BOT_TIERS.normal;
    expect(n.sightScale).toBe(1.0);
    expect(n.speedScale).toBe(1.0);
    expect(n.aimError).toBe(1.0);
    expect(n.cooldownScale).toBe(1.0);
    // normal sight must not fall below the BOT_SIGHT (14m) safe-zone contract
    expect(effectiveSight(n)).toBeCloseTo(BOT_SIGHT, 12);
  });

  it('orders tiers so hard is deadlier than easy', () => {
    expect(BOT_TIERS.hard.sightScale).toBeGreaterThan(BOT_TIERS.easy.sightScale);
    expect(BOT_TIERS.hard.speedScale).toBeGreaterThan(BOT_TIERS.easy.speedScale);
    expect(BOT_TIERS.hard.reaction).toBeLessThan(BOT_TIERS.easy.reaction);
    expect(BOT_TIERS.hard.aimError).toBeLessThan(BOT_TIERS.easy.aimError);
    expect(BOT_TIERS.hard.cooldownScale).toBeLessThan(BOT_TIERS.easy.cooldownScale);
  });

  it('tierForIndex is deterministic and wraps (incl. negative)', () => {
    const a = tierForIndex(0), b = tierForIndex(5);
    expect(a).toBe(b);                 // 5-length rotation wraps at index 5
    expect(tierForIndex(-1)).toBe(tierForIndex(4));
    expect(a).toBe(tierForIndex(0));   // stable
  });

  it('effective* helpers scale the base constants', () => {
    const h = BOT_TIERS.hard;
    expect(effectiveSight(h)).toBeCloseTo(BOT_SIGHT * h.sightScale, 12);
    expect(effectiveCooldown(h)).toBeCloseTo(BOT_SHOOT_CD * h.cooldownScale, 12);
    expect(effectiveSpread(h)).toBeCloseTo(BOT_SPREAD * h.aimError, 12);
    expect(effectiveSpeed(h)).toBeCloseTo(BOT_SPEED * h.speedScale, 12);
    expect(effectiveSpeed(h, 10)).toBeCloseTo(10 * h.speedScale, 12);
  });
});

describe('flanking', () => {
  it('has four distinct slot angles', () => {
    expect(FLANK_SLOTS).toHaveLength(4);
    const angles = new Set(FLANK_SLOTS.map(s => s.angle));
    expect(angles.size).toBe(4);
  });

  it('flankSlotForIndex is deterministic and wraps', () => {
    expect(flankSlotForIndex(0)).toBe(flankSlotForIndex(4));
    expect(flankSlotForIndex(-1)).toBe(flankSlotForIndex(3));
    expect(flankSlotForIndex(1).id).toBe(FLANK_SLOTS[1].id);
  });

  it('pressure slot (angle 0) puts the anchor between player and bot', () => {
    const out = { x: 0, z: 0 };
    // bot due east of player; radiusScale 0 → r = FLANK_RADIUS*0.7
    flankAnchor(0, 0, 10, 0, 0, 0, out);
    const r = FLANK_RADIUS * 0.7;
    expect(out.x).toBeCloseTo(r, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('rear slot (angle π) rings to the opposite side of the player', () => {
    const out = { x: 0, z: 0 };
    flankAnchor(0, 0, 10, 0, Math.PI, 0, out);
    const r = FLANK_RADIUS * 0.7;
    expect(out.x).toBeCloseTo(-r, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('flankBias (radiusScale) widens the ring', () => {
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    flankAnchor(0, 0, 10, 0, 0, 0, a);
    flankAnchor(0, 0, 10, 0, 0, 1, b);
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(Math.hypot(a.x, a.z));
  });
});

describe('cover points', () => {
  it('builds four outward points per box at half-extent + margin', () => {
    const boxes = [[0, 0, 1, 1, 2]];
    const pts = buildCoverPoints(boxes, 0.5);
    expect(pts).toHaveLength(4);
    const set = new Set(pts.map(p => `${p[0]},${p[1]}`));
    expect(set).toEqual(new Set(['1.5,0', '-1.5,0', '0,1.5', '0,-1.5']));
  });

  it('pickCover returns the nearest blocked candidate', () => {
    const points = [[5, 0], [1, 0], [ -1, 0]];
    // everything counts as blocked; nearest within maxDist wins
    const blockedAll = () => true;
    const i = pickCover(0, 0, 10, 0, points, blockedAll, 20);
    expect(i).toBe(1); // [1,0] is nearest to the bot at origin
  });

  it('pickCover distance-culls before the ray and returns -1 if all far', () => {
    const points = [[50, 0], [ -50, 0]];
    let rays = 0;
    const blocked = () => { rays++; return true; };
    const i = pickCover(0, 0, 10, 0, points, blocked, 5);
    expect(i).toBe(-1);
    expect(rays).toBe(0); // culled before any LOS ray
  });

  it('pickCover skips candidates the player can see (not real cover)', () => {
    const points = [[1, 0], [2, 0]];
    // only the far point is blocked from the player
    const blocked = (px, pz, cx) => cx === 2;
    const i = pickCover(0, 0, 10, 0, points, blocked, 20);
    expect(i).toBe(1); // index of [2,0]
  });
});

describe('obstacle avoidance', () => {
  it('is zero when no box is within influence', () => {
    const out = { x: 0, z: 0 };
    obstacleAvoid(50, 50, 1, 0, [[0, 0, 1, 1, 2]], 1, out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it('pushes away from a nearby box', () => {
    const out = { x: 0, z: 0 };
    // bot just east of a box, heading further east (away) — pure repulsion +x
    obstacleAvoid(1.5, 0, 1, 0, [[0, 0, 1, 1, 2]], 2, out);
    expect(out.x).toBeGreaterThan(0);
  });

  it('adds a tangential side-step when heading into a box', () => {
    const out = { x: 0, z: 0 };
    // bot east of box heading WEST (into it) → repulsion +x plus a ±z side-step
    obstacleAvoid(1.5, 0, -1, 0, [[0, 0, 1, 1, 2]], 2, out);
    expect(Math.abs(out.z)).toBeGreaterThan(0);
  });
});

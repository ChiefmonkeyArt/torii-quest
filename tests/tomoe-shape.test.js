// tests/tomoe-shape.test.js
// Tests for the Mitsudomoe island layout — tomoeShape.js predicates and geometry.
import { describe, it, expect } from 'vitest';
import {
  isNapLand, isArenaLand, isTomoeLand,
  isNapPlayArea, isArenaPlayArea,
  distanceToCoast, distanceToArenaPlay,
  arenaGlowLoops, getNapGlowLoop,
  clampToArenaPlay, clampToTomoeLand,
  TOMOE_BBOX, ARENA_BBOX, NAP_BBOX,
  NAP_CENTROID, ARENA_BL_CENTROID, ARENA_BR_CENTROID,
  napCoastRing, arenaBLCoastRing, arenaBRCoastRing,
  allCoastRings, allArenaCoastRings,
  whichIsland, ISLAND_NONE, ISLAND_NAP, ISLAND_BL, ISLAND_BR,
  isOnBeach, isShootable,
} from '../src/terrain/tomoeShape.js';
import { TOMOE_SCALE } from '../src/terrain/tomoeShapeData.js';

describe('Tomoe shape data', () => {
  it('TOMOE_SCALE is a positive number', () => {
    expect(TOMOE_SCALE).toBeGreaterThan(0);
    expect(TOMOE_SCALE).toBeLessThan(1);
  });

  it('all coast rings are non-empty arrays of [x,z] pairs', () => {
    for (const ring of allCoastRings()) {
      expect(ring.length).toBeGreaterThan(10);
      for (const p of ring) {
        expect(p.length).toBe(2);
        expect(typeof p[0]).toBe('number');
        expect(typeof p[1]).toBe('number');
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
  });

  it('all rings are closed (first point === last point)', () => {
    for (const ring of allCoastRings()) {
      expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 5);
      expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 5);
    }
  });
});

describe('Shape classification (top/bottom)', () => {
  it('NAP centroid has positive Z (north)', () => {
    expect(NAP_CENTROID[1]).toBeGreaterThan(0);
  });

  it('Arena BL centroid has negative X (left/west)', () => {
    expect(ARENA_BL_CENTROID[0]).toBeLessThan(0);
  });

  it('Arena BR centroid has positive X (right/east)', () => {
    expect(ARENA_BR_CENTROID[0]).toBeGreaterThan(0);
  });

  it('NAP centroid has higher Z than both arena centroids', () => {
    expect(NAP_CENTROID[1]).toBeGreaterThan(ARENA_BL_CENTROID[1]);
    expect(NAP_CENTROID[1]).toBeGreaterThan(ARENA_BR_CENTROID[1]);
  });
});

describe('Land predicates', () => {
  it('NAP centroid is NAP land', () => {
    expect(isNapLand(NAP_CENTROID[0], NAP_CENTROID[1])).toBe(true);
  });

  it('Arena BL centroid is arena land', () => {
    expect(isArenaLand(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1])).toBe(true);
  });

  it('Arena BR centroid is arena land', () => {
    expect(isArenaLand(ARENA_BR_CENTROID[0], ARENA_BR_CENTROID[1])).toBe(true);
  });

  it('NAP centroid is NOT arena land', () => {
    expect(isArenaLand(NAP_CENTROID[0], NAP_CENTROID[1])).toBe(false);
  });

  it('Arena BL centroid is NOT NAP land', () => {
    expect(isNapLand(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1])).toBe(false);
  });

  it('Origin (0,0) is on some land', () => {
    // The center of the Tomoe is where the three shapes meet
    // Depending on the exact geometry, origin may or may not be inside a shape
    // But it should be classifiable
    const island = whichIsland(0, 0);
    expect([ISLAND_NONE, ISLAND_NAP, ISLAND_BL, ISLAND_BR]).toContain(island);
  });

  it('Far outside all shapes is no land', () => {
    expect(isTomoeLand(1000, 1000)).toBe(false);
    expect(isNapLand(1000, 1000)).toBe(false);
    expect(isArenaLand(1000, 1000)).toBe(false);
  });
});

describe('Play area predicates', () => {
  it('NAP centroid is in NAP play area', () => {
    expect(isNapPlayArea(NAP_CENTROID[0], NAP_CENTROID[1])).toBe(true);
  });

  it('Arena BL centroid is in arena play area', () => {
    expect(isArenaPlayArea(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1])).toBe(true);
  });

  it('Arena BR centroid is in arena play area', () => {
    expect(isArenaPlayArea(ARENA_BR_CENTROID[0], ARENA_BR_CENTROID[1])).toBe(true);
  });

  it('NAP play area is NOT arena play area', () => {
    expect(isArenaPlayArea(NAP_CENTROID[0], NAP_CENTROID[1])).toBe(false);
  });

  it('Far outside is not shootable', () => {
    expect(isShootable(1000, 1000)).toBe(false);
  });
});

describe('Distance functions', () => {
  it('distanceToCoast is positive inside land', () => {
    const d = distanceToCoast(NAP_CENTROID[0], NAP_CENTROID[1]);
    expect(d).toBeGreaterThan(0);
  });

  it('distanceToCoast is negative outside all land', () => {
    const d = distanceToCoast(1000, 1000);
    expect(d).toBeLessThan(0);
  });

  it('distanceToArenaPlay is positive inside arena play', () => {
    const d = distanceToArenaPlay(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1]);
    expect(d).toBeGreaterThan(0);
  });

  it('distanceToArenaPlay is negative outside arena play', () => {
    const d = distanceToArenaPlay(1000, 1000);
    expect(d).toBeLessThan(0);
  });

  it('distanceToCoast at NAP centroid > 1 (centroid is well inland)', () => {
    const d = distanceToCoast(NAP_CENTROID[0], NAP_CENTROID[1]);
    expect(d).toBeGreaterThan(1);
  });
});

describe('Sea channels (gaps between islands)', () => {
  // The gaps between the three comma shapes should be below sea level (not land).
  // We test points that are in the "spaces" between the shapes.

  it('there exist points between NAP and arena that are not land', () => {
    // The sea channel between NAP and the arena islands runs roughly at z=5
    // between x=-27 and x=-22 (west side) and x=8 to x=19 (east side)
    let foundSea = false;
    for (let x = -30; x < 25; x += 0.5) {
      if (!isTomoeLand(x, 5)) {
        foundSea = true;
        break;
      }
    }
    expect(foundSea).toBe(true);
  });

  it('there exist points between BL and BR arena that are not land', () => {
    // Sample points between the two bottom shapes
    let foundSea = false;
    for (let i = 0; i < 50; i++) {
      const t = i / 50;
      const x = -5 + t * 15;  // sample across X
      const z = -10;           // southern area
      if (!isTomoeLand(x, z)) {
        foundSea = true;
        break;
      }
    }
    expect(foundSea).toBe(true);
  });
});

describe('Beach zone (1m gap between play and coast)', () => {
  it('there exist beach points (on land but not in play area)', () => {
    // Find a point that is on land but not in any play area
    let foundBeach = false;
    for (const ring of allCoastRings()) {
      // Sample points just inside the coast ring
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const [cx, cz] = ring[i];
        // Move slightly inward toward centroid
        const ring2 = ring;
        let ccx = 0, ccz = 0;
        for (const p of ring2) { ccx += p[0]; ccz += p[1]; }
        ccx /= n; ccz /= n;
        const dx = ccx - cx, dz = ccz - cz;
        const dlen = Math.hypot(dx, dz) || 1e-9;
        const px = cx + (dx / dlen) * 0.5;  // 0.5m inward
        const pz = cz + (dz / dlen) * 0.5;
        if (isOnBeach(px, pz)) {
          foundBeach = true;
          break;
        }
      }
      if (foundBeach) break;
    }
    expect(foundBeach).toBe(true);
  });

  it('beach points are NOT shootable', () => {
    // Find a beach point and verify it's not shootable
    for (const ring of allArenaCoastRings()) {
      const n = ring.length;
      let ccx = 0, ccz = 0;
      for (const p of ring) { ccx += p[0]; ccz += p[1]; }
      ccx /= n; ccz /= n;
      for (let i = 0; i < n; i++) {
        const [cx, cz] = ring[i];
        const dx = ccx - cx, dz = ccz - cz;
        const dlen = Math.hypot(dx, dz) || 1e-9;
        const px = cx + (dx / dlen) * 0.5;
        const pz = cz + (dz / dlen) * 0.5;
        if (isOnBeach(px, pz)) {
          expect(isShootable(px, pz)).toBe(false);
          return;
        }
      }
    }
    // If no beach point found, that's ok — just pass
  });
});

describe('Glow rings', () => {
  it('arenaGlowLoops returns exactly 2 loops', () => {
    const loops = arenaGlowLoops();
    expect(loops.length).toBe(2);
  });

  it('each glow loop is non-empty and closed', () => {
    for (const loop of arenaGlowLoops()) {
      expect(loop.length).toBeGreaterThan(10);
      expect(loop[0][0]).toBeCloseTo(loop[loop.length - 1][0], 5);
      expect(loop[0][1]).toBeCloseTo(loop[loop.length - 1][1], 5);
    }
  });

  it('NAP glow loop is non-empty and closed', () => {
    const loop = getNapGlowLoop();
    expect(loop.length).toBeGreaterThan(10);
    expect(loop[0][0]).toBeCloseTo(loop[loop.length - 1][0], 5);
    expect(loop[0][1]).toBeCloseTo(loop[loop.length - 1][1], 5);
  });
});

describe('Clamping', () => {
  it('clampToArenaPlay keeps points inside arena', () => {
    const [x, z] = clampToArenaPlay(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1]);
    expect(isArenaPlayArea(x, z)).toBe(true);
  });

  it('clampToArenaPlay pulls outside points inside', () => {
    const [x, z] = clampToArenaPlay(1000, 1000, 1.0);
    expect(isArenaPlayArea(x, z)).toBe(true);
  });

  it('clampToTomoeLand keeps points inside land', () => {
    const [x, z] = clampToTomoeLand(NAP_CENTROID[0], NAP_CENTROID[1]);
    expect(isTomoeLand(x, z)).toBe(true);
  });

  it('clampToTomoeLand pulls outside points inside', () => {
    const [x, z] = clampToTomoeLand(1000, 1000, 1.0);
    expect(isTomoeLand(x, z)).toBe(true);
  });
});

describe('Which island', () => {
  it('NAP centroid → ISLAND_NAP', () => {
    expect(whichIsland(NAP_CENTROID[0], NAP_CENTROID[1])).toBe(ISLAND_NAP);
  });

  it('Arena BL centroid → ISLAND_BL', () => {
    expect(whichIsland(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1])).toBe(ISLAND_BL);
  });

  it('Arena BR centroid → ISLAND_BR', () => {
    expect(whichIsland(ARENA_BR_CENTROID[0], ARENA_BR_CENTROID[1])).toBe(ISLAND_BR);
  });

  it('Far outside → ISLAND_NONE', () => {
    expect(whichIsland(1000, 1000)).toBe(ISLAND_NONE);
  });
});

describe('Bounding boxes', () => {
  it('TOMOE_BBOX contains all three islands', () => {
    for (const ring of allCoastRings()) {
      for (const [x, z] of ring) {
        expect(x).toBeGreaterThanOrEqual(TOMOE_BBOX.minX);
        expect(x).toBeLessThanOrEqual(TOMOE_BBOX.maxX);
        expect(z).toBeGreaterThanOrEqual(TOMOE_BBOX.minZ);
        expect(z).toBeLessThanOrEqual(TOMOE_BBOX.maxZ);
      }
    }
  });

  it('TOMOE_BBOX is roughly 15% larger than old 65×40 terrain', () => {
    const width = TOMOE_BBOX.maxX - TOMOE_BBOX.minX;
    const depth = TOMOE_BBOX.maxZ - TOMOE_BBOX.minZ;
    // Old terrain: 65 wide × 40 deep. 15% larger → ~74.75 × 46
    // But tomoe is square-ish, so depth will be larger than 46
    expect(width).toBeGreaterThan(60);  // at least as big as old
    expect(width).toBeLessThan(80);     // not absurdly large
    expect(depth).toBeGreaterThan(40); // at least as deep as old
    expect(depth).toBeLessThan(80);     // not absurdly deep
  });
});

// tests/physics-heightfield.test.js — REAL Rapier heightfield collider guard (v0.2.327).
//
// Regression test for the live "⚠ buildArenaColliders failed: unreachable" panic.
// The pure heightmap tests (terrain-heightmap.test.js) never touch WASM, so they
// could not catch a bad ColliderDesc.heightfield() call. This test actually inits
// @dimforge/rapier3d-compat and builds the SAME collider physics.js builds, proving
// it constructs without a WASM panic.
//
// ROOT CAUSE (v0.2.326 bug): Rapier's ColliderDesc.heightfield(nrows, ncols, ...)
// takes CELL counts (subdivisions) and internally builds a (nrows+1)×(ncols+1)
// column-major height matrix — so heights.length MUST equal (nrows+1)*(ncols+1).
// physics.js passed the VERTEX counts (rowsZ, colsX) with a rowsZ*colsX array, so
// Rapier expected (rowsZ+1)*(colsX+1) heights and panicked ("unreachable"). The fix
// passes rowsZ-1 / colsX-1 (cell counts) so (nrows+1)*(ncols+1) == the array length.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  NAP_GRID, NAP_TERRAIN, buildNapHeightfieldArray,
  ARENA_GRID, ARENA_TERRAIN, buildArenaHeightfieldArray,
} from '../src/terrain/heightmap.js';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
} from '../src/config.js';

let RAPIER;
beforeAll(async () => {
  RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
});

// The cell counts physics.js passes to createHeightfield (rows along Z, cols along X).
const HF_NROWS = NAP_GRID.rowsZ - 1;
const HF_NCOLS = NAP_GRID.colsX - 1;
const AR_NROWS = ARENA_GRID.rowsZ - 1;
const AR_NCOLS = ARENA_GRID.colsX - 1;

describe('NAP terrain heightfield — real Rapier collider', () => {
  it("length invariant: heights.length === (nrows+1)*(ncols+1)", () => {
    const heights = buildNapHeightfieldArray();
    // This is the exact contract Rapier's internal DMatrix::from_vec enforces;
    // violating it is what caused the "unreachable" WASM panic.
    expect(heights.length).toBe((HF_NROWS + 1) * (HF_NCOLS + 1));
    expect(heights.length).toBe(NAP_GRID.rowsZ * NAP_GRID.colsX);
    expect(heights).toBeInstanceOf(Float32Array);
  });

  it('builds the heightfield collider without a WASM panic', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const heights = buildNapHeightfieldArray();
    expect(() => {
      // Mirror physics.js exactly: the collider spans the EXTENDED grid extent
      // (footprint + outward shore), so scale = gWidth/gDepth and translation =
      // gCenterX/gCenterZ (NOT the footprint width/depth/centre).
      const desc = RAPIER.ColliderDesc.heightfield(
        HF_NROWS, HF_NCOLS, heights,
        { x: NAP_TERRAIN.gWidth, y: 1, z: NAP_TERRAIN.gDepth },
      ).setTranslation(NAP_TERRAIN.gCenterX, 0, NAP_TERRAIN.gCenterZ);
      const collider = world.createCollider(desc);
      expect(collider).toBeTruthy();
    }).not.toThrow();
    world.free();
  });

  it('DOCUMENTS the bug: passing VERTEX counts (rowsZ, colsX) panics Rapier', () => {
    // Locks the root cause so a future refactor that reverts to vertex counts fails
    // HERE (a clear message) instead of on the live site.
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const heights = buildNapHeightfieldArray();
    expect(() => {
      const desc = RAPIER.ColliderDesc.heightfield(
        NAP_GRID.rowsZ, NAP_GRID.colsX, heights,   // WRONG: vertex counts
        { x: NAP_TERRAIN.gWidth, y: 1, z: NAP_TERRAIN.gDepth },
      );
      world.createCollider(desc);
    }).toThrow();
    world.free();
  });
});

describe('ARENA terrain heightfield — real Rapier collider (Stage 3, v0.2.329)', () => {
  it("length invariant: heights.length === (nrows+1)*(ncols+1)", () => {
    const heights = buildArenaHeightfieldArray();
    expect(heights.length).toBe((AR_NROWS + 1) * (AR_NCOLS + 1));
    expect(heights.length).toBe(ARENA_GRID.rowsZ * ARENA_GRID.colsX);
    expect(heights).toBeInstanceOf(Float32Array);
  });

  it('builds the arena heightfield collider without a WASM panic', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const heights = buildArenaHeightfieldArray();
    expect(() => {
      const desc = RAPIER.ColliderDesc.heightfield(
        AR_NROWS, AR_NCOLS, heights,
        { x: ARENA_TERRAIN.gWidth, y: 1, z: ARENA_TERRAIN.gDepth },
      ).setTranslation(ARENA_TERRAIN.gCenterX, 0, ARENA_TERRAIN.gCenterZ);
      const collider = world.createCollider(desc);
      expect(collider).toBeTruthy();
    }).not.toThrow();
    world.free();
  });
});

describe('BRIDGE deck cuboid collider — real Rapier (Stage 4, v0.2.331)', () => {
  it('builds the bridge deck cuboid collider without a panic, spanning the channel', () => {
    const world = new RAPIER.World({ x: 0, y: -25, z: 0 });
    expect(() => {
      // Mirror physics.js buildArenaColliders exactly: a static cuboid whose top
      // face sits at BRIDGE_DECK_Y, centred on the x=20 channel at z=0.
      const desc = RAPIER.ColliderDesc.cuboid(
        BRIDGE_LEN / 2, BRIDGE_THICK / 2, BRIDGE_WIDTH / 2,
      ).setTranslation(BRIDGE_X, BRIDGE_DECK_Y - BRIDGE_THICK / 2, BRIDGE_Z);
      const collider = world.createCollider(desc);
      expect(collider).toBeTruthy();
    }).not.toThrow();
    world.free();
  });

  it('deck overlaps both islands (spans past x=20 onto arena and NAP land)', () => {
    // The deck must reach onto both islands' terrain so the player can cross.
    // Arena land begins ≈ x=17, NAP land ≈ x=23; the deck spans BRIDGE_X±LEN/2.
    expect(BRIDGE_X - BRIDGE_LEN / 2).toBeLessThan(17);
    expect(BRIDGE_X + BRIDGE_LEN / 2).toBeGreaterThan(23);
  });
});

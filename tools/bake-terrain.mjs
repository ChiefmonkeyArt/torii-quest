// tools/bake-terrain.mjs — bake the legacy arena terrain heightfield into a
// data asset for the chiefmonkey-template world (Phase 0k.5 step B).
//
// The legacy arena terrain is PROCEDURALLY GENERATED from the TOMOE coast polygons
// (tomoeShapeData.js) via heightmap.js: buildArenaHeightfieldArray() samples the
// height function across the arena grid → a column-major Float32Array
// (heights[col*rowsZ + row]). This script runs that exact function in Node +
// writes the heights to worlds/chiefmonkey-template/terrain.json, so the
// data-driven world can build the SAME ground (collider + mesh) via
// buildWorldTerrain without re-running the procedural generator at load time.
//
// Also prints the grid/terrain values for the world.json `terrain` field:
//   rows = ARENA_GRID.rowsZ, cols = ARENA_GRID.colsX (vertex counts),
//   scale = [ARENA_TERRAIN.gWidth, 1, ARENA_TERRAIN.gDepth] (total extents),
//   offset = [ARENA_TERRAIN.gCenterX, 0, ARENA_TERRAIN.gCenterZ] (centre translation).
//
// Run: `node tools/bake-terrain.mjs` (regenerates terrain.json — re-run if the
// coast polygons or height function change). Pure + node-safe (heightmap.js has
// no THREE/Rapier/DOM). Verifies a sample of baked heights against sampleArenaHeight.
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildArenaHeightfieldArray,
  sampleArenaHeight,
  ARENA_GRID,
  ARENA_TERRAIN,
} from '../src/terrain/heightmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'terrain.json');

const heights = buildArenaHeightfieldArray();
const { colsX, rowsZ } = ARENA_GRID;
const { gWidth, gDepth, gCenterX, gCenterZ } = ARENA_TERRAIN;

// Sanity check: a sample of baked heights must match sampleArenaHeight exactly
// (the bake + the runtime sample read the SAME function, so they agree by
// construction — this catches a transposition or grid mismatch if either is
// ever refactored).
let mismatches = 0;
const cellW = gWidth / (colsX - 1);
const cellD = gDepth / (rowsZ - 1);
const gMinX = gCenterX - gWidth / 2;
const gMinZ = gCenterZ - gDepth / 2;
for (let i = 0; i < Math.min(20, colsX * rowsZ); i++) {
  const col = i % colsX;
  const row = Math.floor(i / colsX) % rowsZ;
  const x = gMinX + col * cellW;
  const z = gMinZ + row * cellD;
  const baked = heights[col * rowsZ + row];
  const sampled = sampleArenaHeight(x, z);
  if (Math.abs(baked - sampled) > 1e-6) {
    mismatches++;
    if (mismatches <= 3) {
      console.warn(`[bake-terrain] MISMATCH at col=${col} row=${row} (x=${x.toFixed(3)} z=${z.toFixed(3)}): baked=${baked} sampled=${sampled}`);
    }
  }
}
if (mismatches > 0) {
  console.error(`[bake-terrain] FAILED: ${mismatches} baked heights do not match sampleArenaHeight — aborting (terrain.json NOT written).`);
  process.exit(1);
}

const data = { heights: Array.from(heights, (h) => Math.round(h * 10000) / 10000) };
const json = JSON.stringify(data);
writeFileSync(outPath, json);

const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
console.log(`[bake-terrain] wrote ${outPath}`);
console.log(`[bake-terrain] vertices: ${colsX} × ${rowsZ} = ${colsX * rowsZ} heights (${kb} KB)`);
console.log(`[bake-terrain] world.json terrain field:`);
console.log(JSON.stringify({
  source: './terrain.json',
  rows: rowsZ,
  cols: colsX,
  scale: [gWidth, 1, gDepth],
  offset: [gCenterX, 0, gCenterZ],
}, null, 2));

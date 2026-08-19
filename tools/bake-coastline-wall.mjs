// tools/bake-coastline-wall.mjs — bake the legacy knee-high coastline fence into
// a compact segment-set for the chiefmonkey-template world (Phase 0k.6).
//
// Legacy (physics.js:175-190): fenceRing() returns 2 arena-play polygon rings
// (660 + 529 points). For each consecutive ring-point pair, a knee-high box
// collider: half-extents [len/2, WALL_HH=0.25, WALL_HD=0.1], at the segment
// midpoint [mx, mz], centre Y = sampleArenaHeight(mx,mz) + WALL_HH, yaw =
// atan2(-dz, dx). Collision-only (the glass-wall visual is separate in arena.js).
//
// Baking 1189 per-segment box OBJECTS into world.json would bloat the manifest
// to megabytes. Instead this script bakes the precomputed segment data (mx, cy,
// mz, len, yaw) into coastline-wall.json; a runtime collider-builder expands the
// segment-set into N Rapier cuboids. NO runtime sampleArenaHeight — the bake
// samples terrain at authoring time, keeping the base runtime generic.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fenceRing } from '../src/terrain/coastline.js';
import { sampleArenaHeight } from '../src/terrain/heightmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'coastline-wall.json');

const WALL_HH = 0.25; // half-height (legacy) -> full 0.5
const WALL_HD = 0.1;  // half-depth  (legacy) -> full 0.2

const segments = [];
const rings = fenceRing();
for (const ring of rings) {
  const rn = ring.length;
  for (let i = 0; i < rn; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % rn];
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1e-6;
    const yaw = Math.atan2(-dz, dx);
    const cy = sampleArenaHeight(mx, mz) + WALL_HH;
    segments.push([mx, cy, mz, len, yaw]);
  }
}

const data = {
  version: 1,
  height: WALL_HH * 2,    // 0.5
  thickness: WALL_HD * 2, // 0.2
  segments,
};

writeFileSync(outPath, JSON.stringify(data) + '\n');
console.log(`[bake-coastline-wall] ${rings.length} rings -> ${segments.length} segments into ${outPath}`);
console.log(`[bake-coastline-wall] ring 0: ${rings[0].length} pts, ring 1: ${rings[1].length} pts`);

// Register the coastline-wall object in world.json (idempotent: replaces any
// existing coastline-wall object).
const worldPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));
const SOURCE = 'coastline-wall.json';
const kept = (world.objects || []).filter((o) => !(o && o.type === 'coastline-wall'));
world.objects = [...kept, { type: 'coastline-wall', source: SOURCE }];
writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-coastline-wall] registered coastline-wall object (source=${SOURCE}) in world.json`);

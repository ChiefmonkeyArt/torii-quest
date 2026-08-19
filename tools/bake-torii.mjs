// tools/bake-torii.mjs — bake the torii entrance gate + pillar colliders into
// the chiefmonkey-template world manifest (Phase 0k.3 — torii).
//
// Legacy torii (arena.js:160-210 + physics.js OBSTACLES + config.js):
//   - Visual: a `torii-gate` object loads torii-gate.glb, positioned at
//     [BRIDGE_X - 0.2, BRIDGE_DECK_Y, BRIDGE_Z], rotated BRIDGE_YAW (45°),
//     scaled to WALL_H*1.3 (imposing gateway, 30% taller than the wall).
//   - Collision: 2 pillar colliders (OBSTACLES) at [BRIDGE_X, BRIDGE_Z ± 3],
//     box [0.8, WALL_H*1.3, 0.8], centre Y = ISLAND_BASE_Y + (WALL_H*1.3)/2.
//     These are COLLISION-ONLY (OBSTACLES build no visual mesh) — baked here as
//     `visible:false` box objects so worldObjectsRenderer skips the mesh while
//     buildWorldObjectColliders still builds the collider. The legacy pillars
//     are un-rotated (along Z from the gate centre) — a known legacy quirk; we
//     mirror it exactly.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_YAW, WALL_H,
} from '../src/config.js';
import { ISLAND_BASE_Y } from '../src/terrain/heightmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));

const GATE_H = WALL_H * 1.3;          // 3.38 — imposing gateway
const PILLAR_W = 0.8;                 // half-width 0.4 → full 0.8 (config OBSTACLES)
const r4 = (n) => Math.round(n * 10000) / 10000;

// 1) Update the torii-gate visual to the legacy GLB placement.
let gate = (world.objects || []).find((o) => o.type === 'torii-gate');
if (!gate) {
  gate = { type: 'torii-gate' };
  world.objects.push(gate);
}
gate.position = [r4(BRIDGE_X - 0.2), r4(BRIDGE_DECK_Y), r4(BRIDGE_Z)];
gate.rotation = [0, BRIDGE_YAW, 0];
gate.scale = GATE_H;
console.log(`[bake-torii] torii-gate at (${gate.position[0]},${gate.position[2]}) yaw=${BRIDGE_YAW.toFixed(3)} scale=${GATE_H}`);

// 2) Two collision-only pillars at the legacy obstacle positions (un-rotated,
//    along Z from the gate centre). visible:false → no mesh; collider still built.
const pillars = [
  { z: BRIDGE_Z - 3.0 },
  { z: BRIDGE_Z + 3.0 },
].map((p) => ({
  type: 'box',
  position: [r4(BRIDGE_X), r4(ISLAND_BASE_Y + GATE_H / 2), r4(p.z)],
  scale: [PILLAR_W, GATE_H, PILLAR_W],
  rotation: [0, 0, 0],
  visible: false,
  collider: { shape: 'box', size: [PILLAR_W, GATE_H, PILLAR_W] },
}));

// Replace existing pillar boxes (XZ match) — preserves crates, bridges, torii-gate.
const pillarXZ = new Set(pillars.map((p) => `${p.position[0]},${p.position[2]}`));
const isPillar = (o) =>
  o.type === 'box' && pillarXZ.has(`${r4(o.position[0])},${r4(o.position[2])}`);
const kept = (world.objects || []).filter((o) => !isPillar(o));
world.objects = [...kept, ...pillars];

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-torii] baked ${pillars.length} collision-only pillars (visible:false) into ${worldPath}`);

// tools/bake-lights.mjs — bake the legacy arena scene lights into the
// chiefmonkey-template world.json `lights` array (top-level, validated by
// worldSchema). Data-driven lights keep the world self-contained: the base
// runtime's buildMinimalWorld already builds THREE lights from world.lights.
//
// Legacy (arena.js):
//   - HemisphereLight(C_TURQ, 0xb9a06b, 0.5)  — sky/ground ambient fill.
//   - PointLight(C_PURPLE, 3, 10) at the torii gate.
//   - PointLight(C_TURQ, 3, 12) at the travel gateway (Y = sampleNapHeight + 4).
//   - PointLight(0x6ad9d0, 2.0, 22) at the NAP zone.
//
// The travel-gateway light Y is BAKED (sampleNapHeight at authoring time) —
// no runtime terrain sampling. Idempotent: replaces any existing lights array.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleNapHeight } from '../src/terrain/heightmap.js';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y,
  TRAVEL_GATE_X, TRAVEL_GATE_Z,
  NAP_TREE_X, NAP_TREE_Z,
} from '../src/config.js';

// Legacy colour constants (arena.js:19-20).
const C_PURPLE = '#8b5cf6';
const C_TURQ = '#1ad6c4';
const NAP_TEAL = '#6ad9d0';
const GROUND = '#b9a06b';

const gwY = sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z);

const lights = [
  // Sky/ground ambient fill (arena.js:68).
  { kind: 'hemisphere', color: C_TURQ, groundColor: GROUND, intensity: 0.5 },
  // Torii gate accent — purple (arena.js:176).
  { kind: 'point', color: C_PURPLE, intensity: 3, distance: 10, position: [BRIDGE_X - 1, 4 + BRIDGE_DECK_Y, BRIDGE_Z] },
  // Travel gateway accent — turquoise (arena.js:245). Y baked from sampleNapHeight + 4.
  { kind: 'point', color: C_TURQ, intensity: 3, distance: 12, position: [TRAVEL_GATE_X - 1, 4 + gwY, TRAVEL_GATE_Z] },
  // NAP zone accent — teal (arena.js:320).
  { kind: 'point', color: NAP_TEAL, intensity: 2, distance: 22, position: [NAP_TREE_X, 5 + 1.0, NAP_TREE_Z] },
];

const worldPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));
world.lights = lights;
writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-lights] ${lights.length} lights into ${worldPath}`);
console.log(`[bake-lights] travel-gateway light Y = sampleNapHeight(${TRAVEL_GATE_X},${TRAVEL_GATE_Z}) + 4 = ${(4 + gwY).toFixed(3)}`);

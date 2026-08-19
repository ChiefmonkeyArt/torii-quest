// tools/bake-bridges.mjs — bake the legacy sea-channel bridges into the
// chiefmonkey-template world manifest (Phase 0k.1 — bridges).
//
// The legacy bridges (bridge.js + physics.js) are: Bridge 1 (NAP↔Arena BL, with
// torii gate, rotated 45°) + Bridge 2 (Arena BL↔Arena BR, no gate, axis-aligned).
// Each is a box deck (walkable collider) + two side rails (visual-only). The deck
// top sits at BRIDGE_DECK_Y (centre = BRIDGE_DECK_Y - thick/2); rails sit above.
//
// Bridge 1 is rotated by BRIDGE_YAW about Y, so its rails' world XZ are the deck
// centre + the yaw-rotated rail offset. This script computes those positions at
// authoring time (no runtime rotation in worldRenderer — each rail is a plain
// box with a baked position + yaw). Positions rounded to 0.1mm for XZ-match
// idempotency on re-bake.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
  BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE2_THICK,
  BRIDGE_YAW,
} from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));

const RAIL_H = 0.5;
const RAIL_T = 0.12;
const DECK_COLOR = '#6b4a2f';  // 0x6b4a2f
const RAIL_COLOR = '#7d5a3a';  // 0x7d5a3a
const r4 = (n) => Math.round(n * 10000) / 10000;

// Rotate a 2D offset (x, z) by yaw about Y (matches THREE's Y-rotation).
function rotXZ(x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c - z * s, x * s + z * c];
}

const bridges = [];

function bakeBridge(x, z, len, width, thick, yaw, name) {
  // Deck: top at BRIDGE_DECK_Y, centre half-thick below. Box dimensions = full extents.
  bridges.push({
    type: 'box',
    position: [r4(x), r4(BRIDGE_DECK_Y - thick / 2), r4(z)],
    scale: [len, thick, width],
    rotation: [0, yaw, 0],
    color: DECK_COLOR,
    collider: { shape: 'box', size: [len, thick, width] },
  });
  // Two side rails at ±(width/2 - railThick/2) along the deck, visual-only.
  const railOff = width / 2 - RAIL_T / 2;
  for (const side of [-1, 1]) {
    const [dx, dz] = rotXZ(0, side * railOff, yaw);
    bridges.push({
      type: 'box',
      position: [r4(x + dx), r4(BRIDGE_DECK_Y + RAIL_H / 2), r4(z + dz)],
      scale: [len, RAIL_H, RAIL_T],
      rotation: [0, yaw, 0],
      color: RAIL_COLOR,
      // rails are visual-only — no collider.
    });
  }
  console.log(`[bake-bridges] ${name}: deck at (${x},${z}) yaw=${yaw.toFixed(3)} + 2 rails`);
}

bakeBridge(BRIDGE_X, BRIDGE_Z, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK, BRIDGE_YAW, 'bridge 1 (NAP↔BL)');
bakeBridge(BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE2_THICK, 0, 'bridge 2 (BL↔BR)');

// Replace existing bridge boxes only — boxes whose rounded XZ matches a baked
// bridge object's XZ. Crates (different XZ) + torii-gate/cylinder (not boxes)
// are preserved untouched.
const bridgeXZ = new Set(bridges.map((b) => `${b.position[0]},${b.position[2]}`));
const isBridge = (o) =>
  o.type === 'box' && bridgeXZ.has(`${r4(o.position[0])},${r4(o.position[2])}`);
const kept = (world.objects || []).filter((o) => !isBridge(o));
world.objects = [...kept, ...bridges];

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-bridges] baked ${bridges.length} bridge objects (${bridges.length / 3} decks + ${bridges.length - bridges.length / 3} rails) into ${worldPath}`);

// tools/bake-travel-gateway.mjs — bake the metaverse travel-portal GLB into the
// chiefmonkey-template world manifest (Phase 0k.4 — travel gateway).
//
// Legacy (arena.js _buildTravelGateway, v0.2.239): torii-gateway-experience.glb
// on the FAR side of the NAP zone. Distinct from the entrance torii-gate.glb —
// this is the actual travel portal (trigger/rings/diamond/"Press F" wired in
// main.js; the GLB itself is decorative). Placement:
//   position: [TRAVEL_GATE_X, sampleNapHeight(X,Z), TRAVEL_GATE_Z] = [0, ~ground, 32]
//   rotation: [0, π + TRAVEL_GATE_YAW_DELTA, 0] = [0, π/2, 0]  (GLB base yaw π + delta)
//   scale:    WALL_H * 1.6 = 4.16 (imposing portal, taller than the entrance gate)
//
// The data-driven renderer applies obj.scale as a uniform FACTOR (no runtime
// Box3 feet-on-floor recentering), so the baked scale is the target height
// (GLB natural height ≈ 1m — same convention as the torii-gate placeholder's
// 3.38). Ground Y is sampled at authoring time via sampleNapHeight (node-safe).
// No collider — the GLB is decorative; the travel trigger is a separate sensor.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAVEL_GATE_X, TRAVEL_GATE_Z, TRAVEL_GATE_YAW_DELTA, WALL_H } from '../src/config.js';
import { sampleNapHeight } from '../src/terrain/heightmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));

const MODEL = 'torii-gateway-experience.glb';
const TARGET_H = WALL_H * 1.6; // 4.16
const r4 = (n) => Math.round(n * 10000) / 10000;

const gwY = sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z);
const gateway = {
  type: 'gltf',
  model: MODEL,
  position: [r4(TRAVEL_GATE_X), r4(gwY), r4(TRAVEL_GATE_Z)],
  rotation: [0, Math.PI + TRAVEL_GATE_YAW_DELTA, 0],
  scale: TARGET_H,
};

// Idempotent: replace any existing gltf object loading this model.
const kept = (world.objects || []).filter(
  (o) => !(o.type === 'gltf' && o.model === MODEL),
);
world.objects = [...kept, gateway];

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-travel-gateway] gltf "${MODEL}" at (${gateway.position[0]},${gateway.position[2]}) y=${gwY.toFixed(3)} yaw=${(Math.PI + TRAVEL_GATE_YAW_DELTA).toFixed(3)} scale=${TARGET_H}`);

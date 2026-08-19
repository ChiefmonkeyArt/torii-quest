// tools/bake-crates.mjs — bake the legacy arena crates into the chiefmonkey-template
// world manifest (Phase 0k.2 — static crates).
//
// The legacy arena crates live in config.js as CRATES = [[cx, cz, halfW, halfD,
// fullH], ...]. arena.js + physics.js place each crate so its base sits ON the
// undulating terrain: center Y = fullH/2 + sampleArenaHeight(cx, cz) (v0.2.330).
// Crates outside the play area (isArenaPlayArea) are skipped (water, bridge, NAP).
//
// This script bakes that placement at AUTHORING TIME: for each in-zone crate it
// samples the terrain height + writes a world.json `box` object with a `box`
// collider, so the data-driven world places crates that ride the hills exactly
// like the legacy arena — no runtime terrain sampling in worldRenderer. Re-run
// when CRATES or the terrain height function change.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRATES } from '../src/config.js';
import { sampleArenaHeight } from '../src/terrain/heightmap.js';
import { isArenaPlayArea } from '../src/terrain/tomoeShape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldPath = resolve(__dirname, '..', 'worlds', 'chiefmonkey-template', 'world.json');

const world = JSON.parse(readFileSync(worldPath, 'utf8'));

// Build the baked crate objects. Matches arena.js:144 + physics.js:152 —
// center Y = fullH/2 + sampleArenaHeight(cx, cz); skip crates outside the play
// zone (isArenaPlayArea) so crates never land in water/bridge/NAP.
const CRATE_COLOR = '#4a4458'; // C_CRATE from arena.js (0x4a4458)
const bakedCrates = [];
let skipped = 0;
for (const [cx, cz, hw, hd, ch] of CRATES) {
  if (!isArenaPlayArea(cx, cz)) { skipped++; continue; }
  const y = ch / 2 + sampleArenaHeight(cx, cz);
  bakedCrates.push({
    type: 'box',
    position: [cx, y, cz],
    scale: [hw * 2, ch, hd * 2],
    color: CRATE_COLOR,
    collider: { shape: 'box', size: [hw * 2, ch, hd * 2] },
  });
}

// Replace any existing `box` objects (placeholder crates from earlier template
// drafts) with the baked crates. Non-box objects (torii-gate, cylinder, ...) are
// preserved untouched — they're extracted in their own 0k.x steps.
const kept = (world.objects || []).filter((o) => o.type !== 'box');
world.objects = [...kept, ...bakedCrates];

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');

console.log(`[bake-crates] baked ${bakedCrates.length} crates into ${worldPath}`);
if (skipped > 0) console.log(`[bake-crates] skipped ${skipped} crate(s) outside the play zone`);
for (const c of bakedCrates) {
  console.log(`[bake-crates]   crate at (${c.position[0]}, ${c.position[2]}) → Y=${c.position[1].toFixed(3)} (size ${c.scale.join('x')})`);
}

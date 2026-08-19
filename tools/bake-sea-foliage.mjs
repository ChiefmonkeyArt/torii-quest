// tools/bake-sea-foliage.mjs — opt the chiefmonkey-template world into the
// procedural ocean + instanced grass/wildflowers. The legacy arena builds the
// sea (buildArena → buildSeaMesh) + foliage (arenaRuntime boot → buildFoliage)
// unconditionally; the data-driven world builds them only when the manifest
// sets world.sea / world.foliage. This bakes both flags so the data-driven
// chiefmonkey-template matches the legacy arena's scenery.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const worldPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));
world.sea = true;
world.foliage = true;
writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-sea-foliage] sea=true foliage=true in ${worldPath}`);

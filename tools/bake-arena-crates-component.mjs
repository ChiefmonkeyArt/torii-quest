// tools/bake-arena-crates-component.mjs — replace the 9 inline crate box objects
// in chiefmonkey-template world.json with a single component instance
// { id: 'arena.crates' } in world.components. At manifest-load time the host
// resolver (expandWorldComponents) loads arena.crates from the built-in registry
// + calls expand(config) → the SAME 9 box objects, byte/shape-equivalent.
//
// This is the 0l.1 proof that a droppable component contributes static scenery
// data through the same renderer/collider path as inline-authored objects.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRATES } from '../src/config.js';
import { isArenaPlayArea } from '../src/terrain/tomoeShape.js';

const COMPONENT_ID = 'arena.crates';

// The XZ of every legacy crate that arena.crates.expand produces (the same filter
// bake-crates.mjs uses — only crates inside the play zone are emitted).
const crateXZ = new Set();
for (const [cx, cz] of CRATES) {
  if (isArenaPlayArea(cx, cz)) crateXZ.add(`${cx},${cz}`);
}

const worldPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));

// Remove the inline crate box objects (XZ-match) — the component expands them.
const removed = [];
const kept = (world.objects || []).filter((o) => {
  if (o && o.type === 'box' && Array.isArray(o.position) && crateXZ.has(`${o.position[0]},${o.position[2]}`)) {
    removed.push(o);
    return false;
  }
  return true;
});
world.objects = kept;

// Register the component instance (idempotent: replace any existing arena.crates).
const components = (world.components || []).filter((c) => !(c && c.id === COMPONENT_ID));
components.push({ id: COMPONENT_ID });
world.components = components;

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-arena-crates-component] replaced ${removed.length} inline crates with component '${COMPONENT_ID}'`);

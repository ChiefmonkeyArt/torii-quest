// tools/bake-torii-gateway-component.mjs — replace the inline travel-gateway
// GLTF object in chiefmonkey-template world.json with a torii.gateway component
// instance carrying the exact baked values. At manifest-load time the host
// resolver (expandWorldComponents) loads torii.gateway + calls expand(config) →
// the SAME gltf object, shape-equivalent to the 0k.4 baked inline object.
//
// 0l.3 DATA SHELL only: the component's mount/unmount are no-ops — no travel,
// no auth, no click/raycast, no Nostr. The decorative GLTF keeps rendering through
// the standard buildWorldObjects path as if authored inline.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENT_ID = 'torii.gateway';
const MODEL = 'torii-gateway-experience.glb';

const worldPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'worlds', 'chiefmonkey-template', 'world.json');
const world = JSON.parse(readFileSync(worldPath, 'utf8'));

// Find the inline travel-gateway gltf object (0k.4). Remove ONLY it — other gltf
// objects (torii-gate etc.) are preserved untouched.
let removed = null;
const kept = (world.objects || []).filter((o) => {
  if (o && o.type === 'gltf' && o.model === MODEL) { removed = o; return false; }
  return true;
});
world.objects = kept;

if (!removed) {
  console.log(`[bake-torii-gateway-component] no inline travel-gateway object found (already a component?) — skipping`);
  process.exit(0);
}

// Register the component instance carrying the exact baked object values.
const components = (world.components || []).filter((c) => !(c && c.id === COMPONENT_ID));
components.push({
  id: COMPONENT_ID,
  config: {
    model: removed.model,
    position: removed.position,
    rotation: removed.rotation,
    scale: removed.scale,
  },
});
world.components = components;

writeFileSync(worldPath, JSON.stringify(world, null, 2) + '\n');
console.log(`[bake-torii-gateway-component] replaced inline travel-gateway with component '${COMPONENT_ID}'`);
console.log(`[bake-torii-gateway-component]   model=${removed.model} pos=${JSON.stringify(removed.position)} scale=${removed.scale}`);

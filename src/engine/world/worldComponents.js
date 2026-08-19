// engine/world/worldComponents.js — the 0l.1 component-expansion resolver. A
// world manifest may declare component instances (world.components) that
// contribute STATIC scenery data via a component's expand(config) path. This
// resolver loads each instance from the registry, calls expand, and appends
// the resulting objects to world.objects — so a droppable component's scenery
// flows through the SAME buildWorldObjects + buildWorldObjectColliders path as
// inline-authored objects.
//
// Pure + node-safe: the registry is pure (built-in factories only, no remote
// code). Failures are best-effort: an unknown id or a throwing expand is warned
// + skipped (its objects omitted) — it never fails the whole world, mirroring
// the per-item omit style of worldSchema's objects[]/lights[].
import { validateWorld } from './worldSchema.js';

// expandWorldComponents(world, registry, opts?) → { world, expanded, errors }.
// `world` is a VALIDATED world (from validateWorld) OR a raw manifest; when raw
// it is validated first. The registry is a component registry (createRegistry).
// Returns a NEW world object with component-expanded objects appended to
// world.objects (the input is not mutated). `expanded` is the count of objects
// contributed; `errors` lists per-instance failures.
export function expandWorldComponents(world, registry, opts = {}) {
  const errors = [];
  if (!world || typeof world !== 'object') return { world, expanded: 0, errors: ['world must be an object'] };
  if (!registry || typeof registry.load !== 'function') return { world, expanded: 0, errors: ['registry has no load()'] };

  // Work from a validated world so component-expanded objects pass the same
  // shape rules as inline ones. If validation fails, return as-is (the caller's
  // own validation will have surfaced the real errors).
  const validated = world.objects ? world : validateWorld(world).world;
  if (!validated) return { world, expanded: 0, errors: ['world failed schema validation'] };

  const components = Array.isArray(validated.components) ? validated.components : [];
  const baseObjects = Array.isArray(validated.objects) ? validated.objects.slice() : [];
  const added = [];

  for (let i = 0; i < components.length; i++) {
    const inst = components[i];
    if (!inst || typeof inst !== 'object') { errors.push(`components[${i}]: not an object`); continue; }
    const id = typeof inst.id === 'string' ? inst.id : null;
    if (!id) { errors.push(`components[${i}]: missing id`); continue; }
    const config = (inst.config && typeof inst.config === 'object' && !Array.isArray(inst.config)) ? inst.config : {};
    const r = registry.load(id, config);
    if (!r.ok || !r.component) { errors.push(`components[${i}] (${id}): ${r.errors.join('; ')}`); continue; }
    const comp = r.component;
    // A component without expand() is not a data-expanding component — it's a
    // scene-mounted component (e.g. torii.gateway). Treat as 0 objects, no error
    // (the runtime host handles its mount/unmount lifecycle separately).
    if (typeof comp.expand !== 'function') { continue; }
    let objs;
    try {
      objs = comp.expand(config);
    } catch (e) {
      errors.push(`components[${i}] (${id}): expand threw: ${e?.message || String(e)}`);
      continue;
    }
    if (Array.isArray(objs)) {
      // Re-validate each expanded object through the schema so a component can't
      // smuggle a malformed object past the world loader. A bad object is dropped
      // (counted as an error) without aborting the rest.
      for (const o of objs) {
        const probe = validateWorld({ version: 1, id: 'probe', name: 'p', objects: [o] });
        if (probe.ok && probe.world.objects && probe.world.objects.length) {
          added.push(probe.world.objects[0]);
        } else {
          errors.push(`components[${i}] (${id}): expanded an invalid object`);
        }
      }
    }
  }

  const out = { ...validated };
  out.objects = [...baseObjects, ...added];
  if (validated.terrain) out.terrain = validated.terrain;
  if (validated.sea) out.sea = true;
  if (validated.foliage) out.foliage = true;
  return { world: out, expanded: added.length, errors };
}

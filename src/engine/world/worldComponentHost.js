// engine/world/worldComponentHost.js — the 0l.2 RUNTIME component host. The
// expandWorldComponents resolver handles STATIC data expansion (world.objects);
// this host handles the RUNTIME mount(scene,opts)/unmount() lifecycle for
// component instances declared in world.components. A component may be both
// (data + runtime) — expand runs at manifest-load, mount runs once the scene
// exists. A scene-mounted component (no expand) is mounted here only.
//
// Pure-ish + node-safe: the host itself is plain JS; THREE/scene are passed in
// by the caller, so a host without a renderer (tests) still loads. Failures are
// best-effort: an unknown id or a throwing mount is warned + skipped — it never
// fails the whole world, mirroring the per-item omit style of the schema + the
// static resolver.
import { validateWorld } from './worldSchema.js';

// mountWorldComponents(world, registry, scene, options?) → a handle.
// `world` is a VALIDATED world OR a raw manifest (validated first). `registry`
// is a component registry. `scene` is the render scene (THREE.Scene-like); when
// null/undefined (no renderer yet), components that need a scene no-op safely.
// `options` carries host context (THREE, worldId, ...) forwarded to each mount.
// Returns { mounted: number, errors: string[] } and stores the mounted component
// instances on the handle for unmount.
export function mountWorldComponents(world, registry, scene, options = {}) {
  const errors = [];
  if (!world || typeof world !== 'object') return _handle([], ['world must be an object']);
  if (!registry || typeof registry.load !== 'function') return _handle([], ['registry has no load()']);
  const validated = world.components ? world : validateWorld(world).world;
  if (!validated) return _handle([], ['world failed schema validation']);
  const components = Array.isArray(validated.components) ? validated.components : [];
  const ctx = { ...options, scene };
  const mounted = [];
  for (let i = 0; i < components.length; i++) {
    const inst = components[i];
    if (!inst || typeof inst !== 'object') { errors.push(`components[${i}]: not an object`); continue; }
    const id = typeof inst.id === 'string' ? inst.id : null;
    if (!id) { errors.push(`components[${i}]: missing id`); continue; }
    const config = (inst.config && typeof inst.config === 'object' && !Array.isArray(inst.config)) ? inst.config : {};
    const r = registry.load(id, config);
    if (!r.ok || !r.component) { errors.push(`components[${i}] (${id}): ${r.errors.join('; ')}`); continue; }
    const comp = r.component;
    try {
      const ok = comp.mount(scene, { ...ctx, config, componentInstance: id });
      mounted.push({ id, component: comp });
      if (ok === false) {
        // mount may legitimately no-op (no scene / not applicable); not an error.
      }
    } catch (e) {
      errors.push(`components[${i}] (${id}): mount threw: ${e && e.message ? e.message : String(e)}`);
      // A throwing mount must not leave the component half-mounted; best-effort
      // unmount in case it created partial state before throwing.
      try { comp.unmount(); } catch (_) { /* swallow during error cleanup */ }
    }
  }
  return _handle(mounted, errors);
}

function _handle(mounted, errors) {
  return {
    mounted: mounted.length,
    errors,
    unmount() {
      // Unmount in REVERSE order (LIFO) — mirrors init/teardown symmetry. Never
      // throws during teardown: a failing unmount is swallowed so one bad
      // component can't block the rest of world teardown.
      const errs = [];
      for (let i = mounted.length - 1; i >= 0; i--) {
        const { id, component } = mounted[i];
        try { component.unmount(); } catch (e) {
          errs.push(`${id}: unmount threw: ${e && e.message ? e.message : String(e)}`);
        }
      }
      return errs;
    },
  };
}

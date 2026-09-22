// engine/world/legacyArenaTeardown.js — the in-place travel teardown sweep for a
// LEGACY home arena (buildArena + buildMirror + buildFoliage + buildSeaMesh).
//
// Pure + node-safe: no THREE import, no DOM. The scene container and every object
// are INJECTED (mock THREE in tests), so the sweep is unit-testable without the
// ~610 KB three chunk. arenaRuntime calls sweepLegacyArena(scene) when leaving a
// legacy arena; the returned count is diagnostic only (never throws).
//
// WHY THIS EXISTS — a legacy home sets _homeWasLegacy and never registers a
// _worldRt/_worldTerrain, so _rebuildWorldInPlace's normal dispose path no-ops and
// the destination world lands layered under a crazy-quilt of leftover arena meshes
// (the "still all yellow" landing). Every legacy scene object that isn't part of
// the data-driven world gets a name; this sweep removes + disposes them by name.

// The canonical set of legacy object names. Each is assigned via `.name = ...` in
// the owning module: arena.js (arena-floor, nap-zone-floor, coastline-wall,
// coastline-neon, torii-gate, travel-gateway, arena-fill-light, torii-gate-light,
// travel-gateway-light, nap-light, nap-tree, arena-crate, bridge-nap-bl,
// bridge-bl-br), mirror.js (arena-mirror, arena-mirror-light), arena-foliage.js
// (grass-instanced), terrain/sea.js (sea), proofSurfaceMeshes.js (proof-surfaces).
export const LEGACY_ARENA_NAMES = Object.freeze([
  'arena-floor', 'nap-zone-floor', 'sea', 'coastline-wall', 'coastline-neon',
  'torii-gate', 'travel-gateway', 'grass-instanced', 'arena-fill-light',
  'nap-light', 'torii-gate-light', 'travel-gateway-light', 'arena-crate',
  'nap-tree', 'proof-surfaces', 'arena-mirror', 'arena-mirror-light',
  'bridge-nap-bl', 'bridge-bl-br',
]);

// isLegacyArenaName(name) → boolean. The single matching predicate so the name set
// can never drift between arenaRuntime and this module.
export function isLegacyArenaName(name) {
  return typeof name === 'string' && LEGACY_ARENA_NAMES.includes(name);
}

// sweepLegacyArena(container) → number of objects detached. Detaches every object
// reachable from `container` whose name is in LEGACY_ARENA_NAMES, disposing each
// Mesh descendant's geometry + material. Idempotent (re-running finds nothing) and
// never throws (every risky call is guarded — a torn-down scene must not break the
// swap). `container` needs only `.traverse(fn)` and optionally `.remove(child)`.
export function sweepLegacyArena(container) {
  if (!container || typeof container.traverse !== 'function') return 0;
  const matches = [];
  container.traverse((o) => {
    if (o && isLegacyArenaName(o.name)) matches.push(o);
  });
  for (const o of matches) {
    // Detach from its parent (the scene itself has no `.parent`).
    try { if (o.parent) o.parent.remove(o); else if (container.remove) container.remove(o); } catch { /* noop */ }
    // Dispose the mesh subtree's GPU resources. Lights/groups carry no geometry.
    try {
      o.traverse((c) => {
        if (c && c.isMesh) {
          try { if (c.geometry) c.geometry.dispose(); } catch { /* noop */ }
          try { if (c.material) c.material.dispose(); } catch { /* noop */ }
        }
      });
    } catch { /* noop */ }
  }
  return matches.length;
}

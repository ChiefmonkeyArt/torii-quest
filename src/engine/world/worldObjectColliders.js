// engine/world/worldObjectColliders.js — the physics adapter for data-driven
// world manifest objects (Phase 0i, foundation slice). Given a validated
// `world` object (from worldSchema.validateWorld, whose `objects[]` entries may
// now carry an optional validated `collider` field) + the shared
// { physicsWorld, Rapier } deps, it builds fixed Rapier colliders for every
// object that declares one. An object WITHOUT a `collider` field is visual-only
// (current behaviour) and is skipped entirely.
//
// INJECTED DEPS — NO static @dimforge/rapier3d-compat import. Mirrors
// _addPlatformCollider in arenaRuntime.js, which reaches the Rapier world +
// namespace via getWorld()/getRapier() (the lazy initPhysics dynamic import).
// Keeping this module free of the async import lets it stay a thin, testable
// factory surface (the same separation as engine/physics/bodies.js).
//
// THREE-FREE + browser-only: it touches the Rapier world, which only exists
// in-browser after initPhysics. No `three` import, no DOM, no timers — importable
// in vitest's node env with a FAKE Rapier (tests pass mock deps).
//
// CONSTRAINED BY CONSTRUCTION: buildWorldObjectColliders(world, { physicsWorld,
// Rapier }) → { colliders, bodies, dispose }. Fail-safe: missing
// physicsWorld/Rapier/world/objects → no-op (returns empty, never throws). A
// collider build failure for ONE object must NOT abort the others or break the
// game loop — each object is wrapped in its own try/catch (never-throws-into-
// the-loop). dispose() removes every collider + rigid body best-effort (each
// removal is its own try/catch so a stuck handle never blocks the rest).

// buildWorldObjectColliders(world, { physicsWorld, Rapier }) → { colliders, bodies, dispose }
//   world         — a validated world object (worldSchema.validateWorld result
//                   .world). Only `world.objects` is read; the rest is ignored.
//   physicsWorld  — the Rapier world (from physics.js getWorld()). When null/
//                   undefined, the build is a no-op (colliders are optional and
//                   Rapier is lazy — the minimal world can boot before physics
//                   is ready; visual-only is the safe fallback).
//   Rapier        — the loaded @dimforge/rapier3d-compat namespace (from
//                   physics.js getRapier()). When null/undefined → no-op.
//
// Returns:
//   { colliders, bodies, dispose }
//     colliders — Rapier Collider handles created (for diagnostics/teardown).
//     bodies    — Rapier RigidBody handles created (for diagnostics/teardown).
//     dispose() — removes every collider + rigid body from the physicsWorld,
//                  best-effort (never throws; each removal is independently
//                  guarded). Safe to call multiple times (idempotent).
//
// For each object with a validated `collider` field:
//   1. center = object.position + (collider.offset || [0,0,0]).
//   2. fixed rigid body at center: physicsWorld.createRigidBody(
//        Rapier.RigidBodyDesc.fixed().setTranslation(cx, cy, cz)
//      ) — mirrors _addPlatformCollider.
//   3. collider desc:
//        box      → Rapier.ColliderDesc.cuboid(size[0]/2, size[1]/2, size[2]/2)
//        cylinder → Rapier.ColliderDesc.cylinder(height/2, radius) (Y-axis).
//   4. apply object yaw (object.rotation[1]) if present:
//        desc.setRotation({ x:0, y:sin(yaw/2), z:0, w:cos(yaw/2) }) — mirrors
//        createStaticYaw in engine/physics/bodies.js.
//   5. if collider.sensor → desc.setSensor(true).
//   6. physicsWorld.createCollider(desc, rb).
export function buildWorldObjectColliders(world, { physicsWorld, Rapier } = {}) {
  // Fail-safe: missing deps or world → no-op. Never throws (an absent Rapier
  // world is a legitimate early-boot state — the minimal world renders fine
  // visual-only; the platform collider handles the walkable surface alone).
  if (!physicsWorld || !Rapier || !world || !Array.isArray(world.objects)) {
    return { colliders: [], bodies: [], dispose: () => {} };
  }

  const colliders = [];
  const bodies = [];
  const pw = physicsWorld;

  for (let i = 0; i < world.objects.length; i++) {
    const obj = world.objects[i];
    // Per-object try/catch: one failure (a bad object, a Rapier panic on a
    // degenerate shape, etc.) must NOT abort the remaining objects or break the
    // boot. A failed object is skipped; the rest still build. Never-throws-into-
    // the-loop.
    let rb = null; // tracked so the catch can clean up a dangling body if a
                  // later step (desc/rotation/sensor/createCollider) throws.
    try {
      if (!obj || !obj.collider) continue; // visual-only (no collider field)
      const c = obj.collider;
      const pos = obj.position;
      if (!Array.isArray(pos) || pos.length !== 3) continue;

      const off = Array.isArray(c.offset) && c.offset.length === 3 ? c.offset : [0, 0, 0];
      const cx = pos[0] + off[0];
      const cy = pos[1] + off[1];
      const cz = pos[2] + off[2];

      // Fixed rigid body at the collider center (mirror _addPlatformCollider).
      const rbDesc = Rapier.RigidBodyDesc.fixed().setTranslation(cx, cy, cz);
      rb = pw.createRigidBody(rbDesc);
      if (!rb) continue;

      // Collider desc by shape.
      let desc;
      if (c.shape === 'box') {
        const s = c.size;
        desc = Rapier.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2);
      } else if (c.shape === 'cylinder') {
        desc = Rapier.ColliderDesc.cylinder(c.height / 2, c.radius);
      } else {
        // Unknown shape (schema should have filtered this, but be defensive):
        // remove the body we just made and skip. Never leaves a dangling rb.
        try { pw.removeRigidBody(rb); } catch { /* best-effort */ }
        rb = null;
        continue;
      }
      if (!desc) {
        try { pw.removeRigidBody(rb); } catch { /* best-effort */ }
        rb = null;
        continue;
      }

      // Apply object yaw (rotation[1]) if the object carries a rotation. Mirrors
      // createStaticYaw: a rotation about Y by `yaw` radians is encoded as the
      // quaternion {x:0, y:sin(yaw/2), z:0, w:cos(yaw/2)}. This rotates the
      // collider's local half-extents to align with the visual mesh's yaw.
      if (Array.isArray(obj.rotation) && obj.rotation.length === 3) {
        const yaw = Number(obj.rotation[1]);
        if (Number.isFinite(yaw) && yaw !== 0) {
          const sy = Math.sin(yaw / 2), cy2 = Math.cos(yaw / 2);
          try { desc.setRotation({ x: 0, y: sy, z: 0, w: cy2 }); } catch { /* best-effort */ }
        }
      }

      // Sensor colliders report contacts without physically blocking (mirrors
      // the NPC capsule + bone-ball sensors in bodies.js).
      if (c.sensor) {
        try { desc.setSensor(true); } catch { /* best-effort */ }
      }

      const collider = pw.createCollider(desc, rb);
      // Only commit to the result arrays once the FULL object succeeded, so a
      // mid-build throw never leaves a dangling body (no collider) in the set.
      if (collider) {
        bodies.push(rb);
        colliders.push(collider);
      } else {
        try { pw.removeRigidBody(rb); } catch { /* best-effort */ }
      }
      rb = null; // committed or cleaned up; the catch no longer owns it
    } catch {
      // Swallow: a single bad object must not abort the rest. The object simply
      // has no collider (visual-only), matching the fail-safe contract. Clean up
      // any half-built rigid body so the physics world never holds a dangling rb.
      if (rb) { try { pw.removeRigidBody(rb); } catch { /* best-effort */ } }
    }
  }

  // dispose() — remove every collider + rigid body, best-effort. Each removal
  // is independently guarded so a stuck/already-removed handle never blocks the
  // rest. Idempotent: safe to call multiple times (a second call finds the
  // arrays empty and no-ops). Never throws.
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < colliders.length; i++) {
      try { pw.removeCollider(colliders[i], true); } catch { /* best-effort */ }
    }
    for (let i = 0; i < bodies.length; i++) {
      try { pw.removeRigidBody(bodies[i]); } catch { /* best-effort */ }
    }
  }

  return { colliders, bodies, dispose };
}

// engine/world/worldArrival.js — where a traveller lands when they walk through
// a torii gate into another node's world.
//
// A resolved manifest carries the OWNER's login spawn (`spawn`, from the legacy
// `spawns.player`) — the point the owner appears at when THEY boot the world. A
// traveller must NOT appear there (mid-arena). They arrive at the world's torii
// gate, standing just inside it and looking out over the world — "as if I'd just
// walked through the gate".
//
// Pure + node-testable: reads only the validated manifest, returns { x, z, yaw }.

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve the arrival pose for a traveller entering `world`.
 *
 * @param {object} world validated manifest (may be undefined)
 * @param {{ gateInset?: number }} [opts]
 * @returns {{ x: number, z: number, yaw: number }}
 */
export function resolveArrival(world, { gateInset = 2.6 } = {}) {
  const spawn = (world && world.spawn && Array.isArray(world.spawn.position))
    ? { x: _num(world.spawn.position[0]), z: _num(world.spawn.position[2]) }
    : null;

  // The doorway: prefer an explicit `gateway.position`, else the first `torii-gate`
  // object (the entry gate). `travel-gate` is also type-mapped to 'torii-gate' by
  // the serializer, but the entry gate is always emitted first in the legacy order.
  let gate = null;
  if (world && world.gateway && Array.isArray(world.gateway.position)) {
    gate = { x: _num(world.gateway.position[0]), z: _num(world.gateway.position[2]) };
  } else if (world && Array.isArray(world.objects)) {
    const g = world.objects.find((o) => o && o.type === 'torii-gate' && Array.isArray(o.position));
    if (g) gate = { x: _num(g.position[0]), z: _num(g.position[2]) };
  }

  // No gate: fall back to the owner spawn only if we have one.
  if (!gate) {
    if (spawn) {
      return {
        x: spawn.x,
        z: spawn.z,
        yaw: (world.spawn && typeof world.spawn.yaw === 'number') ? world.spawn.yaw : 0,
      };
    }
    return { x: 0, z: 0, yaw: 0 };
  }

  // Face into the world: aim from the gate toward the interior (owner spawn, or a
  // sensible default when the manifest has no spawn), and stand just past the gate
  // on that side. Forward convention matches the client: (sin yaw, cos yaw).
  let dx = spawn ? (spawn.x - gate.x) : 0;
  let dz = spawn ? (spawn.z - gate.z) : -1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = -1; } else { dx /= len; dz /= len; }
  const yaw = Math.atan2(dx, dz);

  return {
    x: gate.x + dx * _num(gateInset),
    z: gate.z + dz * _num(gateInset),
    yaw,
  };
}
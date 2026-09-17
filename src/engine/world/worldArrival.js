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
  let gateYaw = null; // the gate's through-axis yaw, read from a torii-gate rotation
  let aim = null;     // explicit point the gate faces toward (gateway.target vec3)
  if (world && world.gateway && Array.isArray(world.gateway.position)) {
    gate = { x: _num(world.gateway.position[0]), z: _num(world.gateway.position[2]) };
    if (Array.isArray(world.gateway.target) && world.gateway.target.length >= 3) {
      aim = { x: _num(world.gateway.target[0]), z: _num(world.gateway.target[2]) };
    }
  } else if (world && Array.isArray(world.objects)) {
    const g = world.objects.find((o) => o && o.type === 'torii-gate' && Array.isArray(o.position));
    if (g) {
      gate = { x: _num(g.position[0]), z: _num(g.position[2]) };
      if (Array.isArray(g.rotation)) gateYaw = _num(g.rotation[1]);
    }
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

  // Face out of the gate into the world. Priority (most → least authoritative):
  //   1. the gate's OWN through-axis (its rotation yaw) — a rotated gate faces the
  //      world the way it is actually built, not along a spawn-point vector that can
  //      sit off-axis. Sign the axis toward the interior (owner spawn) when one is
  //      known, so "walking out" always points into the world, never back at the
  //      gateway. (ADR-0119 spawn-at-gate nuance.)
  //   2. gateway.target — the explicit point the gate looks toward.
  //   3. the owner spawn — the interior of the world.
  //   4. -z — a sensible default with no other signal.
  // Forward convention matches the client: (sin yaw, cos yaw).
  let dx;
  let dz;
  if (gateYaw !== null && Number.isFinite(gateYaw)) {
    dx = Math.sin(gateYaw);
    dz = Math.cos(gateYaw);
    if (spawn) {
      const toward = (spawn.x - gate.x) * dx + (spawn.z - gate.z) * dz;
      if (toward < 0) { dx = -dx; dz = -dz; }
    }
  } else {
    let tx = 0;
    let tz = -1;
    if (aim && (Math.abs(aim.x - gate.x) + Math.abs(aim.z - gate.z)) > 1e-6) {
      tx = aim.x - gate.x;
      tz = aim.z - gate.z;
    } else if (spawn) {
      tx = spawn.x - gate.x;
      tz = spawn.z - gate.z;
    }
    const len = Math.hypot(tx, tz);
    if (len < 1e-6) { dx = 0; dz = -1; } else { dx = tx / len; dz = tz / len; }
  }
  const yaw = Math.atan2(dx, dz);

  const ins = _num(gateInset);
  return {
    x: gate.x + dx * ins,
    z: gate.z + dz * ins,
    yaw,
  };
}
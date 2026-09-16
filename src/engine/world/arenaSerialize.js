// engine/world/arenaSerialize.js — the SERIALIZE half of world-as-data (ADR-0119).
//
// Translates the LEGACY arena (worlds/default/world.json config + the deterministic
// heightmap.js terrain) into a PORTABLE world-as-data manifest (version:1) so a node
// can publish the world a traveller is actually walking into: one self-contained
// content-addressed manifest whose single sha256 pins the ground, layout, spawn,
// lighting, and combat config. The twin of worldResolver.js (resolve half).
//
// PURE + node-safe: NO DOM, NO THREE, NO fetch, NO signing. The heightfields are
// injected (the host samples heightmap.js buildArenaHeightfieldArray /
// buildNapHeightfieldArray and passes plain arrays), so this leaf is fully
// unit-testable and never touches a browser or a relay.
//
// Mapping contract (legacy field → portable field):
//   v                → version (forced 1)
//   (host-supplied)  → id (legacy has no id)
//   name             → name
//   spawns.player    → spawn.position + spawn.yaw
//   bounds           → bounds (whitelisted in worldSchema)
//   combat           → combat (whitelisted in worldSchema)
//   lights[].type    → lights[].kind  (legacy `type`/`pos` → `kind`/`position`)
//   objects[]        → objects[] (type-mapped; unmappable types are skipped)
//   terrain (injected heightfields) → terrain.zones (inline heights)
//   sea/foliage      → sea:true / foliage:true
// The result is validated against validateWorld so a bad translation fails LOUDLY
// (returned as { ok:false, error }) rather than shipping an unrenderable world.

import { validateWorld } from './worldSchema.js';

// Legacy light.type → portable light.kind. The portable closed set is
// ambient/directional/point/hemisphere, which matches the legacy set 1:1.
const LIGHT_KIND = { ambient: 'ambient', directional: 'directional', point: 'point', hemisphere: 'hemisphere' };

// Legacy object.type → portable object.type. Only types the portable renderer can
// actually build are kept; the rest are skipped (a skipped object is a deliberate
// degradation, never an error — the terrain + gate + spawn + sea remain).
const OBJECT_HINT = {
  'torii-gate': 'torii-gate',
  'travel-gate': 'torii-gate', // no dedicated travel-gate portable type yet; the gate alias still reads as a portal
};

// _num(x) → finite number or undefined.
function _num(v) {
  const n = (typeof v === 'string' && v.trim() !== '') ? Number(v) : v;
  return (typeof n === 'number' && Number.isFinite(n)) ? n : undefined;
}

// _legacyVec(v) — legacy pos fields can be arrays or {x,y,z}; normalise to [x,y,z].
function _legacyVec(v) {
  if (Array.isArray(v) && v.length === 3) {
    const a = v.map(_num);
    return a.every((n) => n !== undefined) ? a : null;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const a = [_num(v.x), _num(v.y), _num(v.z)];
    return a.every((n) => n !== undefined) ? a : null;
  }
  return null;
}

// _zone({rows,cols,scale,offset,heights}) → {rows,cols,scale,offset?,heights} or
// null. Inline heights are forced to a plain finite-number array (JSON round-trip
// of a Float32Array yields numbers, not typed arrays). scale must be [x,y,z]>0.
function _zone(z) {
  if (!z || typeof z !== 'object') return null;
  const rows = _num(z.rows);
  const cols = _num(z.cols);
  const scale = _legacyVec(z.scale);
  if (!Number.isInteger(rows) || rows < 2 || !Number.isInteger(cols) || cols < 2) return null;
  if (!scale || !scale.every((n) => n > 0)) return null;
  // Round heights to 3 decimals (millimetre) — deterministic + dramatically
  // compacts the manifest (a float32 like 0.3857123463153839 → 0.386) while
  // keeping sub-mm terrain fidelity for both the collider AND the mesh (they read
  // the SAME rounded values, so they stay consistent).
  const heights = (z.heights && typeof z.heights.length === 'number')
    ? Array.from(z.heights, (n) => _num(n)).map((n) => Math.round(n * 1000) / 1000)
    : null;
  if (!heights || heights.length !== rows * cols || !heights.every((n) => n !== undefined)) return null;
  const out = { rows, cols, scale, heights };
  const offset = _legacyVec(z.offset);
  if (offset) out.offset = offset;
  return out;
}

/**
 * serializeArenaWorld({ worldId, legacy, zones }) → { ok, world, manifestJson } |
 * { ok:false, error }. Never throws. `manifestJson` is the JSON.stringify of `world`
 * (deterministic field order via the object built here).
 */
export function serializeArenaWorld({ worldId, legacy, zones, name } = {}) {
  const fail = (error) => ({ ok: false, error });

  if (typeof worldId !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(worldId)) {
    return fail('bad-world-id');
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return fail('bad-legacy');
  if (!Array.isArray(zones) || zones.length === 0) return fail('bad-zones');

  const world = {
    version: 1,
    id: worldId,
    name: (typeof (name || legacy.name) === 'string' && (name || legacy.name).trim())
      ? (name || legacy.name).trim()
      : worldId,
  };

  // terrain.zones — the samplable ground. Any bad zone is dropped; if none
  // survive, the world is unrenderable and we fail (the ground must never vanish).
  const terrainZones = zones.map(_zone).filter(Boolean);
  if (terrainZones.length === 0) return fail('no-valid-zones');
  world.terrain = { zones: terrainZones };

  // spawn — legacy `spawns.player` {x,y,z,yaw} → portable spawn.position + yaw.
  if (legacy.spawns && legacy.spawns.player && typeof legacy.spawns.player === 'object') {
    const p = legacy.spawns.player;
    const pos = [_num(p.x), _num(p.y), _num(p.z)];
    if (pos.every((n) => n !== undefined)) {
      const yaw = _num(p.yaw);
      world.spawn = { position: pos };
      if (yaw !== undefined) world.spawn.yaw = yaw;
    }
  }

  // lights — legacy `type`/`pos` → portable `kind`/`position`. Unknown kinds skip.
  if (Array.isArray(legacy.lights)) {
    const lights = [];
    for (const l of legacy.lights) {
      if (!l || typeof l !== 'object') continue;
      const kind = LIGHT_KIND[l.type];
      if (!kind) continue;
      const light = { kind };
      const color = (typeof l.color === 'string') ? l.color : undefined;
      if (color) light.color = color;
      const intensity = _num(l.intensity);
      if (intensity !== undefined) light.intensity = intensity;
      const pos = _legacyVec(l.pos);
      if (pos) light.position = pos;
      const dist = _num(l.distance);
      if (dist !== undefined && dist > 0) light.distance = dist;
      lights.push(light);
    }
    if (lights.length) world.lights = lights;
  }

  // objects — type-mapped; unmappable types are skipped silently.
  if (Array.isArray(legacy.objects)) {
    const objects = [];
    for (const o of legacy.objects) {
      if (!o || typeof o !== 'object') continue;
      const type = OBJECT_HINT[o.type];
      if (!type) continue;
      const obj = { type };
      const pos = _legacyVec(o.pos);
      if (pos) obj.position = pos;
      const rot = _num(o.rot);
      if (rot !== undefined) obj.rotation = [0, rot, 0];
      objects.push(obj);
    }
    if (objects.length) world.objects = objects;
  }

  // combat / bounds — passthrough (whitelisted + re-validated downstream).
  if (legacy.combat && typeof legacy.combat === 'object' && !Array.isArray(legacy.combat)) {
    world.combat = legacy.combat;
  }
  if (legacy.bounds && typeof legacy.bounds === 'object' && !Array.isArray(legacy.bounds)) {
    world.bounds = legacy.bounds;
  }

  // sea + foliage — the arena always has both (procedural ocean + instanced grass).
  world.sea = true;
  world.foliage = true;

  // sky — a bright clear day matches the arena's warm read (legacy Sky.js is code,
  // not config, so we pin a sensible portable equivalent).
  world.sky = { type: 'clear', color: '#87ceeb' };

  // Validate before returning — a serializer that emits an unrenderable manifest
  // must fail here (loud), not on the receiving node.
  const v = validateWorld(world);
  if (!v.ok) return fail((v.errors && v.errors[0]) || 'invalid-world');

  const manifestJson = JSON.stringify(world);
  if (!manifestJson) return fail('serialize-failed');

  return { ok: true, world: v.world, manifestJson };
}
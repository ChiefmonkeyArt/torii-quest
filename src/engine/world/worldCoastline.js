// src/engine/world/worldCoastline.js — Phase 0k.6 coastline-wall segment-set.
//
// The legacy knee-high fence (physics.js:175-190) follows fenceRing()'s 2
// arena-play polygon rings (660 + 529 points = 1189 segments). Baking 1189
// per-segment box OBJECTS into world.json would bloat the manifest; instead the
// bake tool (tools/bake-coastline-wall.mjs) precomputes every segment's
// midpoint [mx,mz], baked centre Y (sampleArenaHeight + half-height at authoring
// time — NO runtime terrain sampling), length + yaw into coastline-wall.json.
//
// This module:
//   • loadCoastlineWallData({ source, fetchImpl }) — async fetch + parse + validate.
//   • buildCoastlineWallColliders(data, { physicsWorld, Rapier }) — expand the
//     segment-set into N Rapier cuboid colliders (half-extents
//     [len/2, height/2, thickness/2], translation [mx, cy, mz], yaw quaternion).
//
// Fail-safe per buildWorldObjectColliders: a throw on ONE segment must NOT abort
// the rest. dispose() removes every collider + rigid body best-effort.

// Validate a parsed coastline-wall JSON. Returns { ok, data, errors }.
export function validateCoastlineData(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['coastline-wall: not an object'] };
  }
  const height = Number(raw.height);
  const thickness = Number(raw.thickness);
  const segments = raw.segments;
  if (!Number.isFinite(height) || height <= 0) errors.push('coastline-wall: height must be a positive number');
  if (!Number.isFinite(thickness) || thickness <= 0) errors.push('coastline-wall: thickness must be a positive number');
  if (!Array.isArray(segments) || segments.length === 0) {
    errors.push('coastline-wall: segments must be a non-empty array');
    return { ok: false, errors };
  }
  const clean = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!Array.isArray(s) || s.length < 5) { errors.push(`coastline-wall: segment[${i}] must be [mx,cy,mz,len,yaw]`); continue; }
    const mx = Number(s[0]), cy = Number(s[1]), mz = Number(s[2]), len = Number(s[3]), yaw = Number(s[4]);
    if (![mx, cy, mz, len, yaw].every(Number.isFinite)) { errors.push(`coastline-wall: segment[${i}] has non-finite values`); continue; }
    clean.push([mx, cy, mz, len, yaw]);
  }
  if (clean.length === 0) return { ok: false, errors };
  return { ok: errors.length === 0, errors, data: { height, thickness, segments: clean } };
}

// Async fetch + parse + validate. fetchImpl is injected (mirrors the terrain
// loader) so node tests pass a fake. Returns { ok, data, errors }.
export async function loadCoastlineWallData({ source, fetchImpl }) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, errors: ['coastline-wall: fetchImpl not provided'] };
  }
  let raw;
  try {
    const res = await fetchImpl(source);
    raw = typeof res === 'string' ? JSON.parse(res) : res;
  } catch (e) {
    return { ok: false, errors: [`coastline-wall: fetch/parse failed: ${e && e.message ? e.message : e}`] };
  }
  const v = validateCoastlineData(raw);
  if (!v.ok) return v;
  return { ok: true, data: v.data, errors: [] };
}

// Expand the validated segment-set into N Rapier cuboid colliders. Mirrors
// buildWorldObjectColliders's box branch: fixed rigid body at the segment
// centre, cuboid half-extents [len/2, height/2, thickness/2], yaw quaternion
// {x:0, y:sin(yaw/2), z:0, w:cos(yaw/2)}.
export function buildCoastlineWallColliders(data, { physicsWorld, Rapier }) {
  const pw = physicsWorld;
  const colliders = [];
  const bodies = [];
  if (!pw || !Rapier || !data || !Array.isArray(data.segments)) {
    return { colliders, bodies, dispose: () => {} };
  }
  const halfH = data.height / 2;
  const halfT = data.thickness / 2;
  for (const [mx, cy, mz, len, yaw] of data.segments) {
    let rb = null;
    try {
      const rbDesc = Rapier.RigidBodyDesc.fixed().setTranslation(mx, cy, mz);
      rb = pw.createRigidBody(rbDesc);
      if (!rb) continue;
      const halfLen = len / 2;
      const desc = Rapier.ColliderDesc.cuboid(halfLen, halfH, halfT);
      if (!desc) { try { pw.removeRigidBody(rb); } catch { /* best-effort */ } continue; }
      if (Number.isFinite(yaw) && yaw !== 0) {
        const sy = Math.sin(yaw / 2), cw = Math.cos(yaw / 2);
        try { desc.setRotation({ x: 0, y: sy, z: 0, w: cw }); } catch { /* best-effort */ }
      }
      const collider = pw.createCollider(desc, rb);
      colliders.push(collider);
      bodies.push(rb);
    } catch {
      // One bad segment must NOT abort the rest — mirror buildWorldObjectColliders.
      if (rb) { try { pw.removeRigidBody(rb); } catch { /* best-effort */ } }
    }
  }
  const dispose = () => {
    for (const c of colliders) { try { pw.removeCollider(c, true); } catch { /* best-effort */ } }
    for (const b of bodies) { try { pw.removeRigidBody(b); } catch { /* best-effort */ } }
  };
  return { colliders, bodies, dispose };
}

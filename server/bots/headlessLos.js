// server/bots/headlessLos.js — pure, headless line-of-sight for server bots.
//
// The single-player client resolves bot LOS with raycastService.lineOfSight
// (Rapier-backed). The server has NO Rapier world — importing raycast.js would
// silently return `true` (no world) and let bots shoot through every wall. So
// this module reimplements LOS as a pure 2D top-down segment-vs-AABB test over
// the static arena boxes (CRATES + OBSTACLES) at eye height.
//
// KNOWN, DOCUMENTED MP fidelity tradeoff (deferred, see chunk-2 spec §2): TERRAIN
// is NOT considered here. Server bots may shoot over gentle eye-height terrain
// undulations that the single-player client's full 3D ray would block. This is
// consistent across all MP clients (they all render from the same server state),
// so it never desyncs — it only differs from the local single-player feel.
//
// A box is treated as a blocker only when it rises above the LOS ray height
// (fullH > eyeY): shorter boxes can be shot over, matching intuition at EYE_Y.
//
// Node-pure: no THREE, no Rapier, no imports.

/**
 * Does the 2D segment (x0,z0)->(x1,z1) intersect the AABB footprint centred at
 * (cx,cz) with half-extents (hw,hd)? Liang–Barsky slab clip in the XZ plane.
 * Endpoints inside the box count as intersecting.
 */
export function segmentIntersectsAabb(x0, z0, x1, z1, cx, cz, hw, hd) {
  const minX = cx - hw, maxX = cx + hw;
  const minZ = cz - hd, maxZ = cz + hd;
  const dx = x1 - x0, dz = z1 - z0;

  let t0 = 0, t1 = 1;
  // Clip against each of the 4 slabs: p·t <= q.
  const edges = [
    [-dx, x0 - minX],
    [ dx, maxX - x0],
    [-dz, z0 - minZ],
    [ dz, maxZ - z0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel & outside this slab
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * Build a headless LOS function matching the botSim `losFn` dependency
 * signature: losFn(ax,ay,az,bx,by,bz, excludeCollider) -> bool (true = clear).
 *
 * @param {Array<[number,number,number,number,number]>} boxes  [cx,cz,hw,hd,fullH] rows
 * @param {number} eyeY  ray height used to gate which boxes count as blockers
 */
export function createHeadlessLos(boxes, eyeY) {
  // Precompute the subset of boxes tall enough to occlude at eye height.
  const blockers = boxes.filter((b) => b[4] > eyeY);
  return function lineOfSight(ax, _ay, az, bx, _by, bz /*, excludeCollider */) {
    for (const [cx, cz, hw, hd] of blockers) {
      if (segmentIntersectsAabb(ax, az, bx, bz, cx, cz, hw, hd)) return false;
    }
    return true;
  };
}

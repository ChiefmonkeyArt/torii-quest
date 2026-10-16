// src/gamezone/core/arenaWorld.js — the static arena as the simulation sees it.
//
// The legacy terrain predicates are exact but slow (~25 µs per height sample,
// ~22 µs per play-area test), and the old bot brain called them every tick for
// every bot — a steady drain on the server and a source of client hitches. This
// adapter samples them ONCE into a compact grid and answers everything from that
// grid in O(1). Cells fill LAZILY on first read (so the sim can start at once)
// and can also be warmed eagerly: synchronously on the server, in small time
// slices in the browser so the first frames never hitch. Lazy and eager fills
// produce identical values, so determinism does not depend on warm-up order.
//
// Read-only use of world modules: terrain/heightmap, terrain/tomoeShape, config.
// Node-pure.

import { CRATES, BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE_DECK_Y } from '../../config.js';
import { sampleArenaHeight } from '../../terrain/heightmap.js';
import { isArenaPlayArea, isArenaLand } from '../../terrain/tomoeShape.js';
import { SEA_LEVEL } from '../../terrain/seaConfig.js';
import { coastlineBounds } from '../../terrain/coastline.js';
import { rayAabb } from './geom.js';

const F_PLAY = 1;  // inside the combat zone (players can be shot here)
const F_WALK = 2;  // dry arena land a bot may stand on
const F_DONE = 4;  // cell sampled

const BR2_HL = BRIDGE2_LEN / 2, BR2_HW = BRIDGE2_WIDTH / 2;
function onBridge2(x, z) {
  return Math.abs(x - BRIDGE2_X) <= BR2_HL && Math.abs(z - BRIDGE2_Z) <= BR2_HW - 0.3;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.cell=0.5]  grid resolution in metres
 * @param {object} [opts.bounds]    {minX,maxX,minZ,maxZ}; defaults to the arena islands
 * @param {(x:number,z:number)=>number} [opts.heightFn]
 * @param {(x:number,z:number)=>boolean} [opts.playFn]
 * @param {(x:number,z:number)=>boolean} [opts.landFn]
 * @param {Array} [opts.crates]
 */
export function createArenaWorld(opts = {}) {
  const cell = opts.cell || 0.5;
  const cb = coastlineBounds();
  const b = opts.bounds || { minX: Math.floor(cb.minX) - 1, maxX: Math.ceil(cb.maxX) + 1, minZ: Math.floor(cb.minZ) - 1, maxZ: Math.ceil(cb.maxZ) + 1 };
  const heightFn = opts.heightFn || sampleArenaHeight;
  const playFn = opts.playFn || isArenaPlayArea;
  const landFn = opts.landFn || isArenaLand;
  const cols = Math.ceil((b.maxX - b.minX) / cell) + 1;
  const rows = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
  const H = new Float32Array(cols * rows);
  const FL = new Uint8Array(cols * rows);
  let built = 0;
  const total = cols * rows;

  // Crates rest on the terrain (mirrors physics.js); only those inside the zone.
  const boxes = [];
  for (const [cx, cz, hw, hd, h] of (opts.crates || CRATES)) {
    if (!playFn(cx, cz)) continue;
    const y0 = heightFn(cx, cz);
    boxes.push(Object.freeze({ minX: cx - hw, minY: y0, minZ: cz - hd, maxX: cx + hw, maxY: y0 + h, maxZ: cz + hd }));
  }

  function _fill(i) {
    const c = (i / rows) | 0, r = i - c * rows;
    const x = b.minX + c * cell, z = b.minZ + r * cell;
    const play = playFn(x, z);
    const h = heightFn(x, z);
    H[i] = h;
    let f = play ? F_PLAY : 0;
    if (play && landFn(x, z) && h > SEA_LEVEL + 0.15) f |= F_WALK;
    if (onBridge2(x, z)) f |= F_WALK | F_PLAY;
    for (const bx of boxes) {
      if (x > bx.minX - 0.4 && x < bx.maxX + 0.4 && z > bx.minZ - 0.4 && z < bx.maxZ + 0.4) { f &= ~F_WALK; break; }
    }
    FL[i] = f | F_DONE;
    filled++;
  }
  let filled = 0;
  const _at = (i) => { if ((FL[i] & F_DONE) === 0) _fill(i); return i; };

  /** Warm up to `budgetMs` of grid. Returns true once every cell is sampled. */
  function build(budgetMs = Infinity, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const t0 = now();
    let n = 0;
    while (built < total) {
      if ((FL[built] & F_DONE) === 0) _fill(built);
      built++;
      if ((++n & 63) === 0 && now() - t0 > budgetMs) break;
    }
    return built >= total;
  }

  function _idx(x, z) {
    const c = Math.round((x - b.minX) / cell), r = Math.round((z - b.minZ) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return c * rows + r;
  }

  function terrainY(x, z) {
    const fx = (x - b.minX) / cell, fz = (z - b.minZ) / cell;
    let c = Math.floor(fx), r = Math.floor(fz);
    if (c < 0 || r < 0 || c >= cols - 1 || r >= rows - 1) return SEA_LEVEL;
    const tx = fx - c, tz = fz - r;
    const i00 = c * rows + r, i10 = i00 + rows;
    if (filled < total) { _at(i00); _at(i00 + 1); _at(i10); _at(i10 + 1); }
    const h0 = H[i00] * (1 - tz) + H[i00 + 1] * tz;
    const h1 = H[i10] * (1 - tz) + H[i10 + 1] * tz;
    return h0 * (1 - tx) + h1 * tx;
  }

  function footY(x, z) {
    const t = terrainY(x, z);
    return onBridge2(x, z) ? Math.max(t, BRIDGE_DECK_Y) : t;
  }

  function inPlay(x, z) { const i = _idx(x, z); return i >= 0 && (FL[_at(i)] & F_PLAY) !== 0; }
  function walkable(x, z) { const i = _idx(x, z); return i >= 0 && (FL[_at(i)] & F_WALK) !== 0; }

  /**
   * Distance along a unit ray to the first static occluder (crate or terrain),
   * capped at maxT. Terrain is marched in 0.4 m steps on the cached grid.
   */
  function occlusionT(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    for (const bx of boxes) {
      const t = rayAabb(ox, oy, oz, dx, dy, dz, bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY, bx.maxZ);
      if (t >= 0 && t < best) best = t;
    }
    const step = 0.4;
    for (let t = step; t < best; t += step) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < footY(x, z) - 0.05) { best = Math.max(0, t - step * 0.5); break; }
    }
    return best;
  }

  function lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    return occlusionT(ax, ay, az, dx / L, dy / L, dz / L, L) >= L - 0.05;
  }

  function randomWalkable(rng, tries = 200) {
    for (let k = 0; k < tries; k++) {
      const x = b.minX + rng() * (b.maxX - b.minX);
      const z = b.minZ + rng() * (b.maxZ - b.minZ);
      if (walkable(x, z)) return { x, z };
    }
    return { x: -10, z: -8 };
  }

  return Object.freeze({
    cell, bounds: b, boxes,
    // `ready`: usable now (lazy fill). `complete`: every cell sampled (warm).
    build, get ready() { return true; }, get complete() { return filled >= total; }, get progress() { return filled / total; },
    terrainY, footY, inPlay, walkable, occlusionT, lineOfSight, randomWalkable,
  });
}

/** Build-and-cache the default arena world (server / tests). */
let _shared = null;
export function sharedArenaWorld() {
  if (!_shared) { _shared = createArenaWorld(); _shared.build(); }
  return _shared;
}

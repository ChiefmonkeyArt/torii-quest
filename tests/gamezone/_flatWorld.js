// tests/gamezone/_flatWorld.js — a controllable stand-in for the arena world:
// flat ground at y=0, everything walkable/in play, optional wall at x = wallX.
export function flatWorld({ wallX = null, spawn = null, outOfPlay = null } = {}) {
  let k = 0;
  return {
    ready: true,
    complete: true,
    footY: () => 0,
    terrainY: () => 0,
    inPlay: (x, z) => !(outOfPlay && outOfPlay(x, z)),
    walkable: () => true,
    occlusionT(ox, oy, oz, dx, dy, dz, maxT) {
      if (wallX == null || Math.abs(dx) < 1e-9) return maxT;
      const t = (wallX - ox) / dx;
      return t > 0 && t < maxT ? t : maxT;
    },
    lineOfSight(ax, ay, az, bx) {
      if (wallX == null) return true;
      return (ax - wallX) * (bx - wallX) > 0;
    },
    randomWalkable() {
      if (spawn) return spawn(k++);
      k++;
      return { x: 20 + k * 6, z: 0 };
    },
  };
}

// tests/gamezone/world.test.js — the arena grid the sim reads (ADR-0130).
// Lazy (fill-on-read) and eager (warmed) grids must be indistinguishable, so the
// browser can start the sim on frame one without changing any outcome.
import { describe, it, expect } from 'vitest';
import { createArenaWorld, sharedArenaWorld } from '../../src/gamezone/core/arenaWorld.js';
import { createGameZoneSim } from '../../src/gamezone/core/sim.js';
import { createRng } from '../../src/gamezone/core/geom.js';
import { PLAYER_EYE } from '../../src/gamezone/core/constants.js';

describe('arena world grid', () => {
  const eager = sharedArenaWorld();

  it('the shared (server) world is fully warmed', () => {
    expect(eager.complete).toBe(true);
    expect(eager.progress).toBe(1);
  });

  it('a lazy world is usable immediately and answers exactly like the warmed one', () => {
    const lazy = createArenaWorld();
    expect(lazy.ready).toBe(true);
    expect(lazy.complete).toBe(false);
    const rng = createRng(3);
    const { minX, maxX, minZ, maxZ } = eager.bounds;
    for (let k = 0; k < 1500; k++) {
      const x = minX + rng() * (maxX - minX), z = minZ + rng() * (maxZ - minZ);
      expect(lazy.footY(x, z)).toBe(eager.footY(x, z));
      expect(lazy.inPlay(x, z)).toBe(eager.inPlay(x, z));
      expect(lazy.walkable(x, z)).toBe(eager.walkable(x, z));
    }
    expect(lazy.progress).toBeGreaterThan(0);
    expect(lazy.progress).toBeLessThan(0.5);
  });

  it('time-sliced warm-up completes and never re-samples a filled cell', () => {
    const w = createArenaWorld();
    w.walkable(0, 0);
    let slices = 0;
    while (!w.build(5)) slices++;
    expect(slices).toBeGreaterThan(1);
    expect(w.complete).toBe(true);
    expect(w.progress).toBe(1);
  });

  it('same seed on a lazy vs warmed world ⇒ identical simulation', () => {
    const run = (world) => {
      const sim = createGameZoneSim({ world, seed: 21 });
      sim.addPlayer('p', { pos: [-10, PLAYER_EYE + 2, -8] });
      const out = [];
      for (let i = 0; i < 120; i++) { sim.step(); if (i % 30 === 0) out.push(JSON.stringify(sim.snapshot())); }
      return out;
    };
    expect(run(createArenaWorld())).toEqual(run(eager));
  });

  it('crates and terrain occlude; open air does not', () => {
    const [box] = eager.boxes;
    expect(box).toBeTruthy();
    const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2, cy = (box.minY + box.maxY) / 2;
    const t = eager.occlusionT(cx - 10, cy, cz, 1, 0, 0, 50);
    expect(t).toBeLessThan(10);
    expect(eager.occlusionT(cx, 200, cz, 0, 1, 0, 50)).toBe(50);
    expect(eager.lineOfSight(cx - 10, cy, cz, cx + 10, cy, cz)).toBe(false);
  });
});

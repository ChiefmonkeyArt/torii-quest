// v0.2.937 — grass reuse between islands. The blade layout depends only on the fixed
// island heightmap and crate/tree constants, so an in-place swap PARKS the grass and
// the next island re-adds the same mesh with the destination's colours, instead of
// regenerating ~75k blades (~7 s of CPU on a typical device).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const fakeScene = new THREE.Scene();
vi.mock('../../src/scene.js', () => ({ scene: fakeScene }));

let F;
beforeAll(async () => {
  globalThis.window = globalThis.window || globalThis;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  F = await import('../../src/arena-foliage.js');
});

const grassIn = (s) => s.children.filter((c) => c.name === 'grass-instanced');

describe('grass reuse (v0.2.937)', () => {
  it('parks on swap and re-adds the SAME mesh with the new colours, no rebuild', async () => {
    await F.buildFoliage();
    const first = grassIn(fakeScene);
    expect(first.length).toBe(1);
    const mesh = first[0];
    const geo = mesh.geometry;

    F.parkFoliage();
    expect(grassIn(fakeScene).length).toBe(0);      // nothing layers over the next world
    expect(F.getGrassMat()).toBeNull();               // no wind tick while parked

    F.setGrassColor({ napBase: [0.9, 0.1, 0.1], napTip: [1, 0.2, 0.2], arenaBase: [0.1, 0.1, 0.9], arenaTip: [0.2, 0.2, 1] });
    const before = F.getGrassReuseCount();
    const progress = [];
    const t0 = Date.now();
    await F.buildFoliage((p) => progress.push(p));
    const ms = Date.now() - t0;

    const again = grassIn(fakeScene);
    expect(again.length).toBe(1);
    expect(again[0]).toBe(mesh);                      // same object
    expect(again[0].geometry).toBe(geo);              // same blades, not regenerated
    expect(F.getGrassReuseCount()).toBe(before + 1);
    expect(progress).toEqual([1]);
    expect(ms).toBeLessThan(50);
    const u = F.getGrassMat().uniforms;               // destination colours applied
    expect(u.uNapBase.value.r).toBeCloseTo(0.9);
    expect(u.uArenaTip.value.b).toBeCloseTo(1);
  }, 60000);

  it('park is idempotent and dispose frees the parked grass for good', async () => {
    F.parkFoliage(); F.parkFoliage();
    expect(grassIn(fakeScene).length).toBe(0);
    F.disposeFoliage();
    const before = F.getGrassReuseCount();
    await F.buildFoliage();                            // a fresh build, not a reuse
    expect(F.getGrassReuseCount()).toBe(before);
    expect(grassIn(fakeScene).length).toBe(1);
  }, 60000);

  it('a mirror scene never takes the parked home grass', async () => {
    F.parkFoliage();
    const mirror = new THREE.Scene();
    const before = F.getGrassReuseCount();
    await F.buildFoliage(undefined, mirror);
    expect(F.getGrassReuseCount()).toBe(before);
    expect(grassIn(mirror).length).toBe(1);
    await F.buildFoliage();                            // home still gets its parked mesh
    expect(F.getGrassReuseCount()).toBe(before + 1);
  }, 60000);

  it('the in-place swap parks (never disposes) the grass', () => {
    const src = readFileSync(new URL('../../src/arenaRuntime.js', import.meta.url), 'utf8');
    expect(src).toMatch(/try \{ parkFoliage\(\); \} catch/);
    expect(src).not.toMatch(/disposeFoliage\(\)/);
  });
});

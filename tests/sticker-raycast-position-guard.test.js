// tests/sticker-raycast-position-guard.test.js — regression lock for the
// "stickers not working" raycast crash (v0.2.753-alpha).
//
// Bug: firing a sticker in the NAP zone threw, on every shot:
//
//   Uncaught TypeError: Cannot read properties of undefined (reading 'getX')
//       at Vector3.fromBufferAttribute
//       at Mesh.getVertexPosition
//       ...
//       at Raycaster.intersectObjects   ← stickerNpc._raycastScene
//       at fireStickerAtNpc             ← arenaRuntime EV.SHOOT (NAP)
//
// Root cause: `_raycastScene` raycasts every Mesh in the scene via
// `_raycaster.intersectObjects(meshes)`. Three.js r184's `Mesh.raycast` calls
// `getVertexPosition()` → `fromBufferAttribute(geometry.attributes.position)`,
// and when a mesh's geometry has NO `position` attribute the call throws
// `reading 'getX'`. That exception aborted `fireStickerAtNpc` before a sticker
// could be placed, so firing appeared to do "nothing at all".
//
// Fix (two layers):
//   1. `_getMeshes()` now SKIPS any mesh whose geometry lacks a `position`
//      attribute (and warns once per offender so the culprit is named), so a
//      broken mesh never enters the raycast list.
//   2. `_raycastScene()` wraps both `intersectObjects` calls in try/catch, so a
//      mesh disposed/rebuilt between 2s cache refills can never sink a fire.
//
// stickerNpc.js is THREE/Rapier-bound (not unit-importable), so — consistent
// with tests/sticker-self-view-center.test.js — this locks the fix at the source
// level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/stickerNpc.js', import.meta.url), 'utf8');

describe('stickerNpc raycast — position-attribute guard', () => {
  it('skips meshes whose geometry has no position attribute', () => {
    // The traverse guard must check the attribute before caching the mesh.
    expect(SRC).toMatch(/!geo\s*\|\|\s*!geo\.attributes\s*\|\|\s*!geo\.attributes\.position/);
  });

  it('warns once per offender instead of spamming every cache refill', () => {
    expect(SRC).toContain('_warnedPositionless');
    expect(SRC).toContain('console.warn');
    expect(SRC).toContain('skipping raycast of mesh without a position attribute');
  });

  it('wraps the static intersectObjects call in try/catch', () => {
    // `let staticHits = []` followed by a guarded intersectObjects ensures a
    // stale broken mesh cannot throw through the whole fire.
    expect(SRC).toMatch(/staticHits\s*=\s*_raycaster\.intersectObjects\(meshes,\s*false\)/);
    expect(SRC).toContain("[sticker] static mesh raycast failed (skipping)");
  });

  it('wraps the instanced intersectObjects call in try/catch', () => {
    expect(SRC).toMatch(/instHits\s*=\s*_raycaster\.intersectObjects\(instanced,\s*false\)/);
    expect(SRC).toContain("[sticker] instanced mesh raycast failed (skipping)");
  });
});
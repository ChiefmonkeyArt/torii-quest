// tests/sticker-baked-decal-material.test.js — regression lock for the
// "baked decal invisible / stickers don't stick" bug (v0.2.756-alpha).
//
// Bug: with the Force-Plane toggle OFF, baked (DecalGeometry) stickers landed
// invisibly — the user saw nothing stick; only the plane fallback rendered.
//
// Root cause: the baked decal material used the default FrontSide culling.
// DecalGeometry clips vertices in WORLD space and the result is parented to the
// hit mesh with a pre-inverted quaternion, so the triangle winding is not
// guaranteed to face the camera. Back-facing triangles were culled → the decal
// rendered nothing. The plane path already used DoubleSide, which is why only
// the plane mode was visible.
//
// Fix: the baked material is now built by exported createBakedDecalMaterial(),
// which sets side: THREE.DoubleSide (matching the plane path), so the decal is
// visible regardless of winding.
//
// stickerNpc.js is THREE/Rapier-bound (not unit-importable without a DOM), so —
// consistent with tests/sticker-raycast-position-guard.test.js — this locks the
// fix at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/stickerNpc.js', import.meta.url), 'utf8');

describe('stickerNpc baked decal material — DoubleSide fix', () => {
  it('creates the baked material via an exported helper', () => {
    expect(SRC).toMatch(/export\s+function\s+createBakedDecalMaterial/);
  });

  it('sets DoubleSide on the baked decal material (the invisibility fix)', () => {
    // The helper's material config must include side: THREE.DoubleSide.
    const helper = SRC.slice(SRC.indexOf('createBakedDecalMaterial'));
    expect(SRC).toMatch(/side:\s*THREE\.DoubleSide/);
    expect(helper).toMatch(/side:\s*THREE\.DoubleSide/);
  });

  it('uses the helper for the baked landing path (not an inline FrontSide material)', () => {
    // The baked branch must call the helper instead of inlining a material
    // without DoubleSide.
    expect(SRC).toMatch(/const\s+decalMat\s*=\s*createBakedDecalMaterial\(_texture\)/);
  });

  it('keeps the decal depth-tested but non-writing (overlay behaviour)', () => {
    expect(SRC).toMatch(/depthTest:\s*true/);
    expect(SRC).toMatch(/depthWrite:\s*false/);
  });
});
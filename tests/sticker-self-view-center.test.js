// tests/sticker-self-view-center.test.js — regression lock for the P-key
// self-view orbit centre (v0.2.752-alpha).
//
// Bug: pressing P dropped the orbit camera beneath the terrain/grass. The old
// `_characterCenter` computed the centre as `mesh.getWorldPosition().y` plus
// `(geometry.boundingBox.max.y - geometry.boundingBox.min.y) * 0.5` — the
// LOCAL bind-pose height. For a Z-up GLB the local Y span is the character's
// DEPTH, not its height; for a Blender/Armature-scaled rig the local box is
// metre/unscaled and mis-axes the centre; and it read the bounding box without
// ever recomputing it. The result was a centre at (or under) ground level, so
// the orbit camera looked up from inside the terrain.
//
// Fix: the centre now comes from the SKELETON's torso bones (hips/spine),
// whose WORLD positions track both the animated pose and the player's world
// transform exactly — immune to the bind-pose box axis/scale gotchas above.
//
// stickerSelfView.js is THREE-bound (not unit-importable), so — consistent
// with tests/self-view-layer-guard.test.js — this locks the fix at the source
// level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/stickerSelfView.js', import.meta.url), 'utf8');

describe('stickerSelfView._characterCenter — skeleton-bone centre, not bind-pose box', () => {
  it('derives the centre from skeleton torso bones (hips/spine)', () => {
    expect(SRC).toContain('getBoneByName');
    expect(SRC).toMatch(/Spine1|Spine/);
    expect(SRC).toMatch(/Hips/);
  });

  it('reads the bone WORLD position (tracks pose + player transform)', () => {
    expect(SRC).toMatch(/bone\.updateWorldMatrix\(true,\s*false\)/);
    expect(SRC).toMatch(/bone\.getWorldPosition\(out\)/);
  });

  it('does NOT compute the centre from geometry.boundingBox height', () => {
    // The exact fragile pattern this locks against: a local-bind-pose Y span.
    expect(SRC).not.toMatch(/boundingBox\.max\.y\s*-\s*boundingBox\.min\.y/);
    expect(SRC).not.toMatch(/bb\.max\.y\s*-\s*bb\.min\.y/);
  });

  it('keeps a safe fallback for an unrigged / bone-less mesh', () => {
    expect(SRC).toMatch(/updateWorldMatrix\(true\)/);
    expect(SRC).toContain('out.y += 0.9');
  });
});
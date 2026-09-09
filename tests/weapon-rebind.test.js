// tests/weapon-rebind.test.js — world-gun re-attach on body reload (v0.2.801-alpha).
//
// The mirror world gun is cloned once into a normalizer group parented to the
// player body's RightHand bone. On login / character swap the body is removed
// and a fresh one loads with a NEW RightHand bone; if the gun stays parented to
// the old (now-removed) bone it silently vanishes from the mirror. This locks
// the fix: setRightHandBone must DETACH any prior gun (remove its normalizer
// wrapper from the old bone) and re-attach to the new bone, while remaining a
// no-op for the same bone + already-attached gun.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/weapons.js'), 'utf8');

// Isolate the setRightHandBone export body for assertions.
function setRightHandBoneBody() {
  const m = SRC.match(/export function setRightHandBone\(bone\)\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error('setRightHandBone not found in weapons.js');
  return m[1];
}

describe('world gun re-attach (v0.2.801)', () => {
  it('detaches the prior gun before re-attaching to a new bone', () => {
    const body = setRightHandBoneBody();
    // Remove the normalizer wrapper (the gun's parent) from its old bone.
    expect(body).toMatch(/wrap\.parent\.remove\(wrap\)/);
    // Clear the stale gun so the re-attach guard re-arms.
    expect(body).toMatch(/_worldGun = null/);
  });

  it('re-attaches to the new bone when a gun source exists', () => {
    const body = setRightHandBoneBody();
    expect(body).toMatch(/_rightHandBone = bone/);
    expect(body).toMatch(/_worldGunSrc && !_worldGun/);
    expect(body).toMatch(/_attachWorldGun\(\)/);
  });

  it('is idempotent for the same bone + already-attached gun', () => {
    const body = setRightHandBoneBody();
    expect(body).toMatch(/bone === _rightHandBone && _worldGun/);
  });
});
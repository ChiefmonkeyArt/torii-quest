// tests/v0.2.772-regression.test.js — locks the two playtest regressions fixed
// in v0.2.772-alpha:
//   Bug D — "no feet visible when looking down": the FP-body neck-clip plane
//           now anchors to the PARENT rig world Y (not the camera), so pitch
//           does not raise the slice above the feet.
//   Bug E — per-character POV: the FP camera Y is nudged down by
//           getCharacterEyeOffset() so shorter characters (poo poo head) get a
//           lower eye. Physics EYE (engine/entities/player.js) is unchanged.
//
// Static source contract, matching the v0.2.768 lockdown style — cheap enough
// to run in CI without a WebGL/DOM harness.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPBODY = readFileSync(join(ROOT, 'src/firstPersonBody.js'), 'utf8');
const PLAYER = readFileSync(join(ROOT, 'src/player.js'), 'utf8');
const PLAYER_ENGINE = readFileSync(join(ROOT, 'src/engine/entities/player.js'), 'utf8');

describe('v0.2.772 — Bug D: feet stay visible when looking straight down', () => {
  it('firstPersonBody pins the neck-clip constant to the PARENT rig Y, not camera Y', () => {
    // Parent-anchored: reads _root.parent world position and adds EYE - NECK_CLIP_DROP.
    expect(FPBODY).toMatch(/_root\.parent\.getWorldPosition\(\s*_pp\s*\)/);
    expect(FPBODY).toMatch(/_clipPlane\.constant\s*=\s*_pp\.y\s*\+\s*\(\s*EYE\s*-\s*NECK_CLIP_DROP\s*\)/);
  });

  it('the previous camera-Y anchor only remains as an unparented-transient fallback', () => {
    // The camera-Y assignment is inside an `else` branch, not the primary path.
    const idxParent = FPBODY.indexOf('_root.parent.getWorldPosition');
    const idxCam    = FPBODY.indexOf('camera.getWorldPosition(_wp);\n    _clipPlane.constant = _wp.y - NECK_CLIP_DROP;');
    expect(idxParent).toBeGreaterThan(-1);
    expect(idxCam).toBeGreaterThan(idxParent); // fallback is written AFTER the primary
    // And that fallback is inside an `else` branch, not a top-level statement.
    const between = FPBODY.slice(idxParent, idxCam);
    expect(between).toMatch(/\}\s*else\s*\{/);
  });

  it('NECK_CLIP_DROP is unchanged (0.32 m)', () => {
    expect(FPBODY).toMatch(/const\s+NECK_CLIP_DROP\s*=\s*0\.32/);
  });
});

describe('v0.2.772 — Bug E: per-character POV eye height', () => {
  it('firstPersonBody exports getCharacterEyeOffset', () => {
    expect(FPBODY).toMatch(/export\s+function\s+getCharacterEyeOffset\(\)/);
  });

  it('the offset is clamped: never above EYE, never below MIN_CHARACTER_EYE', () => {
    // Clamp uses BOTH Math.min(EYE, …) and Math.max(MIN_CHARACTER_EYE, …).
    expect(FPBODY).toMatch(/Math\.max\(\s*MIN_CHARACTER_EYE\s*,\s*Math\.min\(\s*EYE\s*,/);
    expect(FPBODY).toMatch(/const\s+MIN_CHARACTER_EYE\s*=/);
  });

  it('the offset is character-scoped: reset to 0 on hot-swap', () => {
    // Load path resets _characterEyeOffset before the async loader fires so that
    // hot-swapping from poo poo head → chiefmonkey does not stick at the shorter eye.
    expect(FPBODY).toMatch(/_characterEyeOffset\s*=\s*0/);
  });

  it('player.js applies the offset to the local camera Y (only)', () => {
    expect(PLAYER).toMatch(/import\s*\{\s*getCharacterEyeOffset\s*\}\s*from\s*'\.\/firstPersonBody\.js'/);
    expect(PLAYER).toMatch(/camera\.position\.y\s*=\s*lookDownEyeY\(pitch\)\s*\+\s*getCharacterEyeOffset\(\)/);
  });

  it('physics EYE constant is UNCHANGED (bots aim at true eye)', () => {
    // The canonical eye height stays 1.7 m — spawn/body/respawn geometry rely on this.
    expect(PLAYER_ENGINE).toMatch(/export\s+const\s+EYE\s*=\s*1\.7/);
  });
});

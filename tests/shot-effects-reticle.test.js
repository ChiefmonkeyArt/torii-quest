// tests/shot-effects-reticle.test.js — locks audit F02 (combat shots applied
// recoil + sound twice) and F03 (reticle ray used the camera's LOCAL quaternion
// instead of its world direction). Both live in THREE-bound runtime modules, so
// — consistent with the stickerNpc position-guard test — they are source-locked
// rather than imported.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARENA = readFileSync(new URL('../src/arenaRuntime.js', import.meta.url), 'utf8');
const RETICLE = readFileSync(new URL('../src/targetReticle.js', import.meta.url), 'utf8');

describe('arenaRuntime — F02 shot effects fire exactly once', () => {
  it('triggerRecoil() and playShoot() each appear exactly once across the file', () => {
    // F02: the SHOOT handler called both on entry AND again on the combat branch,
    // producing two recoil calls, two sound calls and one bullet. After the fix
    // there must be exactly one call site each (the shared pair at handler top).
    expect((ARENA.match(/triggerRecoil\(\)/g) || []).length).toBe(1);
    expect((ARENA.match(/playShoot\(\)/g) || []).length).toBe(1);
  });
});

describe('targetReticle — F03 reticle ray uses the camera world direction', () => {
  it('derives aim from camera.getWorldDirection, not the local quaternion', () => {
    expect(RETICLE).toMatch(/camera\.getWorldDirection\(_camDir\)/);
    // The old local-tilt transform (which ignored the player-parent yaw) is gone.
    expect(RETICLE).not.toMatch(/set\(0,\s*0,\s*-1\)\s*\.applyQuaternion\(camera\.quaternion\)/);
  });
});
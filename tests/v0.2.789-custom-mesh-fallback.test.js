// tests/v0.2.789-custom-mesh-fallback.test.js — source-lock for the
// v0.2.789 fix that makes loadPlayerModel() fall back to the built-in default
// character when a custom (kind-35100) mesh URL fails to load.
//
// Root cause of "can't enter the world after login" (v0.2.788 and earlier):
//   The player's signed kind-35100 character referenced a Blossom mesh whose
//   blob was never uploaded, so resolveCharacterMeshUrl() produced a URL that
//   returned 404. loadPlayerModel() did `await loader.loadAsync(customUrl)`
//   with no fallback and re-threw in its catch block, so `_arena.boot()` →
//   `ensureArenaReady()` failed and the ENTER button showed "Arena failed to
//   load …", blocking world entry entirely for that identity.
//
// Fix (src/playerModel.js, no new architecture):
//   1. Try the custom mesh URL first; on ANY load error, log + fall through.
//   2. Fall back to the built-in default (assetUrl(char.file)) — the avatar
//      the player always had — instead of throwing.
//   3. Track `usedCustomMesh` so the runtime animation-retarget branch (which
//      is only correct for an actually-loaded arbitrary rig) does NOT run for
//      the fallback mesh (built-ins carry their own baked clips).
//
// playerModel.js is a heavy three.js module (GLTFLoader/DRACOLoader imports),
// so — consistent with the sibling heartbeat source-lock tests — this locks
// the fix at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/playerModel.js', import.meta.url), 'utf8');

describe('v0.2.789 — loadPlayerModel falls back to the default on custom-mesh failure', () => {
  it('declares a usedCustomMesh flag to track which source actually loaded', () => {
    expect(SRC).toContain('let usedCustomMesh = false;');
  });

  it('wraps the custom mesh load in try/catch instead of letting it throw', () => {
    // The custom URL load must never abort boot — a catch logs and falls through.
    expect(SRC).toMatch(/try\s*\{\s*gltf\s*=\s*await\s*_loader\.loadAsync\(_customMeshUrl\);[^}]+usedCustomMesh\s*=\s*true;[^}]*\}\s*catch\s*\(err\)\s*\{/);
  });

  it('falls back to the built-in default (assetUrl(char.file)) when custom did not load', () => {
    expect(SRC).toMatch(/if\s*\(!usedCustomMesh\)\s*\{\s*gltf\s*=\s*await\s*_loader\.loadAsync\(assetUrl\(char\.file\)\);\s*\}/);
  });

  it('gates the runtime retarget branch on usedCustomMesh, not _customMeshUrl', () => {
    // Only an actually-loaded arbitrary rig should get the animation-library
    // retarget; a fallback built-in mesh must use its own baked clips.
    expect(SRC).toMatch(/if\s*\(usedCustomMesh\)\s*\{\s*try\s*\{\s*const library\s*=\s*await loadAnimationLibrary\(_loader\);/);
  });

  it('still treats a default-mesh failure as a real error (re-throw preserved)', () => {
    // The fallback path is the only graceful leg; a bundled default failing is
    // still surfaced so it is not silently swallowed.
    expect(SRC).toMatch(/console\.warn\('\[playerModel\] load failed:', err\);\s*throw err;/);
  });
});
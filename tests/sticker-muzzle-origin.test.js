// tests/sticker-muzzle-origin.test.js — regression lock for two sticker-firing
// fixes (v0.2.754-alpha):
//
//   1. Stickers must visibly leave the GUN muzzle, not the player's face (the
//      camera origin). The old call `fireStickerAtNpc(aim, ad)` passed the AIM
//      (camera) origin as both the ray origin AND the sprite spawn point, so the
//      sticker popped out of the player's head. Now `fireStickerAtNpc(origin,
//      dir, spawnOrigin)` targets along the aim ray but spawns at the gun
//      muzzle, matching how bullets (`spawnBullet(origin, dir)`) work.
//
//   2. The FTFF texture must PRELOAD on arena entry, not on the first fire. The
//      old code only called `_preloadTexture()` inside `fireStickerAtNpc`, so
//      the opening shots showed the pink `0xff00ff` fallback while the PNG was
//      still streaming. Now `tickStickerNpc()` preloads on the first tick.
//
// Both files are THREE-bound (not unit-importable), so — consistent with the
// other sticker tests — this locks the fixes at the source level.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const NPC = readFileSync(new URL('../src/stickerNpc.js', import.meta.url), 'utf8');
const RT = readFileSync(new URL('../src/arenaRuntime.js', import.meta.url), 'utf8');

describe('sticker fires from the gun muzzle, not the face', () => {
  it('accepts a separate spawnOrigin argument', () => {
    expect(NPC).toMatch(/export function fireStickerAtNpc\(origin,\s*dir,\s*spawnOrigin\)/);
  });

  it('spawns the sprite at spawnOrigin (falling back to origin)', () => {
    expect(NPC).toMatch(/const spawnPoint = spawnOrigin \|\| origin/);
    expect(NPC).toMatch(/sprite\.position\.copy\(spawnPoint\)/);
    expect(NPC).toMatch(/from: spawnPoint\.clone\(\)/);
  });

  it('passes the gun muzzle as spawnOrigin in the NAP fire path', () => {
    expect(RT).toMatch(/fireStickerAtNpc\(aim,\s*ad,\s*origin\)/);
  });
});

describe('FTFF sticker texture preloads before the first shot', () => {
  it('preloads on tickStickerNpc, not only on fire', () => {
    // The tick function must call _preloadTexture() so the texture streams in on
    // arena entry (and fireStickerAtNpc must still call it as a lazy backstop).
    const tick = NPC.slice(NPC.indexOf('export function tickStickerNpc'));
    expect(tick).toContain('_preloadTexture()');
  });

  it('keeps the pink fallback only for the not-yet-loaded state', () => {
    expect(NPC).toContain("color: _texture ? 0xffffff : 0xff00ff");
  });
});
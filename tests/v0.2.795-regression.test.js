// tests/v0.2.795-regression.test.js — character-settings perf + stickers
// decoupling.
//
// Part 1 (perf): fetchOwnCharacter now short-circuits through an in-memory TTL
// cache so the login-time mesh check and a Character-tab open within ~60s share
// one relay fan-out (each fan-out is otherwise a full parallel relay read).
// publishCharacter busts that cache on a successful publish so a fresh
// character is never masked by a still-warm stale entry.
//
// Part 2 (stickers): stickers were removed from the Character Forge tab and
// given their own Settings tab (renderStickerPanel). The old inline sticker
// editor (edit-character / add-sticker / remove-sticker) is gone from both the
// panel renderer and main.js's delegated handlers.
//
// Source-locking keeps src/nostr.js, src/main.js, and the panel modules honest
// without importing the entry module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOSTR = readFileSync(join(ROOT, 'src', 'nostr.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');
const FORGE = readFileSync(join(ROOT, 'src', 'engine', 'settings', 'characterForgePanel.js'), 'utf8');

describe('v0.2.795 — character-manifest cache', () => {
  it('defines a module-level character cache + TTL', () => {
    expect(NOSTR).toMatch(/const CHARACTER_CACHE = new Map\(\)/);
    expect(NOSTR).toMatch(/CHARACTER_CACHE_TTL_MS\s*=\s*60 \* 1000/);
  });

  it('fetchOwnCharacter serves a warm entry without re-querying', () => {
    expect(NOSTR).toContain('hit.expiresAt > nowMs) return hit.value');
  });

  it('fetchOwnCharacter caches the resolved result after a read', () => {
    expect(NOSTR).toContain('cache.set(pk, { value: result, expiresAt: nowMs + ttlMs })');
  });

  it('publishCharacter busts the cache on a successful publish', () => {
    expect(NOSTR).toContain('else CHARACTER_CACHE.clear()');
  });
});

describe('v0.2.795 — stickers decoupled from the character tab', () => {
  it('registers a dedicated stickers settings-tab renderer', () => {
    expect(MAIN).toContain("registerSettingsTabRenderer('stickers'");
    expect(MAIN).toContain('renderStickerPanel({');
  });

  it('drops the inline sticker editor from the Character Forge panel', () => {
    expect(FORGE).not.toContain('_stickerEditor');
    expect(FORGE).not.toContain('add-sticker');
    expect(FORGE).not.toContain('edit-character');
  });

  it('removes the sticker action handlers from main.js', () => {
    expect(MAIN).not.toContain("action === 'edit-character'");
    expect(MAIN).not.toContain("action === 'add-sticker'");
    expect(MAIN).not.toContain('_removeOwnSticker');
  });
});
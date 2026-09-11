// tests/dead-code-removal.test.js — audit F09 + F10: remove only PROVEN local
// dead code while retaining the authoritative behaviour it used to shadow.
//
// F10 (playerStats): the left-panel stats module rendered into `big-*`/donut/
// legend IDs that were deleted from index.html, and its lifetime exports had no
// callers. The authoritative SCORE-frame persistence already lives in main.js.
// The whole module was removed.
//
// F09 (portalGlow): a fully standalone module with no static, dynamic, SDK or
// debug importer anywhere in the tree. Removed as the one clear F09 candidate.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ARENA = readFileSync(join(ROOT, 'src', 'arenaRuntime.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');

describe('F10 — dead playerStats view removed, authoritative SCORE path retained', () => {
  it('playerStats.js is gone (its DOM targets were already removed)', () => {
    expect(existsSync(join(ROOT, 'src', 'playerStats.js'))).toBe(false);
  });

  it('arenaRuntime no longer boots the dead stats view', () => {
    expect(ARENA).not.toMatch(/initPlayerStats/);
    expect(ARENA).not.toMatch(/playerStats/);
  });

  it('main.js keeps the one authoritative SCORE-frame persistence path', () => {
    // SCORE persistence must survive the playerStats deletion: main.js owns it.
    expect(MAIN).toMatch(/saveLatestScoreFrame\(globalThis\.localStorage, state\.nostrPubkey, _latestScoreFrame\)/);
    expect(MAIN).toMatch(/loadLatestScoreFrame\(globalThis\.localStorage, pubkey\)/);
  });
});

describe('F09 — standalone dead module removed (portalGlow)', () => {
  it('portalGlow.js is gone', () => {
    expect(existsSync(join(ROOT, 'src', 'effects', 'portalGlow.js'))).toBe(false);
  });

  it('no importer references createPortalGlow anywhere in the tree', () => {
    expect(ARENA).not.toMatch(/createPortalGlow/);
    expect(MAIN).not.toMatch(/createPortalGlow/);
  });
});
// tests/adr-0064-regressions.test.js — source-contract guards for the two
// changes in ADR-0064 (v0.2.694-alpha): (a) the in-game minimap is fully removed,
// and (b) a single K press enters Kami Mode AND focuses the chat input
// immediately, with Enter/Esc leaving the pointer free to click the emagake.
//
// Same file-read pattern as tests/adr-0063-regressions.test.js — pure source
// string checks, no fs mutation / network / DOM.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HUD = readFileSync(join(ROOT, 'src/hud.js'), 'utf8');
const ARENA = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const KAMI = readFileSync(join(ROOT, 'src/engine/kami/kamiMode.js'), 'utf8');

describe('ADR-0064 — (a) the in-game minimap is fully removed', () => {
  it('index.html no longer defines the minimap canvas or its wrapper', () => {
    expect(INDEX).not.toMatch(/id="minimap"/);
    expect(INDEX).not.toMatch(/id="minimap-wrap"/);
  });

  it('hud.js no longer exports drawMinimap or holds the 2d context', () => {
    expect(HUD).not.toMatch(/drawMinimap/);
    expect(HUD).not.toMatch(/getContext\('2d'\).*minimap|minimap.*getContext\('2d'\)/);
  });

  it('arenaRuntime.js no longer imports drawMinimap or runs the minimap tick', () => {
    expect(ARENA).not.toMatch(/drawMinimap/);
    expect(ARENA).not.toMatch(/_minimapTick/);
  });
});

describe('ADR-0064 — (b) one K press opens the note input; Enter/Esc leave the pointer free', () => {
  it('the bare-K handler opens the note directly (no separate enter-mode branch)', () => {
    // The handler used to branch on !_kamiActive -> enterKamiMode(); else openNote().
    // Now a single bare K always routes to openNote(), which itself enters Kami
    // Mode if not already active.
    expect(KAMI).toMatch(/if \(ev\.shiftKey\) hangTray\(\);[\s\S]{0,1400}else openNote\(\);/);
    // The old enter-only branch must be gone.
    expect(KAMI).not.toMatch(/else if \(!_kamiActive\) enterKamiMode\(\)/);
  });

  it('finish() no longer re-acquires pointer lock after commit/cancel', () => {
    // The old restore line was: if (wasLocked) _deps.requestPointerLock();
    const finishBlock = KAMI.match(/const finish = \(commit\) => \{[\s\S]*?\n  \};/);
    expect(finishBlock).not.toBeNull();
    expect(finishBlock[0]).not.toMatch(/requestPointerLock\(\)/);
    // ...and the textarea is explicitly blurred on close.
    expect(finishBlock[0]).toMatch(/ta\.blur\(\)/);
  });
});

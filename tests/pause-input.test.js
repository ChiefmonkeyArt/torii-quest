// tests/pause-input.test.js - source contract for the pause modal input boundary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');

describe('pause modal input boundary', () => {
  it('opens pause from Escape keydown or a browser-consumed pointer-lock Escape keyup', () => {
    expect(RUNTIME).toMatch(/if \(e\.code !== 'Escape' \|\| e\.repeat\) return;/);
    expect(RUNTIME).toMatch(/_escapeHandledOnKeyDown/);
    expect(RUNTIME).toMatch(/!handled && isPlaying\(\) && !document\.pointerLockElement && wasLockReleasedRecently\(\)/);
    // The keyup fallback must be gated on a RECENT pointer-lock release, else a
    // stray ESC keyup (signer prompt, find bar, devtools) pauses mid-game.
    expect(INPUT).toMatch(/export function wasLockReleasedRecently/);
    expect(INPUT).toMatch(/_lockReleasedAt > 0 && \(performance\.now\(\) - _lockReleasedAt\) <= windowMs/);
    expect(RUNTIME).not.toMatch(/onPointerLockLost/);
    expect(INPUT).not.toMatch(/_lockLostCbs|onPointerLockLost/);
    // _openPause transitions out of PLAYING before pointer-lock release. The
    // existing shoot gate therefore still blocks clicks on the pause panel.
    expect(INPUT).toMatch(/e\.button === 0 && isPlaying\(\)/);
  });

  it('clears held keys on blur / tab-hide / pointer-lock exit (stuck-key guard, v0.2.612)', () => {
    // The browser swallows keyups when focus leaves mid-hold — a latched W/A/S/D
    // reads as "sticky movement" (player keeps running after key release).
    expect(INPUT).toMatch(/export function clearKeys\(\)/);
    expect(INPUT).toMatch(/window\.addEventListener\('blur', clearKeys\)/);
    expect(INPUT).toMatch(/document\.addEventListener\('visibilitychange'/);
    expect(INPUT).toMatch(/pointerlockchange[\s\S]*clearKeys\(\)/);
  });
});

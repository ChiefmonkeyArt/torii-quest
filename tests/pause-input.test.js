// tests/pause-input.test.js - source contract for the pause modal input boundary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');

describe('pause modal input boundary', () => {
  it('ESC is two-stage: 1st press releases pointer lock only, 2nd opens pause (v0.2.614)', () => {
    expect(RUNTIME).toMatch(/if \(e\.code !== 'Escape' \|\| e\.repeat\) return;/);
    // While pointer-locked the ESC keydown must be ignored so the browser's own
    // lock release disengages play WITHOUT opening the pause modal. The modal
    // opens on the NEXT press, delivered as a normal keydown once unlocked.
    expect(RUNTIME).toMatch(/if \(state\.pointerLocked\) return;/);
    // The old keyup fallback paused on the FIRST press (browsers that reserve
    // the locked ESC expose only its keyup) — it must stay removed.
    expect(RUNTIME).not.toMatch(/_escapeHandledOnKeyDown/);
    expect(RUNTIME).not.toMatch(/wasLockReleasedRecently/);
    expect(RUNTIME).not.toMatch(/onPointerLockLost/);
    expect(INPUT).not.toMatch(/_lockLostCbs|onPointerLockLost/);
    // _openPause transitions out of PLAYING before pointer-lock release. The
    // existing shoot gate therefore still blocks clicks on the pause panel.
    // v0.2.614: shots additionally require pointer lock, so the click that
    // re-acquires lock can never fire a shot at the stale aim point.
    expect(INPUT).toMatch(/e\.button === 0 && isPlaying\(\) && state\.pointerLocked/);
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

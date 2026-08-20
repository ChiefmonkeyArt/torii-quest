// tests/pause-input.test.js - source contract for the pause modal input boundary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('pause modal input boundary', () => {
  it('ESC is two-stage: 1st press pauses quietly (mouse freed, NO modal), 2nd opens the modal (v0.2.615)', () => {
    expect(RUNTIME).toMatch(/if \(e\.code !== 'Escape' \|\| e\.repeat\) return;/);
    // Stage 1: while pointer-locked, ESC pauses the game quietly — the browser's
    // own lock release frees the mouse and NO modal is shown (a small PAUSED hint
    // pill shows instead). The handler must NOT return early on pointerLocked.
    expect(RUNTIME).toMatch(/if \(state\.pointerLocked\) \{ _openPauseQuiet\(\); return; \}/);
    expect(RUNTIME).not.toMatch(/if \(state\.pointerLocked\) return;/);
    // Quiet pause hides the modal and shows the hint pill.
    expect(RUNTIME).toMatch(/_elPauseOverlay\(\)\?\.classList\.remove\('show'\)/);
    expect(RUNTIME).toMatch(/_elPausedHint\(\)\?\.classList\.add\('show'\)/);
    // Stage 2: paused + quiet → ESC reveals the resume/leave modal; modal open →
    // ESC resumes.
    expect(RUNTIME).toMatch(/if \(_quietPause\) _openPause\(\);/);
    expect(RUNTIME).toMatch(/else _resume\(\);/);
    // Browsers that reserve the locked ESC deliver only the pointerlockchange —
    // the lock-exit hook performs the quiet pause for them.
    expect(RUNTIME).toMatch(/document\.addEventListener\('pointerlockchange', \(\) => \{\s*if \(!document\.pointerLockElement && isPlaying\(\)\) _openPauseQuiet\(\);/);
    // The hint pill element exists in the shell.
    expect(INDEX).toMatch(/id="paused-hint"/);
    // The old keyup fallback paused on the FIRST press — it must stay removed.
    expect(RUNTIME).not.toMatch(/_escapeHandledOnKeyDown/);
    expect(RUNTIME).not.toMatch(/wasLockReleasedRecently/);
    expect(RUNTIME).not.toMatch(/onPointerLockLost/);
    expect(INPUT).not.toMatch(/_lockLostCbs|onPointerLockLost/);
    // _openPause transitions out of PLAYING before pointer-lock release. The
    // existing shoot gate therefore still blocks clicks on the pause panel.
    // Shots additionally require pointer lock, so the click that re-acquires
    // lock can never fire a shot at the stale aim point.
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

// tests/pause-input.test.js - source contract for the pause modal input boundary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const INPUT = readFileSync(join(ROOT, 'src/input.js'), 'utf8');

describe('pause modal input boundary', () => {
  it('opens the pause modal only from a non-repeating Escape keydown', () => {
    expect(RUNTIME).toMatch(/if \(e\.code !== 'Escape' \|\| e\.repeat\) return;/);
    expect(RUNTIME.match(/_openPause\(\);/g)).toHaveLength(1);
    expect(RUNTIME).not.toMatch(/onPointerLockLost/);
    expect(INPUT).not.toMatch(/_lockLostCbs|onPointerLockLost/);
    // _openPause transitions out of PLAYING before pointer-lock release. The
    // existing shoot gate therefore still blocks clicks on the pause panel.
    expect(INPUT).toMatch(/e\.button === 0 && isPlaying\(\)/);
  });
});

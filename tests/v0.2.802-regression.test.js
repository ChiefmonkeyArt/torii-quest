// tests/v0.2.802-regression.test.js — locks the v0.2.802-alpha fix for "no
// first-person body/feet when looking down near the mirror".
//
// The v0.2.768 mirror guard hid the ENTIRE first-person body whenever the player
// was within MIRROR_HIDE_DIST (distance-only), so standing by the glass and
// looking DOWN — away from the reflection — showed no body/feet at all. The fix
// adds a FACING requirement: the body is only hidden while the mirror actually
// lies in front of the view (camera forward · direction-to-mirror > threshold),
// so a downward/away glance re-shows the chest → feet. Static source contract
// (no THREE import), matching v0.2.768-regression.test.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPBODY = readFileSync(join(ROOT, 'src/firstPersonBody.js'), 'utf8');

// Extract the _updateMirrorProximity body for focused assertions.
function mirrorProximityBody() {
  const m = FPBODY.match(/function _updateMirrorProximity\(\)\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error('_updateMirrorProximity not found');
  return m[1];
}

describe('v0.2.802 — FP body re-shows when looking away from the mirror', () => {
  it('defines a facing threshold so distance alone no longer hides the body', () => {
    expect(FPBODY).toMatch(/const\s+MIRROR_FACING_DOT\s*=\s*[0-9.]+/);
  });

  it('computes the camera forward direction and the mirror bearing', () => {
    const body = mirrorProximityBody();
    expect(body).toMatch(/getWorldDirection\(_fwd\)/);
    expect(body).toMatch(/_toMirror\.copy\(_mirrorPos\)\.sub\(_wp\)\.normalize\(\)/);
  });

  it('hides only when near the mirror AND roughly facing it', () => {
    const body = mirrorProximityBody();
    expect(body).toMatch(/_wp\.distanceTo\(_mirrorPos\)\s*<\s*MIRROR_HIDE_DIST/);
    expect(body).toMatch(/facing\s*>\s*MIRROR_FACING_DOT/);
    // The combined condition: both terms must be present on the `near` line.
    expect(body).toMatch(/&&\s*facing\s*>\s*MIRROR_FACING_DOT/);
  });
});
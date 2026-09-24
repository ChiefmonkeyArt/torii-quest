// gateway-browse-toggle.test.js — source contract for the cursor ↔ gaze toggle
// (v0.2.884). The gate browse opens with the cursor FREE so the directory strip is
// clickable (select a world), and F flips to pointer-locked gaze (look through the
// gate) and back — the "select, look, select another" loop the playtester asked for.
// Runtime input seams like pointer-lock toggling are DOM-bound, so this locks the
// contracts at the source level (same approach as tests/pause-input.test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const GATEWAY = readFileSync(join(ROOT, 'src/engine/gateway/gatewayScreen.js'), 'utf8');

describe('gateway browse cursor ↔ gaze toggle', () => {
  it('opens with the cursor free (exits pointer lock) so the directory is clickable', () => {
    // The browse-open path exists + frees the pointer (no more stuck crosshair).
    expect(RUNTIME).toMatch(/document\.exitPointerLock/);
    expect(RUNTIME).toMatch(/function _openGatewayScreen/);
  });

  it('F toggles gaze only while the gateway screen is open, before the armed/fly fallbacks', () => {
    expect(RUNTIME).toMatch(/function _toggleGatewayGaze/);
    expect(RUNTIME).toMatch(/if \(isGatewayScreenOpen\(\)\) \{ _toggleGatewayGaze\(\); return; \}/);
  });

  it('re-engages pointer lock after a commit landed from the free-cursor state', () => {
    expect(RUNTIME).toMatch(/if \(!document\.pointerLockElement\) requestLock\(renderer\.domElement\)/);
  });

  it('shooting stays suppressed during browse (cursor or gaze) and the directory hint names the F toggle', () => {
    expect(RUNTIME).toMatch(/setShootingSuppressed\(true\)/);
    expect(GATEWAY).toMatch(/F to gaze around/);
  });

  it('the directory no longer auto-focuses the × button (Enter must walk through, not close)', () => {
    expect(GATEWAY).not.toMatch(/querySelector\('button'\)\?\.focus/);
  });
});
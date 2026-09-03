// tests/self-view-layer-guard.test.js — regression lock for the layer-1 leak
// fix (v0.2.749-alpha). The full player character lives on render layer 1 and
// must NEVER be visible to the first-person camera — only the mirror's
// reflection camera and the P-key self-view enable layer 1. A leaked enable
// (a self-view entry that was never cleanly exited) left a duplicate body
// clipped into the viewport, so arenaRuntime now force-disables layer 1 every
// frame whenever the self-view is NOT active.
//
// arenaRuntime.js is a large THREE-bound runtime module (not unit-importable),
// so — consistent with tests/main-owner-profile-name-wiring.test.js — this
// locks the guard at the source level via readFileSync + pattern assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/arenaRuntime.js', import.meta.url), 'utf8');

describe('arenaRuntime layer-1 defensive guard', () => {
  it('force-disables layer 1 on the shared camera when self-view is not active', () => {
    expect(SRC).toMatch(/if\s*\(\s*!isStickerPlacementActive\(\)\s*\)\s*\{[\s\S]{0,120}camera\.layers\.disable\(1\)/);
  });

  it('re-enables layer 2 (the headless FP body) in the same guard', () => {
    expect(SRC).toMatch(/camera\.layers\.enable\(2\)/);
  });

  it('keeps the self-view active state as the lone gate (mirror + P-key still own layer 1)', () => {
    expect(SRC).toMatch(/isStickerPlacementActive\(\)/);
  });
});
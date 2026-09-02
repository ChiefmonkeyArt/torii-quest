// @vitest-environment jsdom
// input.js shooting-suppression split (ADR-0029 Kami Mode).
// Kami Mode needs a FINER suppression than the ema-note full-suppress: while the
// admin is an invincible spirit the shoot path is off but movement + look stay
// live. setShootingSuppressed gates ONLY the mousedown shoot path; the movement
// keydown path is gated by setGameInputSuppressed alone.
//
// input.js holds module-scope state (_inputSuppressed, _shootingSuppressed,
// _clickCbs, keys) + attaches document listeners at import time. The repo's
// vitest default is isolate:false (shared module graph for perf), so this file
// resets the module graph per test to stay self-contained + not leak into the
// pure-logic suite.
import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('input.js shooting-suppression split (ADR-0029)', () => {
  let input, state;

  beforeEach(async () => {
    vi.resetModules();
    input = await import('../src/input.js');
    state = (await import('../src/state.js')).state;
    state.phase = 'playing'; // isPlaying() reads this
  });

  function fireKeydown(code) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  function fireMousedown(button = 0) {
    document.body.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
  }

  test('mousedown fires the shoot callback when nothing is suppressed', () => {
    let hits = 0;
    input.onShoot(() => { hits++; });
    fireMousedown(0);
    expect(hits).toBe(1);
  });

  test('setShootingSuppressed(true) blocks the shoot path but NOT movement keys', () => {
    let hits = 0;
    input.onShoot(() => { hits++; });
    input.setShootingSuppressed(true);
    expect(input.isShootingSuppressed()).toBe(true);

    // Shoot path: blocked.
    fireMousedown(0);
    expect(hits).toBe(0);

    // Movement keys: NOT blocked by shooting-suppress (only by full suppress).
    fireKeydown('KeyW');
    expect(input.keys['KeyW']).toBe(true);
  });

  test('setGameInputSuppressed(true) blocks BOTH movement + shoot (ema-note state)', () => {
    let hits = 0;
    input.onShoot(() => { hits++; });
    input.setGameInputSuppressed(true);
    // Movement blocked — the keydown handler returns early before latching it.
    fireKeydown('KeyW');
    expect(input.keys['KeyW']).not.toBe(true);
    // Shoot blocked too.
    fireMousedown(0);
    expect(hits).toBe(0);
  });
});

// tests/render/qualityTier.test.js — locks down the v0.2.379-alpha adaptive
// render-quality tier (src/engine/render/qualityTier.js). Pure logic: the THREE
// handles (renderer/composer/bloomPass) + window are injected as fakes, so it
// runs in plain node. Covers the rolling FPS average, hysteresis (step down/up
// only after a sustained hold), DPR/bloom application, and the stall guard.
import { describe, it, expect } from 'vitest';
import { createQualityTier, TIERS } from '../../src/engine/render/qualityTier.js';

// Fake THREE handles that record what the tier applied.
function makeDeps() {
  const calls = { setPixelRatio: [], setSize: [], composerSetSize: [] };
  const renderer = {
    setPixelRatio: (r) => calls.setPixelRatio.push(r),
    setSize: (w, h) => calls.setSize.push([w, h]),
    info: { render: { calls: 0, triangles: 0 } },
  };
  const composer = { setSize: (w, h) => calls.composerSetSize.push([w, h]) };
  const bloomPass = { enabled: true };
  const win = { innerWidth: 1280, innerHeight: 720 };
  return { renderer, composer, bloomPass, window: win, calls };
}

// Drive N frames at a given frame-time (ms).
function run(tier, frameMs, n) {
  for (let i = 0; i < n; i++) tier.update(frameMs);
}

const RING = 60;
const MS_60FPS = 1000 / 60; // ~16.67 → avg FPS 60 (> FPS_HIGH 55)
const MS_30FPS = 1000 / 30; // ~33.3  → avg FPS 30 (< FPS_LOW 45)
const MS_50FPS = 1000 / 50; // 20     → dead band (45..55)

describe('createQualityTier', () => {
  it('starts at HIGH (DPR 1.5, bloom on) and does not force-apply on init', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    expect(q.currentTier()).toBe('HIGH');
    expect(q.dpr()).toBe(1.5);
    expect(q.bloomOn()).toBe(true);
    // No apply happened just from construction — scene already sits at HIGH.
    expect(d.calls.setPixelRatio).toHaveLength(0);
  });

  it('computes a rolling FPS average once the ring is warm', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    run(q, MS_60FPS, RING);
    expect(q._avgFps()).toBeGreaterThan(59);
    expect(q._avgFps()).toBeLessThan(61);
    expect(q.metrics().frameMs).toBeCloseTo(MS_60FPS, 1);
  });

  it('does NOT step down before DOWN_HOLD_MS of sustained low FPS (hysteresis)', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    // Warm the ring at low FPS. RING frames @ 33.3ms = ~2000ms — the accumulator
    // only starts once the ring is full, so right at warm we should still be HIGH.
    run(q, MS_30FPS, RING);
    expect(q.currentTier()).toBe('HIGH');
  });

  it('steps down a tier after sustained low FPS, applying DPR + bloom', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    // Warm ring (60) + enough extra low frames to exceed DOWN_HOLD_MS (2000ms).
    run(q, MS_30FPS, RING + 70); // 70*33.3 ≈ 2333ms > 2000
    expect(q.currentTier()).toBe('NORMAL');
    expect(q.dpr()).toBe(TIERS.NORMAL.dpr);
    expect(d.calls.setPixelRatio.at(-1)).toBe(1.25);
    expect(d.calls.setSize.at(-1)).toEqual([1280, 720]);
    expect(d.calls.composerSetSize.at(-1)).toEqual([1280, 720]);
    expect(d.bloomPass.enabled).toBe(true); // NORMAL keeps bloom
  });

  it('steps all the way down to LOW and disables bloom (bloom gate)', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    // First step down.
    run(q, MS_30FPS, RING + 70);
    expect(q.currentTier()).toBe('NORMAL');
    // Second step down (accumulator reset on step, needs another >2000ms hold).
    run(q, MS_30FPS, 70);
    expect(q.currentTier()).toBe('LOW');
    expect(q.dpr()).toBe(1.0);
    expect(q.bloomOn()).toBe(false);
    expect(d.bloomPass.enabled).toBe(false);
  });

  it('never steps below LOW', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    run(q, MS_30FPS, RING + 70 + 70 + 200);
    expect(q.currentTier()).toBe('LOW');
  });

  it('steps up after sustained high FPS', () => {
    const d = makeDeps();
    const q = createQualityTier({ ...d, startTier: 'LOW' });
    expect(q.currentTier()).toBe('LOW');
    // Warm ring (60) + high frames beyond UP_HOLD_MS (3000ms). 60fps=16.67ms.
    run(q, MS_60FPS, RING + 190); // 190*16.67 ≈ 3167ms > 3000
    expect(q.currentTier()).toBe('NORMAL');
    expect(d.calls.setPixelRatio.at(-1)).toBe(1.25);
  });

  it('does not flap in the dead band (45..55 FPS)', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    run(q, MS_50FPS, RING + 500);
    expect(q.currentTier()).toBe('HIGH'); // no change either way
    expect(d.calls.setPixelRatio).toHaveLength(0);
  });

  it('ignores stall / tab-switch spikes and bogus deltas', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    run(q, MS_60FPS, RING); // warm & healthy
    const fpsBefore = q._avgFps();
    q.update(5000);  // 5s stall — ignored
    q.update(0);     // zero — ignored
    q.update(-3);    // negative — ignored
    q.update(NaN);   // bogus — ignored
    expect(q._avgFps()).toBeCloseTo(fpsBefore, 5);
    expect(q.currentTier()).toBe('HIGH');
  });

  it('sampleRenderInfo() stashes draw calls + triangles for the HUD', () => {
    const d = makeDeps();
    const q = createQualityTier(d);
    d.renderer.info.render.calls = 42;
    d.renderer.info.render.triangles = 12345;
    const m = q.sampleRenderInfo();
    expect(m.drawCalls).toBe(42);
    expect(m.triangles).toBe(12345);
    expect(m.tier).toBe('HIGH');
    expect(m.dpr).toBe(1.5);
  });
});

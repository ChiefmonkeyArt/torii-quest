// ADR-0141: no shader rebuilds mid-play: compile behind the loading screen,
// keep the light count constant, and record freezes in the snapshot.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prewarmShaders } from '../../src/engine/render/shaderPrewarm.js';
import { createHitchMeter, HITCH_MS } from '../../src/engine/render/frameHitch.js';
import { buildSnapshot } from '../../src/engine/debug/snapshot.js';

const rafNow = (cb) => Promise.resolve().then(cb);

describe('prewarmShaders', () => {
  it('waits for ready(), then compiles every target with compileAsync', async () => {
    const calls = []; let ready = false, frames = 0;
    const renderer = { compileAsync: async (s, c) => { calls.push([s, c]); } };
    const raf = (cb) => { frames++; if (frames === 5) ready = true; return Promise.resolve().then(cb); };
    const r = await prewarmShaders({ renderer, targets: [['S', 'C'], ['G', 'GC']], ready: () => ready, raf });
    expect(r.ready).toBe(true); expect(r.waitedFrames).toBe(5); expect(r.compiled).toBe(2);
    expect(calls).toEqual([['S', 'C'], ['G', 'GC']]);
  });
  it('gives up waiting after the cap and still compiles (never blocks entry)', async () => {
    const renderer = { compile: () => {} };
    const r = await prewarmShaders({ renderer, targets: [['S', 'C']], ready: () => false, raf: rafNow, maxWaitFrames: 7 });
    expect(r.ready).toBe(false); expect(r.waitedFrames).toBe(7); expect(r.compiled).toBe(1);
  });
  it('a compileAsync that never resolves is capped in frames', async () => {
    const renderer = { compileAsync: () => new Promise(() => {}) };
    const r = await prewarmShaders({ renderer, targets: [['S', 'C']], raf: rafNow, maxCompileFrames: 10 });
    expect(r.compiled).toBe(1);
  });
  it('never throws: errors are reported, not raised', async () => {
    const renderer = { compileAsync: () => { throw new Error('boom'); } };
    const r = await prewarmShaders({ renderer, targets: [['S', 'C']], ready: () => { throw new Error('x'); }, raf: rafNow, maxWaitFrames: 2 });
    expect(r.error).toMatch(/boom/);
  });
});

describe('hitch meter', () => {
  it('counts frames over the threshold, keeps the recent ones, ignores pauses', () => {
    const m = createHitchMeter();
    let t = 0; m.note(t);
    for (let i = 0; i < 60; i++) m.note(t += 16.7);
    m.note(t += 2470); // the first-fight freeze from the 2026-10-20 capture
    m.note(t += 16.7);
    m.resume(); m.note(t += 60000); m.note(t += 16.7); // tab hidden: not a freeze
    const s = m.stats();
    expect(s.long).toBe(1); expect(s.maxMs).toBe(2470); expect(s.recent).toHaveLength(1);
    expect(s.recent[0].ms).toBe(2470);
    expect(HITCH_MS).toBe(100);
  });
  it('rides along in the debug snapshot (so autocap frames show freezes)', () => {
    const snap = buildSnapshot({ getPerf: () => ({ hitches: { long: 2 }, prewarm: { compiled: 2 } }) });
    expect(snap.perf).toEqual({ hitches: { long: 2 }, prewarm: { compiled: 2 } });
  });
});

describe('wiring', () => {
  const A = readFileSync('src/arenaRuntime.js', 'utf8');
  it('prewarms the world and the gun overlay at the end of boot, after the bots load', () => {
    expect(A).toMatch(/_prewarm = await prewarmShaders\(\{[\s\S]*targets: \[\[scene, camera\], \[gunScene, gunCamera\]\][\s\S]*modelReady/);
    expect(A.indexOf('prewarmShaders({')).toBeLessThan(A.indexOf("mark('bootstrap-physics-end')"));
  });
  it('meters freezes only while playing', () => {
    expect(A).toMatch(/if \('playing' === state\.phase\) _hitch\.note\(performance\.now\(\)\); else _hitch\.resume\(\);/);
  });
  it('no source toggles a flash light visible/invisible any more', () => {
    const M = readFileSync('src/engine/render/muzzleFlash.js', 'utf8');
    expect(M).not.toMatch(/light\.visible = false/);
  });
});

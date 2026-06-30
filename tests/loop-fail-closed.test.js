// tests/loop-fail-closed.test.js — locks the v0.2.238 render-loop crash-fix on two fronts:
//
//  1. BEHAVIOUR (loop.js): an update() that throws every frame must NOT flood forever — the
//     loop fails closed after LOOP_ERROR_ABORT_STREAK consecutive throws (stops rescheduling
//     rAF) and calls the fatal handler ONCE; a transient single throw is tolerated; a healthy
//     update runs and reschedules. This is the safety net that turns the live "Uncaught
//     TypeError … thousands of times" console flood into a bounded, visible failure.
//
//  2. BOOT ORDER (src/main.js source contract): the ROOT cause was that startLoop() ran the
//     first update() tick SYNCHRONOUSLY before module-level bindings it reads (e.g.
//     _portalTrigger) were initialised, and that synchronous throw aborted module eval before
//     the ENTER handler + window.__toriiEnterReady were wired. We freeze that the loop is now
//     started AFTER both the ENTER readiness flag and the _portalTrigger definition.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initLoop, startLoop, getFrame, isLoopStopped, LOOP_ERROR_ABORT_STREAK,
} from '../src/loop.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
// v0.2.264 (R2): the three-dependent boot + render loop moved out of main.js (the
// three-free shell) into arenaRuntime.js, which is dynamically imported only on
// ENTER ARENA. The boot-order contract below now applies to arenaRuntime.js.
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

// Drive the loop synchronously with a bounded rAF stub. Because loop.js (v0.2.238)
// reschedules AFTER a healthy update, a synchronous stub walks frame-by-frame and
// terminates either when the loop fails closed (stops rescheduling) or at the cap.
function driveSync(cap = 5000) {
  let scheduled = 0;
  globalThis.requestAnimationFrame = (cb) => {
    if (++scheduled > cap) return scheduled; // safety stop — should never hit with the guard
    cb();
    return scheduled;
  };
  return () => scheduled;
}

describe('loop.js fail-closed behaviour (v0.2.238)', () => {
  let errSpy;
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); delete globalThis.requestAnimationFrame; });

  it('an always-throwing update halts after the abort streak instead of flooding forever', () => {
    driveSync();
    let calls = 0;
    const fatal = vi.fn();
    initLoop(() => { calls++; throw new Error('boom'); }, fatal);
    startLoop();
    expect(isLoopStopped()).toBe(true);
    // It ran exactly the streak length of frames, then stopped — NOT thousands.
    expect(calls).toBe(LOOP_ERROR_ABORT_STREAK);
    expect(fatal).toHaveBeenCalledTimes(1);
  });

  it('a single transient throw is tolerated — the loop keeps running and resets the streak', () => {
    const getScheduled = driveSync(20);
    let calls = 0;
    const fatal = vi.fn();
    initLoop(() => { calls++; if (calls === 1) throw new Error('one-off'); }, fatal);
    startLoop();
    // The loop never failed closed; it kept rescheduling up to the cap.
    expect(isLoopStopped()).toBe(false);
    expect(fatal).not.toHaveBeenCalled();
    expect(getScheduled()).toBeGreaterThan(LOOP_ERROR_ABORT_STREAK);
  });

  it('a fatal-handler that itself throws cannot re-enter or crash the loop', () => {
    driveSync();
    initLoop(() => { throw new Error('boom'); }, () => { throw new Error('handler boom'); });
    expect(() => startLoop()).not.toThrow();
    expect(isLoopStopped()).toBe(true);
  });

  it('a healthy update runs and advances the frame counter', () => {
    driveSync(3);
    let ticks = 0;
    initLoop((dt, frame) => { ticks++; expect(typeof dt).toBe('number'); expect(frame).toBeGreaterThan(0); });
    startLoop();
    expect(ticks).toBeGreaterThan(0);
    expect(getFrame()).toBeGreaterThan(0);
    expect(isLoopStopped()).toBe(false);
  });

  it('initLoop tolerates a missing/invalid fatal handler (no throw when it fails closed)', () => {
    driveSync();
    initLoop(() => { throw new Error('boom'); }, null);
    expect(() => startLoop()).not.toThrow();
    expect(isLoopStopped()).toBe(true);
  });
});

describe('boot-order contract — loop starts last, behind the three-free shell (v0.2.238; relocated to arenaRuntime.js v0.2.264 R2)', () => {
  it('the ENTER-ready flag is set synchronously in the three-free shell, and the render loop is NOT started there (deferred behind ENTER)', () => {
    // R2: window.__toriiEnterReady is raised in main.js (the shell), which imports
    // no three — so a 3D/WebGL throw can NEVER abort the ENTER handler binding.
    // startLoop() lives in arenaRuntime.js now, only reached via the deferred
    // import on ENTER — strictly AFTER the flag is already set on the title screen.
    expect(MAIN).toMatch(/window\.__toriiEnterReady = true/);
    expect(MAIN).not.toMatch(/startLoop\(\)/);
  });

  it('the render loop is started AFTER the _portalTrigger definition (no uninitialised read on frame 0)', () => {
    const portalDef = RUNTIME.indexOf('const _portalTrigger');
    const startCall = RUNTIME.lastIndexOf('startLoop()');
    expect(portalDef).toBeGreaterThanOrEqual(0);
    expect(startCall).toBeGreaterThan(portalDef);
  });

  it('the boot block no longer starts the loop eagerly before the module-level state exists', () => {
    // The eager start once sat right after initTargetReticle(...). Assert the loop
    // start is at the END of boot(), after the entity init block.
    const bootSlice = RUNTIME.slice(RUNTIME.indexOf('initTargetReticle('), RUNTIME.indexOf('initLoop(update'));
    expect(bootSlice).not.toMatch(/startLoop\(\);/);
  });

  it('the loop is wired with a fatal handler that surfaces a visible, actionable message', () => {
    expect(RUNTIME).toMatch(/initLoop\(\s*update\s*,\s*_onLoopFatal\s*\)/);
    const fatalFn = RUNTIME.slice(RUNTIME.indexOf('function _onLoopFatal'), RUNTIME.indexOf('initLoop(update'));
    expect(fatalFn).toMatch(/showEntryStatus\(/);
    expect(fatalFn).toMatch(/reload the page/i);
  });
});

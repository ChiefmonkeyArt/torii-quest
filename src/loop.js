// loop.js — rAF loop. Calls the registered update fn. Nothing else.
//
// v0.2.238: FAIL-CLOSED hardening. The old loop scheduled the next rAF BEFORE
// calling the update fn, so a per-frame throw in update() (e.g. the v0.2.238
// boot-order crash where update touched a module const that wasn't initialised
// yet) re-armed the loop ahead of every throw — flooding the console with the
// same error thousands of times while the page sat frozen. Now update() runs
// inside a try/catch and the NEXT frame is scheduled only while the loop is
// healthy: after LOOP_ERROR_ABORT_STREAK consecutive throws the loop stops
// rescheduling (no flood) and hands the error to an optional fatal handler so
// the UI can show a precise, actionable message instead of a silent freeze. A
// healthy frame resets the streak, so a one-off hiccup is still tolerated.
import * as THREE from 'three';

const _clock = new THREE.Clock();
let _frame = 0;
let _onUpdate = null;
let _onFatal = null;
let _errStreak = 0;
let _stopped = false;

// After this many CONSECUTIVE update() throws the loop fails closed.
export const LOOP_ERROR_ABORT_STREAK = 8;

export function initLoop(onUpdate, onFatal = null) {
  _onUpdate = onUpdate;
  _onFatal = (typeof onFatal === 'function') ? onFatal : null;
}
export function getFrame() { return _frame; }
export function isLoopStopped() { return _stopped; }
export function getLongFrameCount() { return _longFrames; } // v0.2.614 watchdog

// v0.2.614: long-frame watchdog (operator: "arena froze several times"). Raw
// rAF gap > LONG_FRAME_MS (vs the dt-clamped game clock) logs a compact
// diagnostic line with frame, gap, and JS heap when available — throttled to
// one line per LONG_FRAME_LOG_EVERY frames so a hitch storm doesn't flood the
// console. Zero timers; reads happen inside the existing rAF tick.
export const LONG_FRAME_MS = 250;
const LONG_FRAME_LOG_EVERY = 30;
let _lastRafAt = 0;
let _longFrames = 0;

export function startLoop() {
  _stopped = false;
  _errStreak = 0;
  _lastRafAt = 0;
  _longFrames = 0;

  function _tick() {
    _frame++;
    const _now = performance.now();
    if (_lastRafAt > 0) {
      const gap = _now - _lastRafAt;
      if (gap > LONG_FRAME_MS && !document.hidden) {
        _longFrames++;
        if (_longFrames === 1 || _longFrames % LONG_FRAME_LOG_EVERY === 0) {
          const heap = (performance.memory && performance.memory.usedJSHeapSize)
            ? ` heapMB=${Math.round(performance.memory.usedJSHeapSize / 1048576)}` : '';
          console.warn(`[LONG-FRAME] frame=${_frame} gapMs=${Math.round(gap)} streak=${_longFrames}${heap}`);
        }
      }
    }
    _lastRafAt = _now;
    const dt = Math.min(_clock.getDelta(), 0.05);
    if (_onUpdate) {
      try {
        _onUpdate(dt, _frame);
        _errStreak = 0; // healthy frame — forget any prior transient throw
      } catch (e) {
        _errStreak++;
        // Cap the console volume even before the abort kicks in.
        if (_errStreak <= LOOP_ERROR_ABORT_STREAK) {
          console.error(`[loop] update threw on frame ${_frame} (streak ${_errStreak}):`, e);
        }
        if (_errStreak >= LOOP_ERROR_ABORT_STREAK) {
          _stopped = true;
          console.error(`[loop] FAILED CLOSED after ${_errStreak} consecutive update errors — render loop halted to stop the crash flood.`);
          // nostrich: a throw from the fatal handler itself must never re-enter the loop.
          if (_onFatal) { try { _onFatal(e); } catch (_) { /* swallow */ } }
          return; // the fail-closed exit — do NOT reschedule.
        }
      }
    }
    // Reschedule AFTER update (not before, as the old loop did): this is what
    // lets the streak guard actually halt the loop instead of the rAF re-arming
    // ahead of every throw.
    if (!_stopped) requestAnimationFrame(_tick);
  }

  _tick();
}

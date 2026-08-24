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
import { heartbeat } from './engine/diagnostics/connectionDiagnostics.js';

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

export function startLoop() {
  _stopped = false;
  _errStreak = 0;

  function _tick() {
    _frame++;
    // ADR-0049 v0.2.671: stamp each rAF tick so the gap between ticks reveals a
    // main-thread freeze (a long sync task / GC / render hitch that would also
    // starve the WebSocket onmessage handler and thus the BOT_STATE ingest).
    heartbeat();
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
